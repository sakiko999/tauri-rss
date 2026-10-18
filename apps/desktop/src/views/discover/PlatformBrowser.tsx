/**
 * PlatformBrowser —— 发现页的「分区浏览 / 搜索 / 搜主播」面板。
 *
 * 从 DiscoverPage 拆出。走 core `previewChannel(channelKey, info)` 取一次**真实数据**
 * (不建订阅);结果用与「添加订阅」**同一套候选行**(CandidateList：label/sub/meta
 * 一行看全)，选中后可直接订阅一个房间，或把整个查询词设为订阅。
 *
 * ⚠️ 三种视图的返回都是 live item(roomId 已由 tpl:roomId/URL 还原)，所以统一走
 * `candidatesFromSearch`；不再用 CardMini 网格(信息少、还要再点进弹窗才能订阅)。
 */
import { useEffect, useMemo, useState } from "react"
import type { ChannelInfo, MediaItem } from "@amoeba/core"
import { useDesktop } from "../../store/index.ts"
import { Icon } from "../../components/Icon.tsx"
import { Banner, StateBlock } from "../../components/StateBlock.tsx"
import { AddSubscriptionDialog } from "../manage/AddSubscriptionDialog.tsx"
import { CandidateList } from "../manage/AddPanels.tsx"
import { useLatestOnly } from "../../lib/useLatestOnly.ts"
import { isImeComposing } from "../../lib/ime.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import {
  candidatesFromSearch,
  LIVE_SUB_CHANNEL,
  subsOfChannel,
  valueList,
  type Candidate,
} from "../../lib/subscriptions.ts"
import { VIEW_LABEL, type Cap } from "./platforms.ts"

