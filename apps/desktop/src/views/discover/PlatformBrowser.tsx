/**
 * PlatformBrowser —— 发现页的「搜主播」面板。
 *
 * 从 DiscoverPage 拆出。走 core `previewChannel(channelKey, info)` 取一次**真实数据**
 * (不建订阅);结果用与「添加订阅」**同一套候选行**(CandidateList：label/sub/meta
 * 一行看全)，选中后可直接订阅一个房间，或把整个查询词设为订阅。
 *
 * ⚠️ 2026-11-01 起只剩「搜主播」：分区浏览（`*:category`）与房间搜索
 * （`*:search`）渠道已删除 —— 它们只适合一次性检索，作为订阅反复产出同一批房间没有价值。
 *
 * ⚠️ 返回是 live item(roomId 已由 tpl:roomId/URL 还原)，统一走
 * `candidatesFromSearch`；不用 CardMini 网格(信息少、还要再点进弹窗才能订阅)。
 */

import type { ChannelInfo, MediaItem } from "@amoeba/core"
import { useEffect, useMemo, useState } from "react"

import { Button } from "../../components/Button.tsx"
import { Icon } from "../../components/Icon.tsx"
import { Banner, StateBlock } from "../../components/StateBlock.tsx"
import { isImeComposing } from "../../lib/ime.ts"
import {
  type Candidate,
  candidatesFromSearch,
  LIVE_SUB_CHANNEL,
  subsOfChannel,
  valueList,
} from "../../lib/subscriptions.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { useLatestOnly } from "../../lib/useLatestOnly.ts"
import { useDesktop } from "../../store/index.ts"
import { CandidateList } from "../manage/AddPanels.tsx"
import { AddSubscriptionDialog } from "../manage/AddSubscriptionDialog.tsx"
import type { Cap } from "./platforms.ts"

export function PlatformBrowser({
  platform,
  platforms,
  caps,
  view,
  onPickPlatform,
}: {
  platform: string
  /** 只传有搜主播能力的平台（能力矩阵同源过滤）。 */
  platforms: Array<{ id: string; label: string }>
  caps: Record<Cap, ChannelInfo | undefined>
  view: Cap
  onPickPlatform: (id: string) => void
}) {
  const dl = useDesktop((s) => s.dl)
  const subscriptions = useDesktop((s) => s.subscriptions)
  const addSubscription = useDesktop((s) => s.addSubscription)
  const channels = useMemo(() => dl?.listChannels() ?? [], [dl])
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
  const ch = caps[view]
  /** 参数名/标签全部来自渠道的 sourceInfoTpl（不硬编码字段名）。 */
  const fields = ch?.sourceInfoTpl ?? []

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

  /** 当前手输参数:搜主播是单关键词。 */
  function inputInfo(): Record<string, string> {
    return fields[0] ? { [fields[0].key]: q } : {}
  }

  async function run() {
    if (!dl || !ch) return
    // ⚠️ 必填参数要在这里校验:空值被丢掉后渠道会用**默认值**兜底(如抖音
    // partitionType 回落 1,而 101 是顶层分区应为 4)→ 上游返回空 → 界面只说
    // 「该分区当前没有内容」,用户根本不知道是自己少填了一项。
    // (「订阅该分区」走 AddSubscriptionDialog,那边本来就有 required 校验。)
    const missing = fields[0]?.required && !q.trim() ? [fields[0]] : []
    if (missing.length) {
      setError(`请填写：${missing.map((f) => f.label).join("、")}`)
      setItems(null)
      return
    }
    const gen = latest.start()
    setBusy(true)
    setError("")
    setSelected("")
    try {
      const r = await dl.previewChannel(ch.key, inputInfo())
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

  /** 打开「订阅该分区」弹窗。 */
  function openSubscribe() {
    if (!ch) return
    setSubscribeKey(ch.key)
    setSubscribeInfo(inputInfo())
    setDialogOpen(true)
  }

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
        <h2 className="section-title">搜主播</h2>
        <span className="section-desc">预览，不写入订阅</span>
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

      {!ch ? (
        <Banner tone="warn" icon="warning">
          {platform} 当前没有搜主播渠道。
        </Banner>
      ) : (
        <div className="inline-row" style={{ marginBottom: "var(--sp-4)", flexWrap: "wrap" }}>
          {fields.map((f) => (
            <input
              key={f.key}
              className={fields.length > 1 ? "input" : "input input-wide"}
              value={q}
              placeholder={f.placeholder ?? f.label ?? "参数"}
              aria-label={f.label ?? "参数"}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isImeComposing(e)) void run()
              }}
            />
          ))}
          <Button disabled={busy} onClick={() => void run()}>
            {busy ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="search" size={14} />} 取数据
          </Button>
          <Button variant="secondary" onClick={openSubscribe}>
            <Icon name="plus" size={14} /> 订阅该关键词
          </Button>
        </div>
      )}

      {error ? (
        <Banner tone="error" icon="alert">
          {error}
        </Banner>
      ) : null}

      {items ? (
        cands.length === 0 ? (
          <StateBlock
            icon="inbox"
            tight
            title="没有可订阅的条目"
            text={
              items.length === 0 ? "换个参数再试；若渠道需要登录，先去「账号与凭证」。" : "返回的条目没有可用的房间号。"
            }
          />
        ) : (
          <>
            <CandidateList
              cands={cands}
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
                  <Button
                    size="sm"
                    disabled={subscribing || subscribed.has(selectedCand.value)}
                    onClick={() => void subscribeSelected()}
                  >
                    {subscribing ? (
                      <Icon name="loader" size={13} className="animate-spin" />
                    ) : (
                      <Icon name="plus" size={13} />
                    )}
                    {subscribed.has(selectedCand.value) ? "已订阅" : "订阅这个房间"}
                  </Button>
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
