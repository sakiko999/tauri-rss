/**
 * AddSubscriptionDialog —— 添加订阅弹窗(radix Dialog + 设计系统类名)。
 *
 * 结构对齐 new_desktop 的 addSubscriptionModal/channelForm:渠道按来源分组用 chip 选,
 * 选中后出渠道摘要 + 参数表单(必填校验)+ 标题 + 归入分组 + 独立刷新间隔。
 *
 * 渠道来自 core `dl.listChannels()`;参数表单由 `sourceInfoTpl` 动态渲染;
 * 带 `defaultInfo` 的渠道可一键订阅。提交走 store.addSubscription(内部
 * dl.addSubscription = add + refresh)。
 *
 * ⚠️ 两大块 JSX 已拆到同目录的 `AddPanels.tsx`(SearchPanel 搜索添加 / ChannelPanel
 * 按渠道配置);这里只留**表单状态与提交编排**。
 */
import { useEffect, useMemo, useState } from "react"
import type { MediaItem } from "@tauri-playground/core"
import { useDesktop } from "../../store/index.ts"
import { Modal, Select } from "../../components/Modal.tsx"
import { Icon } from "../../components/Icon.tsx"
import { Banner } from "../../components/StateBlock.tsx"
import {
  candidatesFromSearch,
  LIVE_SUB_CHANNEL,
  SEARCH_CHANNEL,
  searchChannelOf,
  subsOfChannel,
  valueList,
  type Candidate,
} from "../../lib/subscriptions.ts"
import { ChannelPanel, SearchPanel } from "./AddPanels.tsx"
import { useLatestOnly } from "../../lib/useLatestOnly.ts"

