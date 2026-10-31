/**
 * 数据动作:init / refresh / refreshAll / loadMore。
 *
 * 从 store/index.ts 拆出;只依赖 StoreCtx + core 的 DataLayer。
 */

import { contentTtlMs, ERROR_KIND_LABEL, type ErrorKind, errorKindOf } from "@amoeba/core/pure"

import { createDesktopDataLayer } from "../data-source.ts"
import { applyRuntimeSettings, REFRESH_TIMEOUT_MS, withTimeout } from "../lib.ts"
import { PAGE_SIZE } from "../selectors.ts"
import type { DesktopState, StoreCtx } from "../types.ts"

type DataActions = Pick<
  DesktopState,
  "init" | "syncBrowserCookies" | "refresh" | "refreshAll" | "refreshIfStale" | "loadMore"
>

/** init 幂等(StrictMode 双 effect 用同一个 promise 去重)。 */
let initPromise: Promise<void> | null = null

export function createDataActions(ctx: StoreCtx): DataActions {
  const { set, get, refreshView, markItemsChanged, queryCanLoadMore, isRealSub } = ctx

  return {
    async init() {
      if (get().dl) return
      if (initPromise) return initPromise
      initPromise = (async () => {
        try {
          const dl = await createDesktopDataLayer({
            onSubscriptions: (subscriptions, groups) => {
              set({ subscriptions, groups })
              refreshView()
            },
            onSettings: (settings) => {
              set({ settings })
              applyRuntimeSettings(settings)
            },
            onStatus: (status) => {
              set({
                serviceOnline: status.online && status.events,
                serviceError: status.error ?? null,
              })
            },
          })
          const settings = await dl.settings.get()
          // 测试/演示订阅只在开发构建写入(空库才写)。代码在 dev/seed.ts 动态 import,
          // 生产构建里整个模块不会进包(发布版首启是空库,走 onboarding)。
          if (import.meta.env.DEV) {
            const { seedIfEmpty } = await import("../../dev/seed.ts")
            await seedIfEmpty(dl)
          }
          set({
            dl,
            initError: null,
            subscriptions: await dl.subscriptions.list(),
            groups: await dl.subscriptions.listGroups(),
            settings,
            openGroups: Object.fromEntries((await dl.subscriptions.listGroups()).map((g) => [g.id, true])),
          })
          // 把「图片隧道开关」同步到宿主门面(ui 的 MediaImage 直读,不经 React 树传参)。
          applyRuntimeSettings(settings)
          // 全量变更回调:条目/阅读态变化后重算视图（先失效 memo，再重算）。
          // `progress` 时条目对象是**原地**更新的：不换 allItems 身份（否则播放器整树
          // 每 5 秒重渲染一次），只 bump progressVersion 让依赖进度的派生视图重算；
          // 「继续」视图的成员与排序都由进度字段决定，必须连 view 一起重算。
          // 已知上限：其它列表里的卡片进度条不在播放期间实时刷新（下次渲染/切节点时更新）。
          dl.store.subscribe((change) => {
            if (change === "progress") {
              set((s) => ({ progressVersion: s.progressVersion + 1 }))
              if (get().selectedNodeId === "tab:resume") refreshView({ keepItems: true })
              return
            }
            markItemsChanged()
            refreshView()
          })
          refreshView()
          // 刷新后恢复的选中节点(router /v/:id)在 dl 就绪前 select 会跳过 canLoadMore——补查。
          const nodeId = get().selectedNodeId
          if (isRealSub(nodeId)) queryCanLoadMore(nodeId)
          // 首屏 TTL 刷新**不阻塞 ready**:快照 + 缓存已可显示(有内容即收骨架);
          // TTL 过期的订阅在后台抓取(顶栏 loading 转圈),完成后事件回流自然重绘。
          // 空库首启由 showSkeleton 第二段(「空库且在抓」)继续盖骨架 ——
          // refreshAll 的同步段先置 loading,ready 置位时骨架判定已正确接管。
          void get().refreshAll(false)
          set({ ready: true })
        } catch (e) {
          // 初始化失败(宿主未注入 / 库损坏):置错误态由 App 渲染错误页,不让整页白屏。
          // 允许重试:清掉 initPromise 让下次 init() 重新走一遍。
          initPromise = null
          // ready 也要给出去:失败页是真内容,再压在骨架下面用户就看不到错误了。
          set({ initError: e instanceof Error ? e.message : String(e), ready: true })
        }
        // 首屏落稳后把 settings 的登录 cookie 快照对齐到抓取浏览器(扫码只写一次,
        // 浏览器会随访问轮换)。⚠️ 不 await、不放进 try:冷启动 WebView2 失败不能把
        // 可用的应用变成 initError 错误页;延迟 1.5s 避免与首屏渲染/首轮刷新抢主线程。
        if (!get().initError) {
          setTimeout(() => {
            if (!get().initError) void get().syncBrowserCookies()
          }, 1_500)
        }
      })()
      return initPromise
    },

    async syncBrowserCookies() {
      const dl = get().dl
      // 离线模式不拉起浏览器;init 失败(dl 为空)也跳过。
      if (!dl || get().offline) return
      try {
        const fields = await dl.syncBrowserCookies()
        // 有写入才重读整份 settings:不要用「同步结果」当 patch 覆盖用户刚保存的凭证。
        if (fields.length) set({ settings: await dl.settings.get() })
      } catch (e) {
        // 后台任务:浏览器/CDP 起不来不能影响应用,也不弹 toast。
        console.warn("[cookie-sync]", e)
      }
    },

    async refresh(id, opts) {
      const dl = get().dl
      if (!dl) return
      if (get().offline) {
        get().toast("warn", "离线模式", "已跳过网络抓取;显示的是本地缓存内容。")
        return
      }
      set((s) => ({ busy: { ...s.busy, [id]: true } }))
      // ⚠️ try/finally:dl.refresh 抛错(存储损坏/宿主未注入)时若不清 busy,该订阅
      // health 会**永久停在 busy**(转圈不消失),只能重启应用恢复。
      try {
        // 手动「刷新当前」默认 force(用户显式点刷 = 期望最新);自动补刷传
        // force:false 走 TTL 缓存(core 侧未过期零网络)。超时与 refreshAll 同款,
        // 防单条永挂让 busy 转圈不落。
        const force = opts?.force !== false
        const result = await withTimeout(dl.refresh(id, { force }), REFRESH_TIMEOUT_MS, id)
        const total = dl.totalOf(id)
        const title = get().subscriptions.find((s) => s.id === id)?.title ?? id
        set((s) => {
          const busy = { ...s.busy }
          delete busy[id]
          return {
            busy,
            // TTL 判定用缓存 fetchedAt(命中缓存时它早于 now),不是当下时间。
            ...(result.error ? {} : { fetchedAt: { ...s.fetchedAt, [id]: result.fetchedAt } }),
            ...(total !== undefined ? { totals: { ...s.totals, [id]: total } } : {}),
            loadMoreEnded: result.error ? s.loadMoreEnded : { ...s.loadMoreEnded, [id]: false },
            // ⚠️ 首屏可能超过 PAGE_SIZE(xhs:explore 实测 89 条):本地窗口初始只有 60,
            // 而渠道分页只按 addedCount 增长窗口 —— 首屏就存在的缺口永远不会被补上
            // (尾部 29 条不可见、footer 却报「已加载全部」)。刷新拿到新首页后把窗口
            // 抬到至少覆盖它(用户翻过的更大窗口保留)。
            // ⚠️ 默认窗口是 PAGE_SIZE,不是 0:停用订阅的 refresh 不抓取(停用路径返回
            // itemCount 0),用 0 当种子会把 page[id] 写成 0 → slice(0,0) 清空整个视图。
            page: result.error ? s.page : { ...s.page, [id]: Math.max(s.page[id] || PAGE_SIZE, result.itemCount) },
            refreshErrors: result.error
              ? { ...s.refreshErrors, [id]: result.error }
              : (() => {
                  const next = { ...s.refreshErrors }
                  delete next[id]
                  return next
                })(),
            refreshErrorKinds: result.error
              ? { ...s.refreshErrorKinds, [id]: result.errorKind ?? errorKindOf(result.error) }
              : (() => {
                  const next = { ...s.refreshErrorKinds }
                  delete next[id]
                  return next
                })(),
          }
        })
        if (result.error) {
          const kind = result.errorKind ?? errorKindOf(result.error)
          const label = kind === "unknown" ? "刷新失败" : ERROR_KIND_LABEL[kind]
          get().toast("error", `${label}：${title}`, `${result.error}\n旧缓存已保留展示,不会出现内容空窗。`)
        } else if (!opts?.silent) {
          // 只有手动刷新(force)会到这里 —— 自动补刷恒 silent。
          // 停用订阅例外:core 对 enabled=false 不抓取只回缓存,别宣称「已强制重新抓取」。
          const disabled = get().subscriptions.find((s) => s.id === id)?.enabled === false
          get().toast(
            "ok",
            `已更新 ${title}`,
            disabled
              ? `${result.itemCount} 条。订阅已停用,展示的是缓存内容。`
              : `${result.itemCount} 条。已强制重新抓取,绕过内容缓存。`,
          )
        }
      } catch (e) {
        const title = get().subscriptions.find((s) => s.id === id)?.title ?? id
        const kind = errorKindOf(e)
        const label = kind === "unknown" ? "刷新失败" : ERROR_KIND_LABEL[kind]
        get().toast("error", `${label}：${title}`, e instanceof Error ? e.message : String(e))
      } finally {
        set((s) => {
          const busy = { ...s.busy }
          delete busy[id]
          return { busy }
        })
        refreshView()
      }
    },

    async refreshAll(force = true) {
      const dl = get().dl
      if (!dl) return
      if (get().offline) {
        get().toast("warn", "离线模式", "已跳过网络抓取;显示的是本地缓存内容。")
        return
      }
      // 重入防护:刷新按钮在 loading 期间未禁用(顶栏 chip / rail 刷新键),连点会并发
      // 发起多轮全量抓取 —— 反爬源被打 + 界面状态互相覆盖。
      if (get().loading) return
      // ⚠️ 先声明 loading 再读订阅列表:① 手动刷新点击即反馈;② init 的后台首轮
      // 刷新在**同步段**就置位 —— ready 先行置位时,showSkeleton 第二段(「空库且
      // 在抓」)能正确接管,不会闪一帧空视图再盖回骨架。
      set({ loading: true })
      const errors: Record<string, string> = {}
      const kinds: Record<string, ErrorKind> = {}
      type RefreshOutcome = Awaited<ReturnType<typeof dl.refresh>>
      let results: PromiseSettledResult<RefreshOutcome>[] = []
      let subs: Awaited<ReturnType<typeof dl.subscriptions.list>> = []
      try {
        try {
          subs = await dl.subscriptions.list()
        } catch (e) {
          // 列表都读不到(服务断连):断线状态由 WS 层的横幅负责,这里不 toast 不抛
          // (finally 仍会清 loading/busy)。
          console.warn("[refreshAll] subscriptions.list failed", e)
          return
        }
        set({ busy: Object.fromEntries(subs.map((s) => [s.id, true])) })
        // ⚠️ 必须 allSettled + 逐条超时 + finally:
        //   - 用 Promise.all 时,任一 reject 会让下面的 set({loading:false}) **永不执行**
        //     → 顶栏「更新中」永久转圈(且 Promise.all 会丢结果,其余订阅的白抓);
        //   - 任一 promise 永不 settle(如服务 RPC 无响应)同样卡死整轮。
        // 逐条超时把「无限等待」变成「这一条报错」,finally 保证 loading 一定落回。
        // 超时同时 abort 该条抓取:远端模式下 signal 会转成 job cancel（服务端真停），
        // 本地回退模式下 core 丢弃在途结果。浏览器 lane 的取消归服务。
        const controllers = subs.map(() => new AbortController())
        results = await Promise.allSettled(
          subs.map((s, i) => {
            const ac = controllers[i]!
            return withTimeout(dl.refresh(s.id, { force, signal: ac.signal }), REFRESH_TIMEOUT_MS, s.id, () =>
              ac.abort(),
            )
          }),
        )
        results.forEach((r, i) => {
          const id = subs[i]!.id
          if (r.status === "fulfilled") {
            if (r.value.error) {
              errors[id] = r.value.error
              kinds[id] = r.value.errorKind ?? errorKindOf(r.value.error)
            }
          } else {
            errors[id] = r.reason instanceof Error ? r.reason.message : String(r.reason)
            kinds[id] = errorKindOf(r.reason)
          }
        })
      } finally {
        // ⚠️ 清 loadMoreEnded:refreshAll 抓的是**新首页**(core 侧 pageCursors 已重置),
        // 该订阅又可以被翻页了。不清的话,曾翻到底(loadMoreEnded[id]=true)的源在 refreshAll
        // 后仍显示「已加载全部」→ LoadMoreFooter 的 ended 恒 true、MasonryGrid 的自动翻页
        // 恒 false,新内容翻不出来。与 refresh(id) 成功路径对称(该处已在 :466 清)。
        const clearedEnded = { ...get().loadMoreEnded }
        for (const s of subs) clearedEnded[s.id] = false
        // ⚠️ 本地窗口抬到至少覆盖新首屏(同 refresh(id):首屏可能超过 PAGE_SIZE,
        // 渠道分页只按 addedCount 增长窗口,首屏缺口永远补不上)。
        const page = { ...get().page }
        const fetchedAt = { ...get().fetchedAt }
        for (let i = 0; i < subs.length; i++) {
          const r = results[i]
          if (r?.status !== "fulfilled" || r.value.error) continue
          const id = subs[i]!.id
          // 同上:停用/无缓存订阅返回 itemCount 0,不能把窗口压到 0。
          page[id] = Math.max(page[id] || PAGE_SIZE, r.value.itemCount)
          fetchedAt[id] = r.value.fetchedAt
        }
        set({
          loading: false,
          busy: {},
          refreshErrors: errors,
          refreshErrorKinds: kinds,
          loadMoreEnded: clearedEnded,
          page,
          fetchedAt,
        })
      }
      const failed = Object.keys(errors).length
      const authCount = Object.values(kinds).filter((k) => k === "auth").length
      get().toast(
        failed ? "warn" : "ok",
        failed ? `刷新完成，${failed} 条失败` : "刷新完成",
        failed
          ? `失败的订阅:${Object.keys(errors)
              .map((id) => subs.find((s) => s.id === id)?.title ?? id)
              .join("、")}。${authCount ? `其中 ${authCount} 条需要登录。` : ""}已保留旧缓存,rail 上有告警标记。`
          : `${subs.length} 条订阅已更新。`,
      )
      refreshView()
    },

    /**
     * 选中过期订阅时的自动补刷(select 钩子调):
     *   - 内容**照常展示**(缓存镜像立即渲染,不盖骨架),仅 busy 加转圈;
     *   - TTL 判定在本地做(`contentTtlMs` + `fetchedAt`):TTL 内零调用;
     *     `fetchedAt` 未知(启动后未刷过)仍调一次 —— core 的 TTL 短路兜底,
     *     未过期时零网络、毫秒级返回;
     *   - 尊重 autoRefresh(关 = 非手动刷新不发网络)与停用订阅;全量刷新
     *     (loading)或该条在刷(busy)时不叠加。
     */
    refreshIfStale(id) {
      const dl = get().dl
      if (!dl || get().offline || get().loading || get().busy[id]) return
      const settings = get().settings
      const sub = get().subscriptions.find((s) => s.id === id)
      if (!sub || sub.enabled === false || settings?.autoRefresh === false) return
      if (settings) {
        const at = get().fetchedAt[id]
        if (at !== undefined && Date.now() - at < contentTtlMs(sub, settings)) return
      }
      // silent:成功不 toast(用户没主动要刷新);失败 toast + refreshErrors → rail 告警。
      void get().refresh(id, { force: false, silent: true })
    },

    async loadMore() {
      const dl = get().dl
      const id = get().selectedNodeId
      // 重入防护:按钮点击 + 触底 IO 可能同时触发。
      if (!dl || !id || !isRealSub(id) || get().loadingMore) return
      set({ loadingMore: true })
      try {
        // ⚠️ 微博一页只有 10–20 条:一次触底只翻一页,快速滚动立刻「滚出 buffer」
        // (列表见底空白 / 回弹)。小页渠道连翻到 ≥20 条(最多 3 页);xhs 一页 20–30、
        // bili 一页 20+,一轮即止 —— 不为了凑数多打请求(风控/耗时都在请求上)。
        let added = 0
        let hasMore = false
        for (let round = 0; round < 3; round++) {
          const r = await dl.loadMore(id)
          added += r.addedCount
          hasMore = !!r.hasMore
          if (!hasMore || added >= 20) break
        }
        const total = dl.totalOf(id)
        // ⚠️ 必须同时**放开本地窗口**(page[id] += 本轮新增):渠道翻页把新条目 append
        // 进 store,但 view.list 被 page[id](初始 PAGE_SIZE=60)切片 → 新追加的看不见,
        // 用户点「加载更多」页面毫无变化(只是多抓了一次网络)。LoadingMoreFooter 在
        // 渠道分页时不会走 localPaging(那是二选一),所以必须在这里同步放窗口。
        set((s) => ({
          loadingMore: false,
          page: { ...s.page, [id]: (s.page[id] || PAGE_SIZE) + added },
          ...(total !== undefined ? { totals: { ...s.totals, [id]: total } } : {}),
          loadMoreEnded: hasMore ? s.loadMoreEnded : { ...s.loadMoreEnded, [id]: true },
        }))
        refreshView()
      } catch (e) {
        // 翻页失败(如小红书风控验证码)写入 refreshErrors → 顶栏活性点红。
        set((s) => ({
          loadingMore: false,
          refreshErrors: { ...s.refreshErrors, [id]: e instanceof Error ? e.message : String(e) },
        }))
      }
    },
  }
}
