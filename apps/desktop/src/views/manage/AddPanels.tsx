/**
 * AddPanels —— 「添加订阅」弹窗的两块**功能件**(纯展示:状态与动作都由外层
 * `useAddForm` 持有,经 `form` 传入)。
 *
 * 拆出来的理由:AddSubscriptionDialog 原本把「搜索添加」(平台/关键词/候选列表/
 * 添加到)与「按渠道配置」(渠道 chip / 摘要 / 参数表单)两大块 JSX 和表单状态
 * 堆在同一个 591 行的组件里。两块互不依赖,只有共享的 `form` 对象。
 */
import type { ChannelInfo } from "@tauri-playground/core"
import { KIND_META } from "../../store/nodes.ts"
import { Banner } from "../../components/StateBlock.tsx"
import { Icon } from "../../components/Icon.tsx"
import { MediaImage } from "@tauri-playground/ui"
import { platformOf, SEARCH_CHANNEL, valueList, type Candidate } from "../../lib/subscriptions.ts"
import { isImeComposing } from "../../lib/ime.ts"

/** 渠道 → 平台图标名(与 Dialog 里那份是同一张表,提出来给两块面板共用)。 */
export const PLATFORM_ICON: Record<string, string> = {
  bili: "radio",
  douyu: "radio",
  huya: "radio",
  douyin: "radio",
  youtube: "play",
  weibo: "message",
  xhs: "image",
  rsshub: "rss",
}

/** 「搜索添加」面板的入参(全部来自外层表单控制器)。 */
export interface SearchPanelProps {
  searchPlatforms: string[]
  channels: ChannelInfo[]
  platform: string
  onPickPlatform: (p: string) => void
  keyword: string
  onKeyword: (v: string) => void
  searchCh: ChannelInfo | undefined
  onSearch: () => void
  searching: boolean
  searchItems: { length: number } | null
  cands: Candidate[]
  shown: Candidate[]
  candidateValue: string
  onPickCandidate: (c: Candidate) => void
  subscribed: Set<string>
  targets: { id: string; title: string }[]
  targetId: string
  onTargetId: (v: string) => void
  subChKey: string
  landParam: string | undefined
}