export function PlatformBrowser({
  platform,
  platforms,
  caps,
  view,
  onView,
  onPickPlatform,
}: {
  platform: string
  /** 只传有分区/搜索能力的平台（能力矩阵同源过滤）。 */
  platforms: Array<{ id: string; label: string }>
  caps: Record<Cap, ChannelInfo | undefined>
  view: Cap
  onView: (v: Cap) => void
  onPickPlatform: (id: string) => void
}) {
  const dl = useDesktop((s) => s.dl)
  const subscriptions = useDesktop((s) => s.subscriptions)
  const addSubscription = useDesktop((s) => s.addSubscription)
  const channels = useMemo(() => dl?.listChannels() ?? [], [dl])
  const [categoryValue, setCategoryValue] = useState("")
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState(false)
  const [subscribing, setSubscribing] = useState(false)
  const [error, setError] = useState("")
  const [items, setItems] = useState<MediaItem[] | null>(null)
  /** 选中的候选值(= roomId / videoId)。 */
  const [selected, setSelected] = useState("")
  const [subscribeKey, setSubscribeKey] = useState<string | undefined>()
  const [subscribeInfo, setSubscribeInfo] = useState<Record<string, string>>({})
  const [dialogOpen, setDialogOpen] = useState(false)
  /** 请求世代守卫(见 lib/useLatestOnly.ts):切平台/切视图/新搜索都作废在途请求。 */
  const latest = useLatestOnly()
  const ch = view === "category" ? caps.category : view === "anchor" ? caps.anchor : caps.search

  // ⚠️ 切平台/切视图也要作废在途请求:只 setItems(null) 挡不住 —— 旧响应回来时
  // 世代仍相等会覆盖成上一个平台的数据(c4aab55 只覆盖了「被新 run 取代」)。
  // props 变化作废 + 清结果,覆盖所有切换路径(含父组件能力矩阵按钮)。
  useEffect(() => {
    latest.invalidate()
    setItems(null)
    setError("")
    setBusy(false) // 在途请求的 finally 因世代不符不再清 busy → 这里补，否则按钮卡禁用
    setSelected("")
  }, [platform, view, latest])

  async function run() {
    if (!dl || !ch) return
    const gen = latest.start()
    setBusy(true)
    setError("")
    setSelected("")
    const info: Record<string, string> = {}
    // 参数名来自渠道的 sourceInfoTpl(不硬编码字段名)。
    const fields = ch.sourceInfoTpl ?? []
    if (fields[0]) info[fields[0].key] = view === "category" ? categoryValue : q
    try {
      const r = await dl.previewChannel(ch.key, info)
      if (latest.stale(gen)) return // 已被更新的请求取代,丢弃(否则面板显示上一个平台的数据)
      setItems(r.items)
    } catch (e) {
      if (latest.stale(gen)) return
      setError(e instanceof Error ? e.message : String(e))
      setItems(null)
    } finally {
      if (!latest.stale(gen)) setBusy(false)
    }
  }

  const fields = ch?.sourceInfoTpl ?? []

  /** 结果 → 候选(与「添加订阅」同一套提取:只留带 roomId 的 live 条目)。 */
  const cands = useMemo(() => candidatesFromSearch(items ?? []), [items])

  /** 落地的订阅渠道 = 平台的 live 订阅渠道(roomIds/videoId 单值)。 */
  const subKey = LIVE_SUB_CHANNEL[platform]
  const subCh = channels.find((c) => c.key === subKey)
  const landParam = subCh?.sourceInfoTpl?.[0]?.key
  const subscribed = useMemo(
    () => new Set(subsOfChannel(subscriptions, subKey).flatMap((s) => valueList(s, landParam))),
    [subscriptions, subKey, landParam],
  )
  const selectedCand = cands.find((c) => c.value === selected)

  function pickCandidate(c: Candidate) {
    setSelected((prev) => (prev === c.value ? "" : c.value))
  }

  /** 一步订阅选中的房间(标题取候选标题,分组/刷新间隔走默认)。 */
  async function subscribeSelected() {
    if (!selectedCand || !subKey || !landParam || subscribed.has(selectedCand.value)) return
    setSubscribing(true)
    try {
      const id = await addSubscription(subKey, selectedCand.label, { [landParam]: selectedCand.value })
      if (!id) throw new Error("数据层未初始化")
      setSelected("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubscribing(false)
    }
  }

  return (
    <section className="section" {...overlayBlock("platform-browser", "discover:browser")}>
      <div className="section-head">
        <h2 className="section-title">分区浏览与搜索</h2>
        <span className="section-desc">取真实数据，不写进订阅列表；选中候选可直接订阅</span>
      </div>

      <div className="chip-row" style={{ marginBottom: "var(--sp-4)" }}>
        {platforms.map((p) => (
          <button
            key={p.id}
            className="chip"
            aria-pressed={platform === p.id}
            onClick={() => {
              onPickPlatform(p.id)
              setItems(null)
              setSelected("")
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="segmented" style={{ marginBottom: "var(--sp-4)" }}>
        {caps.category ? (
          <button
            aria-pressed={view === "category"}
            onClick={() => {
              onView("category")
              setItems(null) // 换视图清旧结果,否则「分区」的数据留在「搜索」视图里、标注对不上
              setSelected("")
            }}
          >
            分区
          </button>
        ) : null}
        {caps.search ? (
          <button
            aria-pressed={view === "search"}
            onClick={() => {
              onView("search")
              setItems(null)
              setSelected("")
            }}
          >
            搜索
          </button>
        ) : null}
        {caps.anchor ? (
          <button
            aria-pressed={view === "anchor"}
            onClick={() => {
              onView("anchor")
              setItems(null)
              setSelected("")
            }}
          >
            搜主播
          </button>
        ) : null}
      </div>

      {!ch ? (
        <Banner tone="warn" icon="warning">
          {platform} 当前没有「{VIEW_LABEL[view]}」渠道。
        </Banner>
      ) : (
        <div className="inline-row" style={{ marginBottom: "var(--sp-4)" }}>
          <input
            className="input input-wide"
            value={view === "category" ? categoryValue : q}
            placeholder={fields[0]?.placeholder ?? fields[0]?.label ?? "参数"}
            aria-label={fields[0]?.label ?? "参数"}
            onChange={(e) => {
              const v = e.target.value
              if (view === "category") setCategoryValue(v)
              else setQ(v)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isImeComposing(e)) void run()
            }}
          />
          <button className="btn btn-primary" disabled={busy} onClick={() => void run()}>
            {busy ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="search" size={14} />} 取数据
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setSubscribeKey(ch.key)
              const info: Record<string, string> = {}
              if (fields[0]) info[fields[0].key] = view === "category" ? categoryValue : q
              setSubscribeInfo(info)
              setDialogOpen(true)
            }}
          >
            <Icon name="plus" size={14} /> 订阅该{VIEW_LABEL[view]}
          </button>
        </div>
      )}

      {error ? <Banner tone="error" icon="alert">{error}</Banner> : null}

      {items ? (
        cands.length === 0 ? (
          <StateBlock
            icon="inbox"
            tight
            title="没有可订阅的条目"
            text={
              items.length === 0
                ? "换个参数再试；若渠道需要登录，先去「账号与凭证」。"
                : "返回的条目没有可用的房间号。"
            }
          />
        ) : (
          <>
            <CandidateList
              cands={cands}
              shown={cands}
              candidateValue={selected}
              onPick={pickCandidate}
              subscribed={subscribed}
              platform={platform}
            />
            {/* 选中后的操作条 sticky 在视口底部:候选可能有几十条,按钮不能跟着列表
                滚出屏幕(否则「选中→订阅」要再翻回去找按钮)。 */}
            {selectedCand ? (
              <div className="pick-action">
                <span className="t-small t-muted od-truncate">已选中「{selectedCand.label}」</span>
                {subKey && landParam ? (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={subscribing || subscribed.has(selectedCand.value)}
                    onClick={() => void subscribeSelected()}
                  >
                    {subscribing ? (
                      <Icon name="loader" size={13} className="animate-spin" />
                    ) : (
                      <Icon name="plus" size={13} />
                    )}
                    {subscribed.has(selectedCand.value) ? "已订阅" : "订阅这个房间"}
                  </button>
                ) : (
                  <span className="t-micro t-dim">该平台没有可直接落地为订阅的直播渠道</span>
                )}
              </div>
            ) : null}
          </>
        )
      ) : null}

      <AddSubscriptionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        presetKey={subscribeKey}
        presetInfo={subscribeInfo}
      />
    </section>
  )
}
