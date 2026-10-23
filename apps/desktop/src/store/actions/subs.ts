/**
 * 订阅/分组/设置动作:CRUD、启停、自动归组、OPML 导入导出。
 *
 * 从 store/index.ts 拆出;依赖 StoreCtx + lib 的参数比较/导航桥。
 */
import { ERROR_KIND_LABEL } from "@amoeba/core"
import { parseOpml } from "@amoeba/xml"
import { exportOpml, pendingImports } from "../../lib/opml.ts"
import { applyRuntimeSettings, navTo, now, sameInfo } from "../lib.ts"
import type { DesktopState, StoreCtx } from "../types.ts"

/** kind → 自动分类的组名(手动「一键归类」与「添加时自动归类」共用同一张表)。 */
const KIND_GROUP: Record<string, string> = {
  video: "视频",
  live: "直播",
  social: "社交",
  audio: "播客",
  article: "文章",
}

/** 取(或创建)某内容类型对应的分组;kind 未知返回 null。 */
async function ensureKindGroup(ctx: StoreCtx, kind: string | undefined): Promise<string | null> {
  if (!kind) return null
  const name = KIND_GROUP[kind] ?? "其它"
  const hit = ctx.get().groups.find((g) => g.title === name)
  if (hit) return hit.id
  return ctx.get().addGroup(name)
}

type SubsActions = Pick<
  DesktopState,
  | "addSubscription"
  | "updateSubscription"
  | "removeSubscription"
  | "toggleSubEnabled"
  | "addGroup"
  | "renameGroup"
  | "removeGroup"
  | "setSetting"
  | "autoGroupByKind"
  | "exportOpml"
  | "importOpml"
>

