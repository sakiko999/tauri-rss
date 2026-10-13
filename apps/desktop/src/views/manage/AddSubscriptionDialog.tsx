/**
 * AddSubscriptionDialog —— 添加订阅弹窗(radix Dialog + 设计系统类名)。
 *
 * 结构对齐 new_desktop 的 addSubscriptionModal/channelForm:渠道按来源分组用 chip 选,
 * 选中后出渠道摘要 + 参数表单(必填校验)+ 标题 + 归入分组 + 独立刷新间隔。
 *
 * 渠道来自 core `dl.listChannels()`;参数表单由 `sourceInfoTpl` 动态渲染;
 * 带 `defaultInfo` 的渠道可一键订阅。提交走 store.addSubscription(内部
 * dl.addSubscription = add + refresh)。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import type { ChannelInfo, MediaItem } from "@tauri-playground/core"
import { useDesktop } from "../../store/index.ts"
import { Modal, Select } from "../../components/Modal.tsx"
import { Icon } from "../../components/Icon.tsx"
import { Banner } from "../../components/StateBlock.tsx"
import { KIND_META } from "../../store/nodes.ts"
import { MediaImage } from "@tauri-playground/ui"
import {
  candidatesFromSearch,
  LIVE_SUB_CHANNEL,
  platformOf,
  SEARCH_CHANNEL,
  searchChannelOf,
  subsOfChannel,
  valueList,
  type Candidate,
} from "../../lib/subscriptions.ts"

const PLATFORM_ICON: Record<string, string> = {
  bili: "radio",
  douyu: "radio",
  huya: "radio",
  douyin: "radio",
  youtube: "play",
  weibo: "message",
  xhs: "image",
  rsshub: "rss",
}

const GROUP_TITLE: Record<string, string> = {
  builtin: "内置渠道",
  rsshub: "RSSHub 外挂",
}

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
  const [filter, setFilter] = useState("")
  const [title, setTitle] = useState("")
  const [groupId, setGroupId] = useState("")
  const [ttl, setTtl] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  /** 必填未填的参数 key(现场校验,提交前拦截)。 */
  const [missing, setMissing] = useState<string[]>([])
  /** 搜索请求世代:切平台/新搜索自增,旧响应回来时若世代不符则丢弃(否则上个平台的
   *  候选会覆盖当前面板 —— 与 DiscoverPage 的 genRef 同款)。 */
  const searchGenRef = useRef(0)

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
    ++searchGenRef.current // 重开面板作废上一次会话的在途搜索
    setError("")
    setMissing([])
    setBusy(false)
    setGroupId("")
    setTtl("")
    setCandidateValue("")
    setTargetId("new")
    setFilter("")
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
    const gen = ++searchGenRef.current
    setSearching(true)
    setError("")
    setCandidateValue("")
    setTitle("")
    try {
      const field = searchCh?.sourceInfoTpl?.[0]?.key ?? "keyword"
      const r = await dl.previewChannel(searchChKey, { [field]: keyword.trim() })
      if (gen !== searchGenRef.current) return // 已被切平台/新搜索取代,丢弃
      setSearchItems(r.items)
    } catch (e) {
      if (gen !== searchGenRef.current) return
      setError(e instanceof Error ? e.message : String(e))
      setSearchItems([])
    } finally {
      if (gen === searchGenRef.current) setSearching(false)
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
    setFilter("")
  }

  /** 切换搜索平台(清空上一平台的候选与选中)。 */
  function pickPlatform(p: string) {
    ++searchGenRef.current // 作废在途搜索,否则旧平台候选覆盖新面板
    setPlatform(p)
    setSearchItems(null)
    setCandidateValue("")
    setTargetId("new")
    setFilter("")
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

  function channelChip(c: ChannelInfo) {
    return (
      <button key={c.key} className="chip" aria-pressed={channelKey === c.key} onClick={() => pick(c.key)}>
        <Icon name={PLATFORM_ICON[platformOf(c.key)] ?? "layers"} size={14} />
        {c.name}
        {c.loginable ? <span className="tag tag-warn chip-tag">需登录</span> : null}
      </button>
    )
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

      {/* ── 搜索添加:选平台 → 输关键词调接口 → 点选一个房间 ────────────── */}
      {searchMode ? (
        <div className="stack" style={{ gap: "var(--sp-5)" }}>
          <div className="field">
            <span className="field-label" id="lbl-search-channel">
              搜索哪个平台
            </span>
            <div className="chip-row" role="group" aria-labelledby="lbl-search-channel">
              {searchPlatforms.map((p) => (
                <button
                  key={p}
                  className="chip"
                  aria-pressed={platform === p}
                  onClick={() => pickPlatform(p)}
                >
                  <Icon name={PLATFORM_ICON[p] ?? "layers"} size={14} />
                  {channels.find((c) => c.key === SEARCH_CHANNEL[p])?.name.replace(/搜索$/, "") ?? p}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="add-keyword">
              {searchCh?.sourceInfoTpl?.[0]?.label ?? "搜索关键词"}
            </label>
            <div className="input-group">
              <Icon name="search" size={16} />
              <input
                id="add-keyword"
                className="input"
                type="search"
                value={keyword}
                placeholder={searchCh?.sourceInfoTpl?.[0]?.placeholder ?? "如:英雄联盟"}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch()
                }}
              />
            </div>
            <div className="inline-row">
              <button className="btn btn-secondary btn-sm" disabled={searching || !keyword.trim()} onClick={() => void runSearch()}>
                {searching ? <Icon name="loader" size={13} className="animate-spin" /> : <Icon name="search" size={13} />} 搜索
              </button>
              <span className="field-help">候选来自平台实时搜索接口，与是否已订阅无关。</span>
            </div>
          </div>

          {searchItems !== null && cands.length === 0 && !searching ? (
            <p className="t-small t-dim">
              {searchItems.length === 0 ? "接口没有返回结果，换个关键词试试。" : "返回的条目没有可用的房间号。"}
            </p>
          ) : null}

          {/* 「添加到」:新建一条,或并入该平台下已有的直播订阅(roomIds 追加) */}
          {cands.length > 0 && targets.length > 0 && subChKey ? (
            <div className="field">
              <span className="field-label" id="lbl-target">
                添加到
              </span>
              <div className="chip-row" role="radiogroup" aria-labelledby="lbl-target">
                <button
                  className="chip"
                  role="radio"
                  aria-checked={targetId === "new"}
                  onClick={() => setTargetId("new")}
                >
                  <Icon name="plus" size={13} /> 新建订阅
                </button>
                {targets.map((s) => (
                  <button
                    key={s.id}
                    className="chip"
                    role="radio"
                    aria-checked={targetId === s.id}
                    onClick={() => setTargetId(s.id)}
                  >
                    {s.title}
                    <span className="cand-chip">{valueList(s, landParam).length} 房</span>
                  </button>
                ))}
              </div>
              <span className="field-help">选中房间后会并入该订阅的房间列表，原有房间保留。</span>
            </div>
          ) : null}

          {cands.length > 0 ? (
            <div className="field">
              <span className="field-label" id="lbl-cand">
                匹配 <span className="num">{shown.length}</span> / {cands.length} 项
              </span>
              {shown.length > 0 ? (
                <div className="cand-list" role="listbox" aria-labelledby="lbl-cand">
                  {shown.map((c) => (
                    <button
                      key={c.value}
                      className="cand"
                      role="option"
                      aria-selected={candidateValue === c.value}
                      onClick={() => pickCandidate(c)}
                    >
                      {/* 缩略图:有真实封面用它,没有则回落到平台标识(不编造图片),两者同尺寸行高不跳 */}
                      {c.thumb ? (
                        <MediaImage src={c.thumb} ratio={1} className="cand-thumb" />
                      ) : (
                        <span className="cand-thumb cand-thumb-plain">
                          <Icon name={PLATFORM_ICON[platform] ?? "layers"} size={18} />
                        </span>
                      )}
                      <span className="cand-main">
                        <span className="cand-label od-truncate">{c.label}</span>
                        {c.sub ? <span className="cand-sub od-truncate">{c.sub}</span> : null}
                        {c.meta.length > 0 ? (
                          <span className="cand-meta">
                            {c.meta.map((m) => (
                              <span className="cand-chip" key={m}>
                                {m}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                      {subscribed.has(c.value) ? <span className="tag tag-warn chip-tag">已订阅</span> : null}
                      <span className="cand-check">
                        <Icon name="check" size={15} />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="t-small t-dim">没有匹配的结果，换个关键词或清空筛选。</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── 按渠道配置:原「选渠道 + 参数表单」 ─────────────────────────── */}
      {!searchMode ? (
        <div className="stack" style={{ gap: "var(--sp-5)" }}>
          <div className="field">
            <span className="field-label" id="lbl-channel">
              渠道
            </span>
            <div className="channel-groups" role="group" aria-labelledby="lbl-channel">
              {[
                { id: "builtin", channels: builtins },
                { id: "rsshub", channels: rsshub },
              ]
                .filter((g) => g.channels.length > 0)
                .map((g) => (
                  <div className="channel-group" key={g.id}>
                    <div className="eyebrow">{GROUP_TITLE[g.id]}</div>
                    <div className="chip-row">{g.channels.map(channelChip)}</div>
                  </div>
                ))}
            </div>
          </div>

          {channel ? (
            <div className="channel-form">
              <div className="channel-summary">
                <span className="platform-mark platform-mark-sm">
                  <Icon name={PLATFORM_ICON[platformOf(channel.key)] ?? "layers"} size={16} />
                </span>
                <span className="platform-title">
                  <span className="t-h3">{channel.name}</span>
                  <span className="t-micro t-dim mono od-truncate">{channel.key}</span>
                </span>
                <span className="tag">{KIND_META[channel.kind]?.label ?? channel.kind}</span>
                {channel.loginable ? (
                  <span className="tag tag-warn">需登录 cookie</span>
                ) : (
                  <span className="tag tag-ok">匿名可用</span>
                )}
              </div>

              {channel.defaultInfo ? (
                <Banner tone="ok" icon="checkCircle" title="自带默认参数">
                  该渠道无需填写参数，添加后会立即抓取一次最新内容。
                </Banner>
              ) : null}
              {channel.loginable ? (
                <Banner tone="warn" icon="lock">
                  该渠道需要登录，请先在「账号与凭证」里扫码或填 cookie。
                </Banner>
              ) : null}

              {fields.length > 0 ? (
                fields.map((f) => (
                  <div className="field" key={f.key}>
                    <label className="field-label" htmlFor={`add-${f.key}`}>
                      {f.label}
                      {f.required ? <span className="field-req">*</span> : <span className="t-micro t-dim">选填</span>}
                    </label>
                    <input
                      id={`add-${f.key}`}
                      className="input"
                      value={values[f.key] ?? ""}
                      placeholder={f.placeholder}
                      aria-required={f.required || undefined}
                      aria-invalid={missing.includes(f.key) || undefined}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    />
                    {missing.includes(f.key) ? (
                      <span className="field-error">
                        <Icon name="alert" size={12} />「{f.label}」为必填项，请填写后再提交。
                      </span>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="t-small t-muted">该渠道不需要额外参数。</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

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