export function AddSubscriptionDialog({
  open,
  onOpenChange,
  presetKey,
  presetInfo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 发现页「订阅该分区/搜索词」预置渠道。 */
  presetKey?: string
  presetInfo?: Record<string, string>
}) {
  const dl = useDesktop((s) => s.dl)
  const addSubscription = useDesktop((s) => s.addSubscription)
  const updateSubscription = useDesktop((s) => s.updateSubscription)
  const groups = useDesktop((s) => s.groups)
  const subscriptions = useDesktop((s) => s.subscriptions)
  const toast = useDesktop((s) => s.toast)
  const refreshIntervalMin = useDesktop((s) => s.settings?.refreshIntervalMin)
  const channels = useMemo(() => dl?.listChannels() ?? [], [dl])

  const [mode, setMode] = useState<"search" | "manual">("search")
  /** 手工模式选中的渠道(搜索模式的订阅渠道由平台推导,不走这个)。 */
  const [channelKey, setChannelKey] = useState("")
  const [values, setValues] = useState<Record<string, string>>({})
  /** 搜索模式:选中的平台 + 关键词 + 接口返回的候选条目。 */
  const [platform, setPlatform] = useState("")
  const [keyword, setKeyword] = useState("")
  const [searchItems, setSearchItems] = useState<MediaItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  /** 搜索模式:从候选里选中的值('' = 未选,提交按钮禁用)。 */
  const [candidateValue, setCandidateValue] = useState("")
  /** 候选落到哪里:'new' = 新建订阅,否则 = 并入该订阅 id。 */
  const [targetId, setTargetId] = useState("new")
  const [filter] = useState("")
  const [title, setTitle] = useState("")
  const [groupId, setGroupId] = useState("")
  const [ttl, setTtl] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  /** 必填未填的参数 key(现场校验,提交前拦截)。 */
  const [missing, setMissing] = useState<string[]>([])
  /** 搜索请求世代守卫(见 lib/useLatestOnly.ts):切平台/新搜索/重开面板都作废在途搜索。 */
  const latest = useLatestOnly()

  // rss: 预制直链(rss:hn 等 36 条)在 desktop 隐藏 —— 它们是种子清单,列出来太噪。
  // ⚠️ 但 `rss:url`(通用直链)**必须放行**:它是「已知 URL 的任意 RSS」的唯一入口
  // (OPML 导入也落它)。原先把整个 `rss:` 前缀都滤掉,导致手动加外部 feed 无渠道可选。
  const builtins = channels.filter(
    (c) => !c.key.startsWith("rsshub:") && (!c.key.startsWith("rss:") || c.key === "rss:url"),
  )
  const rsshub = channels.filter((c) => c.key.startsWith("rsshub:"))
  const channel = channels.find((c) => c.key === channelKey)

  /** 有搜索渠道的平台(注册表里存在 SEARCH_CHANNEL 映射的 search 渠道)。 */
  const searchPlatforms = useMemo(
    () => Object.keys(SEARCH_CHANNEL).filter((p) => channels.some((c) => c.key === SEARCH_CHANNEL[p])),
    [channels],
  )
  /** 当前是否处于搜索添加(有平台可搜,且用户没切到手工)。 */
  const searchMode = mode === "search" && (searchPlatforms.length > 0 || !!presetKey)

  /** 搜索模式的渠道:search 渠道(取候选用)+ 订阅渠道(落地用)。 */
  const searchChKey = searchChannelOf(platform)
  const searchCh = channels.find((c) => c.key === searchChKey)
  const subChKey = LIVE_SUB_CHANNEL[platform] ?? ""
  const subCh = channels.find((c) => c.key === subChKey)

  /** 候选:搜索模式来自**接口返回**(candidatesFromSearch);手工模式为空。 */
  const cands = useMemo(() => (searchMode ? candidatesFromSearch(searchItems ?? []) : []), [searchMode, searchItems])
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? cands.filter((c) => `${c.label} ${c.value} ${c.sub}`.toLowerCase().includes(q)) : cands
  }, [cands, filter])

  /** 落地订阅的渠道(搜索模式 = 平台对应的 live 订阅渠道;手工模式 = 选中的渠道)。 */
  const landKey = searchMode ? subChKey : channelKey
  const landChannel = searchMode ? subCh : channel
  /** 落地渠道的参数名(搜索模式 = roomIds;手工模式 = 渠道首参)。 */
  const landParam = landChannel?.sourceInfoTpl?.[0]?.key
  /** 该落地渠道已有的订阅(搜索的「添加到」候选:新建,或并入其中一条)。 */
  const targets = useMemo(() => subsOfChannel(subscriptions, landKey), [subscriptions, landKey])
  /** 已订阅过的候选值(重复添加会得到两条相同订阅,先标出来)。 */
  const subscribed = useMemo(() => new Set(targets.flatMap((s) => valueList(s, landParam))), [targets, landParam])

  useEffect(() => {
    if (!open) return
    latest.invalidate() // 重开面板作废上一次会话的在途搜索
    setError("")
    setMissing([])
    setBusy(false)
    setGroupId("")
    setTtl("")
    setCandidateValue("")
    setTargetId("new")
    // 带预置渠道(从「发现」页订阅分区/搜索词)→ 直接进手工模式,预填参数。
    setMode(presetKey ? "manual" : "search")
    setKeyword("")
    setSearchItems(null)
    const key = presetKey ?? channels.find((c) => c.defaultInfo)?.key ?? channels[0]?.key ?? ""
    const ch = channels.find((c) => c.key === key)
    setChannelKey(key)
    setValues({ ...(ch?.defaultInfo ?? {}), ...(presetKey ? presetInfo : {}) })
    setTitle(ch?.name ?? "")
    // 搜索模式默认选中第一个可搜平台。
    const p = searchPlatforms[0] ?? ""
    setPlatform(p)
  }, [open, channels, searchPlatforms, presetKey, presetInfo])

  const fields = channel?.sourceInfoTpl ?? []

  /** 搜索模式:调平台 search 渠道拿候选(不建订阅,走 previewChannel)。 */
  async function runSearch() {
    if (!dl || !searchChKey || !keyword.trim()) return
    const gen = latest.start()
    setSearching(true)
    setError("")
    setCandidateValue("")
    setTitle("")
    try {
      const field = searchCh?.sourceInfoTpl?.[0]?.key ?? "keyword"
      const r = await dl.previewChannel(searchChKey, { [field]: keyword.trim() })
      if (latest.stale(gen)) return // 已被切平台/新搜索取代,丢弃
      setSearchItems(r.items)
    } catch (e) {
      if (latest.stale(gen)) return
      setError(e instanceof Error ? e.message : String(e))
      setSearchItems([])
    } finally {
      if (!latest.stale(gen)) setSearching(false)
    }
  }

  function pick(key: string) {
    const ch = channels.find((c) => c.key === key)
    setChannelKey(key)
    setValues({ ...(ch?.defaultInfo ?? {}) })
    setTitle(ch?.name ?? "")
    setMissing([])
    setCandidateValue("")
    setTargetId("new")
  }

  /** 切换搜索平台(清空上一平台的候选与选中)。 */
  function pickPlatform(p: string) {
    latest.invalidate() // 作废在途搜索,否则旧平台候选覆盖新面板
    setPlatform(p)
    setSearchItems(null)
    setCandidateValue("")
    setTargetId("new")
    setTitle("")
  }

  /** 选中/取消选中一个候选(再点一次 = 取消)。 */
  function pickCandidate(c: Candidate) {
    if (candidateValue === c.value) {
      setCandidateValue("")
      return
    }
    setCandidateValue(c.value)
    setTitle(c.label)
    // 重复只作提示(在 targetHint 里),不拦提交 —— 重复订阅是合法选择。
  }

  async function submit() {
    if (searchMode) {
      /* ── 搜索模式:把选中的房间落到平台的 live 订阅渠道 ─────────────── */
      if (!subChKey || !landParam) {
        setError("该平台没有对应的直播订阅渠道。")
        return
      }
      if (!candidateValue) {
        setError("请先搜索并选中一个房间。")
        return
      }
      setBusy(true)
      setError("")
      try {
        if (targetId !== "new") {
          const sub = targets.find((s) => s.id === targetId)
          if (!sub) throw new Error("目标订阅已不存在,可能刚刚被删除,请改选「新建订阅」。")
          const held = valueList(sub, landParam)
          if (held.includes(candidateValue)) {
            toast("info", "已经在该订阅里了", `「${sub.title}」中已有这个房间。`)
            onOpenChange(false)
            return
          }
          await updateSubscription(sub.id, { info: { ...sub.info, [landParam]: [...held, candidateValue].join(",") } })
          toast("ok", `已并入「${sub.title}」`, `${held.length + 1} 个房间，刷新后生效。`)
        } else {
          const info = { [landParam]: candidateValue }
          const id = await addSubscription(subChKey, title.trim() || candidateValue, info, {
            groupId: groupId || null,
            refreshIntervalSec: Number(ttl) > 0 ? Number(ttl) * 60 : undefined,
          })
          if (!id) throw new Error("数据层未初始化")
        }
        onOpenChange(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
      return
    }

    /* ── 手工模式:按渠道参数直接订阅 ─────────────────────────────────── */
    if (!channelKey || !channel) return
    setMissing([])
    setBusy(true)
    setError("")
    try {
      const miss = fields.filter((f) => f.required && !(values[f.key] ?? "").trim()).map((f) => f.key)
      if (miss.length) {
        setMissing(miss)
        return
      }
      const ttlMin = Number(ttl)
      const id = await addSubscription(channelKey, title.trim() || channel.name || channelKey, values, {
        groupId: groupId || null,
        refreshIntervalSec: ttlMin > 0 ? ttlMin * 60 : undefined,
      })
      if (!id) throw new Error("数据层未初始化")
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** 选中候选后的提示:落到「新建」还是某条已有订阅。 */
  const targetHint = (() => {
    if (!candidateValue || !landChannel) return ""
    const label = cands.find((c) => c.value === candidateValue)?.label ?? candidateValue
    const sub = targets.find((s) => s.id === targetId)
    if (!sub) {
      return subscribed.has(candidateValue)
        ? `「${label}」在该渠道下已存在，新建会得到两条相同订阅。`
        : `已选中「${label}」，将新建一条订阅。`
    }
    const held = valueList(sub, landParam)
    if (held.includes(candidateValue)) return `「${label}」已经在「${sub.title}」里了，不需要重复并入。`
    return `把「${label}」并入「${sub.title}」，原有的 ${held.length} 项保留。`
  })()

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="添加订阅"
      desc="搜索并选择目标后订阅，或直接按渠道参数手工配置。"
      size="wide"
      dismissable={!busy}
      footer={
        <>
          <span className="t-micro t-dim" style={{ flex: 1 }}>
            {searchMode
              ? targetHint || "先搜索并选中一个房间，再添加到订阅。"
              : channel?.defaultInfo
                ? "该渠道带默认参数，可直接订阅。"
                : "请填写必填参数后再订阅。"}
          </span>
          <button className="btn btn-secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || (searchMode ? !candidateValue || !subChKey : !channelKey)}
            onClick={() => void submit()}
          >
            {busy ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="plus" size={14} />} 添加订阅
          </button>
        </>
      }
    >
      <div className="add-mode">
        <span className="segmented" role="tablist" aria-label="添加方式">
          <button role="tab" aria-pressed={mode === "search"} onClick={() => setMode("search")}>
            <Icon name="search" size={14} /> 搜索添加
          </button>
          <button role="tab" aria-pressed={mode === "manual"} onClick={() => setMode("manual")}>
            <Icon name="settings" size={14} /> 按渠道配置
          </button>
        </span>
      </div>

      {searchMode ? (
        <SearchPanel
          searchPlatforms={searchPlatforms}
          channels={channels}
          platform={platform}
          onPickPlatform={pickPlatform}
          keyword={keyword}
          onKeyword={setKeyword}
          searchCh={searchCh}
          onSearch={() => void runSearch()}
          searching={searching}
          searchItems={searchItems}
          cands={cands}
          shown={shown}
          candidateValue={candidateValue}
          onPickCandidate={pickCandidate}
          subscribed={subscribed}
          targets={targets}
          targetId={targetId}
          onTargetId={setTargetId}
          subChKey={subChKey}
          landParam={landParam}
        />
      ) : (
        <ChannelPanel
          builtins={builtins}
          rsshub={rsshub}
          channelKey={channelKey}
          onPick={pick}
          channel={channel}
          fields={fields}
          values={values}
          onValue={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
          missing={missing}
        />
      )}

      {channel ? (
        <div className="stack" style={{ gap: "var(--sp-5)" }}>
          <div className="field">
            <label className="field-label" htmlFor="add-title">
              订阅标题
            </label>
            <input
              id="add-title"
              className="input"
              value={title}
              placeholder={channel.name}
              onChange={(e) => setTitle(e.target.value)}
            />
            <span className="field-help">显示在侧边导航与列表顶部，可随时在编辑订阅中修改。</span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="add-group">
              归入分组
            </label>
            <Select
              id="add-group"
              value={groupId}
              onChange={setGroupId}
              placeholder="不归入分组"
              options={[{ value: "", label: "不归入分组" }, ...groups.map((g) => ({ value: g.id, label: g.title }))]}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="add-ttl">
              单独刷新间隔
            </label>
            <span className="number-row">
              <input
                id="add-ttl"
                className="input input-number"
                type="number"
                min={5}
                max={1440}
                value={ttl}
                placeholder={refreshIntervalMin ? String(refreshIntervalMin) : ""}
                onChange={(e) => setTtl(e.target.value)}
              />
              <span className="t-small t-dim">分钟，留空跟随全局</span>
            </span>
            <span className="field-help">该订阅的 TTL 优先于全局设置，用于降低反爬源被请求的频率。</span>
          </div>
        </div>
      ) : null}

      {error ? (
        <Banner tone="error" icon="alert">
          {error}
        </Banner>
      ) : null}
    </Modal>
  )
}