/** 搜索添加:选平台 → 输关键词调接口 → 点选一个房间。 */
export function SearchPanel(f: SearchPanelProps) {
  return (
    <div className="stack" style={{ gap: "var(--sp-5)" }}>
      <div className="field">
        <span className="field-label" id="lbl-search-channel">
          搜索哪个平台
        </span>
        <div className="chip-row" role="group" aria-labelledby="lbl-search-channel">
          {f.searchPlatforms.map((p) => (
            <button key={p} className="chip" aria-pressed={f.platform === p} onClick={() => f.onPickPlatform(p)}>
              <Icon name={PLATFORM_ICON[p] ?? "layers"} size={14} />
              {f.channels.find((c) => c.key === SEARCH_CHANNEL[p])?.name.replace(/搜索$/, "") ?? p}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="add-keyword">
          {f.searchCh?.sourceInfoTpl?.[0]?.label ?? "搜索关键词"}
        </label>
        <div className="input-group">
          <Icon name="search" size={16} />
          <input
            id="add-keyword"
            className="input"
            type="search"
            value={f.keyword}
            placeholder={f.searchCh?.sourceInfoTpl?.[0]?.placeholder ?? "如:英雄联盟"}
            onChange={(e) => f.onKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isImeComposing(e)) f.onSearch()
            }}
          />
        </div>
        <div className="inline-row">
          <button className="btn btn-secondary btn-sm" disabled={f.searching || !f.keyword.trim()} onClick={f.onSearch}>
            {f.searching ? <Icon name="loader" size={13} className="animate-spin" /> : <Icon name="search" size={13} />} 搜索
          </button>
          <span className="field-help">候选来自平台实时搜索接口，与是否已订阅无关。</span>
        </div>
      </div>

      {f.searchItems !== null && f.cands.length === 0 && !f.searching ? (
        <p className="t-small t-dim">
          {f.searchItems.length === 0 ? "接口没有返回结果，换个关键词试试。" : "返回的条目没有可用的房间号。"}
        </p>
      ) : null}

      {/* 「添加到」:新建一条,或并入该平台下已有的直播订阅(roomIds 追加) */}
      {f.cands.length > 0 && f.targets.length > 0 && f.subChKey ? (
        <div className="field">
          <span className="field-label" id="lbl-target">
            添加到
          </span>
          <div className="chip-row" role="radiogroup" aria-labelledby="lbl-target">
            <button className="chip" role="radio" aria-checked={f.targetId === "new"} onClick={() => f.onTargetId("new")}>
              <Icon name="plus" size={13} /> 新建订阅
            </button>
            {f.targets.map((s) => (
              <button key={s.id} className="chip" role="radio" aria-checked={f.targetId === s.id} onClick={() => f.onTargetId(s.id)}>
                {s.title}
                <span className="cand-chip">{valueList(s as never, f.landParam).length} 房</span>
              </button>
            ))}
          </div>
          <span className="field-help">选中房间后会并入该订阅的房间列表，原有房间保留。</span>
        </div>
      ) : null}

      {f.cands.length > 0 ? (
        <div className="field">
          <span className="field-label" id="lbl-cand">
            匹配 <span className="num">{f.shown.length}</span> / {f.cands.length} 项
          </span>
          {f.shown.length > 0 ? (
            <div className="cand-list" role="listbox" aria-labelledby="lbl-cand">
              {f.shown.map((c) => (
                <button
                  key={c.value}
                  className="cand"
                  role="option"
                  aria-selected={f.candidateValue === c.value}
                  onClick={() => f.onPickCandidate(c)}
                >
                  {/* 缩略图:有真实封面用它,没有则回落到平台标识(不编造图片),两者同尺寸行高不跳 */}
                  {c.thumb ? (
                    <MediaImage src={c.thumb} ratio={1} className="cand-thumb" />
                  ) : (
                    <span className="cand-thumb cand-thumb-plain">
                      <Icon name={PLATFORM_ICON[f.platform] ?? "layers"} size={18} />
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
                  {f.subscribed.has(c.value) ? <span className="tag tag-warn chip-tag">已订阅</span> : null}
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
  )
}

/** 「按渠道配置」面板的入参。 */
export interface ChannelPanelProps {
  builtins: ChannelInfo[]
  rsshub: ChannelInfo[]
  channelKey: string
  onPick: (key: string) => void
  channel: ChannelInfo | undefined
  fields: { key: string; label: string; placeholder?: string; required?: boolean }[]
  values: Record<string, string>
  onValue: (key: string, v: string) => void
  missing: string[]
}

const GROUP_TITLE: Record<string, string> = { builtin: "内置渠道", rsshub: "RSSHub 外挂" }

/** 按渠道配置:选渠道 → 出摘要 + 参数表单(必填现场校验)。 */
export function ChannelPanel(f: ChannelPanelProps) {
  const channelChip = (c: ChannelInfo) => (
    <button key={c.key} className="chip" aria-pressed={f.channelKey === c.key} onClick={() => f.onPick(c.key)}>
      <Icon name={PLATFORM_ICON[platformOf(c.key)] ?? "layers"} size={14} />
      {c.name}
      {c.loginable ? <span className="tag tag-warn chip-tag">需登录</span> : null}
    </button>
  )
  return (
    <div className="stack" style={{ gap: "var(--sp-5)" }}>
      <div className="field">
        <span className="field-label" id="lbl-channel">
          渠道
        </span>
        <div className="channel-groups" role="group" aria-labelledby="lbl-channel">
          {[
            { id: "builtin", channels: f.builtins },
            { id: "rsshub", channels: f.rsshub },
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

      {f.channel ? (
        <div className="channel-form">
          <div className="channel-summary">
            <span className="platform-mark platform-mark-sm">
              <Icon name={PLATFORM_ICON[platformOf(f.channel.key)] ?? "layers"} size={16} />
            </span>
            <span className="platform-title">
              <span className="t-h3">{f.channel.name}</span>
              <span className="t-micro t-dim mono od-truncate">{f.channel.key}</span>
            </span>
            <span className="tag">{KIND_META[f.channel.kind]?.label ?? f.channel.kind}</span>
            {f.channel.loginable ? <span className="tag tag-warn">需登录 cookie</span> : <span className="tag tag-ok">匿名可用</span>}
          </div>

          {f.channel.defaultInfo ? (
            <Banner tone="ok" icon="checkCircle" title="自带默认参数">
              该渠道无需填写参数，添加后会立即抓取一次最新内容。
            </Banner>
          ) : null}
          {f.channel.loginable ? (
            <Banner tone="warn" icon="lock">
              该渠道需要登录，请先在「账号与凭证」里扫码或填 cookie。
            </Banner>
          ) : null}

          {f.fields.length > 0 ? (
            f.fields.map((fd) => (
              <div className="field" key={fd.key}>
                <label className="field-label" htmlFor={`add-${fd.key}`}>
                  {fd.label}
                  {fd.required ? <span className="field-req">*</span> : <span className="t-micro t-dim">选填</span>}
                </label>
                <input
                  id={`add-${fd.key}`}
                  className="input"
                  value={f.values[fd.key] ?? ""}
                  placeholder={fd.placeholder}
                  aria-required={fd.required || undefined}
                  aria-invalid={f.missing.includes(fd.key) || undefined}
                  onChange={(e) => f.onValue(fd.key, e.target.value)}
                />
                {f.missing.includes(fd.key) ? (
                  <span className="field-error">
                    <Icon name="alert" size={12} />「{fd.label}」为必填项，请填写后再提交。
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
  )
}
