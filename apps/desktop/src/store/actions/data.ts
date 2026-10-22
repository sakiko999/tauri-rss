/**
 * 数据动作:init / refresh / refreshAll / loadMore。
 *
 * 从 store/index.ts 拆出;只依赖 StoreCtx + core 的 DataLayer。
 */
import { createDataLayer } from "@amoeba/core"
import { PAGE_SIZE } from "../selectors.ts"
import { applyRuntimeSettings, REFRESH_TIMEOUT_MS, withTimeout } from "../lib.ts"
import type { DesktopState, StoreCtx } from "../types.ts"

type DataActions = Pick<DesktopState, "init" | "syncBrowserCookies" | "refresh" | "refreshAll" | "loadMore">

/** init 幂等(StrictMode 双 effect 用同一个 promise 去重)。 */
let initPromise: Promise<void> | null = null

export function createDataActions(ctx: StoreCtx): DataActions {
  const { set, get, refreshView, queryCanLoadMore, isRealSub } = ctx

  return {
    async init() {
      if (get().dl) return
      if (initPromise) return initPromise
      initPromise = (async () => {
        try {
          const dl = createDataLayer()
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
          // 全量变更回调:条目/阅读态变化后重算视图。
          dl.store.subscribe(() => refreshView())
          refreshView()
          // 刷新后恢复的选中节点(router /v/:id)在 dl 就绪前 select 会跳过 canLoadMore——补查。
          const nodeId = get().selectedNodeId
          if (isRealSub(nodeId)) queryCanLoadMore(nodeId)
          // init 自动刷新走 TTL 缓存(命中零网络,启动秒开)。
          await get().refreshAll(false)
          // ⚠️ ready 放在**最后**:此时首轮刷新已跑完(`loading` 已落回 false)、
          // items 也已就位,`showSkeleton` 一步从 true 变 false —— 全程只翻转一次。
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
        // 手动「刷新当前」→ 强制绕过 TTL(用户显式点刷 = 期望最新)。
        const result = await dl.refresh(id, { force: true })
        const total = dl.totalOf(id)
        const title = get().subscriptions.find((s) => s.id === id)?.title ?? id
        set((s) => {
          const busy = { ...s.busy }
          delete busy[id]
          return {
            busy,
            ...(total !== undefined ? { totals: { ...s.totals, [id]: total } } : {}),
            loadMoreEnded: result.error ? s.loadMoreEnded : { ...s.loadMoreEnded, [id]: false },
            // ⚠️ 首屏可能超过 PAGE_SIZE(xhs:explore 实测 89 条):本地窗口初始只有 60,
            // 而渠道分页只按 addedCount 增长窗口 —— 首屏就存在的缺口永远不会被补上
            // (尾部 29 条不可见、footer 却报「已加载全部」)。刷新拿到新首页后把窗口
            // 抬到至少覆盖它(用户翻过的更大窗口保留)。
            // ⚠️ 默认窗口是 PAGE_SIZE,不是 0:停用订阅的 refresh 不抓取(停用路径返回
            // itemCount 0),用 0 当种子会把 page[id] 写成 0 → slice(0,0) 清空整个视图。
            page: result.error
              ? s.page
              : { ...s.page, [id]: Math.max(s.page[id] || PAGE_SIZE, result.itemCount) },
            refreshErrors: result.error
              ? { ...s.refreshErrors, [id]: result.error }
              : (() => {
                  const next = { ...s.refreshErrors }
                  delete next[id]
                  return next
                })(),
          }
        })
        if (result.error) {
          get().toast("error", `刷新失败：${title}`, `${result.error}\n旧缓存已保留展示,不会出现内容空窗。`)
        } else if (!opts?.silent) {
          // 手动刷新是 force 的,必然走网络 —— 旧文案「未发起网络请求」与实际行为不符。
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
        get().toast("error", `刷新失败：${title}`, e instanceof Error ? e.message : String(e))
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
      const subs = await dl.subscriptions.list()
      set({ loading: true, busy: Object.fromEntries(subs.map((s) => [s.id, true])) })
      const errors: Record<string, string> = {}
      type RefreshOutcome = Awaited<ReturnType<typeof dl.refresh>>
      let results: PromiseSettledResult<RefreshOutcome>[] = []
      try {
        // ⚠️ 必须 allSettled + 逐条超时 + finally:
        //   - 用 Promise.all 时,任一 reject 会让下面的 set({loading:false}) **永不执行**
        //     → 顶栏「更新中」永久转圈(且 Promise.all 会丢结果,其余订阅的白抓);
        //   - 任一 promise 永不 settle(如 browser 通道 invoke 无超时)同样卡死整轮。
        // 逐条超时把「无限等待」变成「这一条报错」,finally 保证 loading 一定落回。
        results = await Promise.allSettled(
          subs.map((s) =>
            withTimeout(dl.refresh(s.id, { force }), REFRESH_TIMEOUT_MS, s.id, () => {
              // 超时中止在途调用,让持 lane 锁的 await 立刻返回错误,锁得以释放。
              // ⚠️ **只对浏览器路径的订阅中止**(与旧行为一致):abortTabs 断的是
              // 所有非登录 lane 的连接,一个非浏览器订阅(慢 HTTP 抓取)超时不该
              // 掐断别的订阅正在跑的浏览器抓取。
              // 登录 lane 由 keepLogin 豁免(登录在等用户扫码,掐了会表现成
              // 「手机已确认但登录超时」)——旧 scanLoginActive 布尔退役。
              if (/^(weibo|xhs):/.test(s.channelKey)) {
                globalThis.appHost.browser?.abortTabs?.(`刷新超时:${s.id}`, { keepLogin: true })
              }
            }),
          ),
        )
        results.forEach((r, i) => {
          const id = subs[i]!.id
          if (r.status === "fulfilled") {
            if (r.value.error) errors[id] = r.value.error
          } else {
            errors[id] = r.reason instanceof Error ? r.reason.message : String(r.reason)
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
        for (let i = 0; i < subs.length; i++) {
          const r = results[i]
          if (r?.status !== "fulfilled" || r.value.error) continue
          const id = subs[i]!.id
          // 同上:停用/无缓存订阅返回 itemCount 0,不能把窗口压到 0。
          page[id] = Math.max(page[id] || PAGE_SIZE, r.value.itemCount)
        }
        set({ loading: false, busy: {}, refreshErrors: errors, loadMoreEnded: clearedEnded, page })
      }
      const failed = Object.keys(errors).length
      get().toast(
        failed ? "warn" : "ok",
        failed ? `刷新完成，${failed} 条失败` : "刷新完成",
        failed
          ? `失败的订阅:${Object.keys(errors)
              .map((id) => subs.find((s) => s.id === id)?.title ?? id)
              .join("、")}。已保留旧缓存,rail 上有告警标记。`
          : `${subs.length} 条订阅已更新。`,
      )
      refreshView()
    },

    async loadMore() {
      const dl = get().dl
      const id = get().selectedNodeId
      // 重入防护:按钮点击 + 触底 IO 可能同时触发。
      if (!dl || !id || !isRealSub(id) || get().loadingMore) return
      set({ loadingMore: true })
      try {
        const r = await dl.loadMore(id)
        const total = dl.totalOf(id)
        // ⚠️ 必须同时**放开本地窗口**(page[id] += 本页新增):渠道翻页把新条目 append
        // 进 store,但 view.list 被 page[id](初始 PAGE_SIZE=60)切片 → 新追加的看不见,
        // 用户点「加载更多」页面毫无变化(只是多抓了一次网络)。LoadingMoreFooter 在
        // 渠道分页时不会走 localPaging(那是二选一),所以必须在这里同步放窗口。
        set((s) => ({
          loadingMore: false,
          page: { ...s.page, [id]: (s.page[id] || PAGE_SIZE) + r.addedCount },
          ...(total !== undefined ? { totals: { ...s.totals, [id]: total } } : {}),
          loadMoreEnded: r.hasMore ? s.loadMoreEnded : { ...s.loadMoreEnded, [id]: true },
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