export function createSubsActions(ctx: StoreCtx): SubsActions {
  const { set, get, syncSubscriptions } = ctx

  return {
    async addSubscription(channelKey, title, info, meta) {
      const dl = get().dl
      if (!dl) return null
      // ⚠️ 重复订阅拦截:同 channelKey + 同 info 再加一次,会得到两条内容完全相同的
      // 订阅 —— 未读数与条目数直接翻倍(而且两条都各自抓一遍网络)。
      // 只在**新建**时拦(并入已有订阅走的是 updateSubscription,不经过这里)。
      const dup = get().subscriptions.find((s) => s.channelKey === channelKey && sameInfo(s.info, info))
      if (dup) {
        get().toast("info", `已经订阅过了：${dup.title}`, "同参数重复添加会产生两份一样的内容。", {
          label: "打开",
          run: () => get().select(dup.id),
        })
        return dup.id
      }
      // 添加时自动归类(设置项 autoGroupOnAdd,默认开):只在调用方**没指定具体分组**
      // 时生效 —— 手动选了分组(非空 groupId)以用户选择为准。组名与手动「一键按类型
      // 归类」一致:同名复用,不存在才建。
      let dest = meta
      if (get().settings?.autoGroupOnAdd && !meta?.groupId) {
        const gid = await ensureKindGroup(ctx, dl.channelKind(channelKey))
        if (gid) dest = { ...meta, groupId: gid }
      }
      const { id, refresh } = await dl.addSubscription(channelKey, title, info, dest)
      await syncSubscriptions()
      // ⚠️ 首刷失败不能吞：订阅已落盘，但列表为空。用 warn 明确「已订阅、抓取失败」，
      // 而不是成功 toast 掩盖失败（旧实现只返回 id，RefreshResult.error 被丢弃）。
      if (refresh.error) {
        const label = refresh.errorKind ? ERROR_KIND_LABEL[refresh.errorKind] : "首次抓取失败"
        get().toast("warn", `已订阅 ${title}，但${label}`, refresh.error)
      } else get().toast("ok", `已订阅 ${title}`, `渠道 ${channelKey}`)
      return id
    },

    async updateSubscription(id, patch) {
      const dl = get().dl
      if (!dl) return
      await dl.subscriptions.update(id, patch)
      await syncSubscriptions()
      // ⚠️ `patch.info` 改了**内容集**（如并入直播间 = roomIds 追加）→ 必须重抓，
      // 否则新房间的条目只在持久层、内存 allItems 里没有，`refreshView()` 从内存重算
      // 什么也不会多出来 —— 用户看到「加了房间但列表没变，得手动刷新」（旧行为，提示
      // 里那句「刷新后生效」即自白）。只改 title/groupId/ttl/enabled 时不碰 info，
      // 内容集不变，不该触发网络（`patch.info` 存在才抓）。静默：调用方（并入弹窗）
      // 自己已弹「已并入」提示，这里再弹一条「已更新」是重复。
      if (patch.info) await get().refresh(id, { silent: true })
    },

    async removeSubscription(id) {
      const dl = get().dl
      if (!dl) return
      const title = get().subscriptions.find((s) => s.id === id)?.title ?? id
      await dl.subscriptions.remove(id)
      if (get().selectedNodeId === id) {
        set({ selectedNodeId: "tab:all" })
        // 同步 URL(否则地址栏停在已删 id,回退/重载会再 select 已删节点)。
        navTo("/v/tab:all", { replace: true })
      }
      // ⚠️ syncSubscriptions 必须**在这之后**:它内含 refreshView,而 refreshView 用
      // `get().selectedNodeId` 算视图 —— 先跑的话会拿刚被删的 id 重算一次。
      await syncSubscriptions()
      get().toast("ok", `已退订 ${title}`)
    },

    async toggleSubEnabled(id) {
      const dl = get().dl
      if (!dl) return
      const sub = get().subscriptions.find((s) => s.id === id)
      if (!sub) return
      await dl.subscriptions.update(id, { enabled: !sub.enabled })
      // ⚠️ 这里**不**走 syncSubscriptions:启停只改 subscriptions 数组就够了。
      // 停用态在侧栏是靠 `healthOf(sub, ...)` 读**传入的 sub** 判断的(不读视图快照),
      // 而 `allItems` 也不因启停而变 —— 多调 refreshView 只是白重算一次 queryView。
      set({ subscriptions: await dl.subscriptions.list() })
    },

    async addGroup(title) {
      const dl = get().dl
      if (!dl) return null
      // ⚠️ 必须带随机后缀:纯时间戳在同一毫秒内连点「新建分组」会撞 id,store 里出现
      // 两个同 id 分组(React key 冲突 + 持久化覆盖)。
      const id = `g-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      await dl.subscriptions.addGroup({ id, title })
      set((s) => ({ groups: [...s.groups, { id, title }], openGroups: { ...s.openGroups, [id]: true } }))
      return id
    },

    async renameGroup(id, title) {
      const dl = get().dl
      if (!dl) return
      await dl.subscriptions.updateGroup(id, { title })
      await syncSubscriptions()
    },

    async removeGroup(id) {
      const dl = get().dl
      if (!dl) return
      // 成员先迁到「未分组」,再删组(否则订阅会指向不存在的组)。
      for (const s of get().subscriptions.filter((s) => s.groupId === id)) {
        await dl.subscriptions.update(s.id, { groupId: null })
      }
      await dl.subscriptions.removeGroup(id)
      if (get().selectedNodeId === `group:${id}`) {
        set({ selectedNodeId: "tab:all" })
        navTo("/v/tab:all", { replace: true })
      }
      // ⚠️ 同 removeSubscription:syncSubscriptions 内含 refreshView,必须等
      // selectedNodeId 修正后再跑,否则会拿刚删的 `group:<id>` 重算视图。
      await syncSubscriptions()
    },

    async setSetting(key, value) {
      const dl = get().dl
      if (!dl) return
      const next = await dl.settings.set({ [key]: value })
      set({ settings: next })
      // 渲染管线直读的门面开关(如 imageProxy)同步生效,不必等重挂载。
      applyRuntimeSettings(next)
    },

    async autoGroupByKind() {
      const dl = get().dl
      if (!dl) return 0
      const subs = get().subscriptions
      const orphans = subs.filter((s) => !s.groupId)
      if (!orphans.length) {
        get().toast("info", "没有未分组的订阅")
        return 0
      }
      // kind → 组名(按用户的条目实际类型,不是渠道写死的)。
      // 1. 确保目标分组存在(按名字复用已有的,不重复建)。
      const groups = get().groups.slice()
      const groupIdOf = (name: string): string | null => {
        const hit = groups.find((g) => g.title === name)
        return hit ? hit.id : null
      }
      const ensureGroup = async (name: string): Promise<string> => {
        const existing = groupIdOf(name)
        if (existing) return existing
        const id = await get().addGroup(name)
        if (!id) throw new Error("创建分组失败")
        groups.push({ id, title: name })
        return id
      }
      // 2. 记住原分组,便于撤销。
      const before = orphans.map((s) => ({ id: s.id, groupId: s.groupId ?? null }))
      // ⚠️ 先按 kind 分桶,只为**实际有成员**的 kind 建组 —— 否则会留下 0 成员的
      // 空分组(如「文章」组建出来了却没人),用户看着像归类失败。
      const buckets = new Map<string, typeof orphans>()
      for (const s of orphans) {
        const kind = dl.channelKind(s.channelKey)
        if (!kind) continue
        const name = KIND_GROUP[kind] ?? "其它"
        const list = buckets.get(name)
        if (list) list.push(s)
        else buckets.set(name, [s])
      }
      let moved = 0
      try {
        for (const [name, members] of buckets) {
          const gid = await ensureGroup(name)
          for (const s of members) {
            await dl.subscriptions.update(s.id, { groupId: gid })
            moved++
          }
        }
      } catch (e) {
        get().toast("error", "自动归组失败", e instanceof Error ? e.message : String(e))
      }
      await syncSubscriptions()
      if (!moved) return 0
      get().toast("ok", `已归类 ${moved} 条未分组订阅`, "按内容类型分组,可在设置里调整。", {
        label: "撤销",
        run: () => {
          void (async () => {
            // 撤销:全部移回未分组。分组本身留着(可能是用户本来就有的)。
            for (const b of before) await dl.subscriptions.update(b.id, { groupId: b.groupId })
            await syncSubscriptions()
            get().toast("ok", "已撤销归组")
          })()
        },
      })
      return moved
    },

    exportOpml() {
      return exportOpml(get().subscriptions, get().groups)
    },

    async importOpml(xml) {
      const dl = get().dl
      if (!dl) return { added: 0, skipped: 0, failed: 0 }
      const { feeds, skipped } = pendingImports(parseOpml(xml), get().subscriptions)
      // ⚠️ 走 dl 直连而非 store.addSubscription:后者每条都会 toast + refreshView,
      // 批量导入几十条会刷屏。这里只落盘,末尾统一刷新 + 一条汇总 toast(由 UI 弹)。
      //
      // ⚠️ 分组层级按**叶子**建、只建**有成员**的那一级 —— Rail 是扁平渲染(忽略 parentId),
      // 若按 OPML 的 ['视频','科技'] 逐级建,会产生「视频」空壳组 + 订阅落在「科技」(祖父
      // 级丢失,空组还挂在侧栏)。UI 本就单层,叶子组标题即分组名(与 exportOpml 从
      // groupPath 重建层级对称时,往返只损失人为的多层嵌套)。
      // 标题即键:同名分组复用(跨多个 OPML 子树合并到同一组)。
      const groups = get().groups.slice()
      const groupIdOfLeaf = async (path: string[]): Promise<string | null> => {
        const leaf = path.filter(Boolean).at(-1)
        if (!leaf) return null
        const hit = groups.find((g) => g.title === leaf)
        if (hit) return hit.id
        const nid = `g-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        await dl.subscriptions.addGroup({ id: nid, title: leaf })
        groups.push({ id: nid, title: leaf })
        return nid
      }
      let added = 0
      let failed = 0
      for (const f of feeds) {
        try {
          const gid = await groupIdOfLeaf(f.groupPath)
          await dl.addSubscription("rss:url", f.title, { url: f.xmlUrl }, { groupId: gid })
          added++
        } catch {
          failed++
        }
      }
      await syncSubscriptions()
      return { added, skipped, failed }
    },
  }
}
