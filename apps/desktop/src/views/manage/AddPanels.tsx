/**
 * AddPanels —— 「添加订阅」弹窗的两块**功能件**(纯展示:状态与动作都由外层
 * `useAddForm` 持有,经 `form` 传入)。
 *
 * 拆出来的理由:AddSubscriptionDialog 原本把「搜索添加」(平台/关键词/候选列表/
 * 添加到)与「按渠道配置」(渠道 chip / 摘要 / 参数表单)两大块 JSX 和表单状态
 * 堆在同一个 591 行的组件里。两块互不依赖,只有共享的 `form` 对象。
 */
import type { ChannelInfo } from "@amoeba/core"
import { KIND_META } from "../../store/nodes.ts"
import { Banner } from "../../components/StateBlock.tsx"
import { Icon } from "../../components/Icon.tsx"
import { Select } from "../../components/Modal.tsx"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { MediaImage } from "@amoeba/ui"
import { platformOf, SEARCH_CHANNEL, USER_SEARCH_CHANNEL, valueList, type Candidate } from "../../lib/subscriptions.ts"
import { isImeComposing } from "../../lib/ime.ts"

/** 渠道 → 平台图标名(与 Dialog 里那份是同一张表,提出来给两块面板共用)。 */
export const PLATFORM_ICON: Record<string, string> = {
  bili: "radio",
  douyu: "radio",
  huya: "radio",
  douyin: "radio",
  twitch: "radio",
  youtube: "play",
  weibo: "message",
  xhs: "image",
  apple: "music",
  rss: "rss",
  rsshub: "rss",
}

/** 「搜索添加」面板的入参(全部来自外层表单控制器)。 */
export interface SearchPanelProps {
  searchPlatforms: string[]
  /** 有「搜用户」渠道的平台(bili/youtube;空 = 无用户搜索,不渲染类型切换)。 */
  userSearchPlatforms: string[]
  searchKind: "room" | "user"
  onSearchKind: (k: "room" | "user") => void
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

/** 候选列表的入参(SearchPanel 与发现页共用)。 */
export interface CandidateListProps {
  cands: Candidate[]
  shown: Candidate[]
  candidateValue: string
  onPick: (c: Candidate) => void
  subscribed: Set<string>
  platform: string
  /** shown 为空时的提示(默认按「筛选无匹配」措辞)。 */
  emptyText?: string
}

/**
 * 候选列表:缩略图 + label/sub/meta 一行看全,点击选中(再点取消)。
 * 发现页的搜索/分区/搜主播也用它 —— 与「添加订阅」保持同一套候选形态。
 */
export function CandidateList(f: CandidateListProps) {
  if (f.cands.length === 0) return null
  return (
    <div className="field" {...overlayBlock("candidate-list", "add:candidates")}>
      <span className="field-label">
        匹配 <span className="num">{f.shown.length}</span> / {f.cands.length} 项
      </span>
      {f.shown.length > 0 ? (
        <div className="cand-list" role="listbox" aria-label="候选项">
          {f.shown.map((c) => (
            <button
              key={c.value}
              className="cand"
              role="option"
              aria-selected={f.candidateValue === c.value}
              onClick={() => f.onPick(c)}
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
        <p className="t-small t-dim">{f.emptyText ?? "没有匹配的结果，换个关键词或清空筛选。"}</p>
      )}
    </div>
  )
}

/** 搜索添加:选类型(房间/用户) → 选平台 → 输关键词调接口 → 点选一个候选。 */
export function SearchPanel(f: SearchPanelProps) {
  const kindPlatforms = f.searchKind === "user" ? f.userSearchPlatforms : f.searchPlatforms
  return (
    <div className="stack" style={{ gap: "var(--sp-5)" }} {...overlayBlock("search-panel", "add:search")}>
      {/* 类型切换:两种都有才渲染(只有一种时无须选择)。「搜用户」落地到该用户/频道的
          投稿订阅(uid/channelId 单值参数,无「并入已有」)。 */}
      {f.userSearchPlatforms.length > 0 && f.searchPlatforms.length > 0 ? (
        <div className="field">
          <span className="field-label">搜什么</span>
          <div className="segmented" role="tablist" aria-label="搜索类型">
            <button role="tab" aria-pressed={f.searchKind === "room"} onClick={() => f.onSearchKind("room")}>
              <Icon name="radio" size={14} /> 直播间
            </button>
            <button role="tab" aria-pressed={f.searchKind === "user"} onClick={() => f.onSearchKind("user")}>
              <Icon name="play" size={14} /> UP主 / 频道
            </button>
          </div>
        </div>
      ) : null}

      <div className="field">
        <span className="field-label" id="lbl-search-channel">
          搜索哪个平台
        </span>
        <div className="chip-row" role="group" aria-labelledby="lbl-search-channel">
          {kindPlatforms.map((p) => {
            const key = f.searchKind === "user" ? USER_SEARCH_CHANNEL[p] : SEARCH_CHANNEL[p]
            return (
              <button key={p} className="chip" aria-pressed={f.platform === p} onClick={() => f.onPickPlatform(p)}>
                <Icon name={PLATFORM_ICON[p] ?? "layers"} size={14} />
                {f.channels.find((c) => c.key === key)?.name.replace(/搜索$/, "") ?? p}
              </button>
            )
          })}
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

      <CandidateList
        cands={f.cands}
        shown={f.shown}
        candidateValue={f.candidateValue}
        onPick={f.onPickCandidate}
        subscribed={f.subscribed}
        platform={f.platform}
      />
    </div>
  )
}

/** 「按渠道配置」面板的入参。 */
export interface ChannelPanelProps {
  builtins: ChannelInfo[]
  /** 内置 RSS 直链清单(36 条,用下拉收起来,不铺 chip)。 */
  rssFeeds: ChannelInfo[]
  rsshub: ChannelInfo[]
  channelKey: string
  onPick: (key: string) => void
  channel: ChannelInfo | undefined
  fields: { key: string; label: string; placeholder?: string; required?: boolean }[]
  values: Record<string, string>
  onValue: (key: string, v: string) => void
  missing: string[]
  /** 可并入的已有订阅（列表型参数 roomIds 才非空）。 */
  targets: { id: string; title: string }[]
  targetId: string
  onTargetId: (v: string) => void
  landParam: string | undefined
}

const GROUP_TITLE: Record<string, string> = { builtin: "内置渠道", rsshub: "RSSHub 外挂" }

/** 按渠道配置:选渠道 → 出摘要 + 参数表单(必填现场校验)。 */
export function ChannelPanel(f: ChannelPanelProps) {
  // loginable 是**channel 级**能力，但登录态是**平台级**的（同平台共用一个 cookie）。
  // 先按平台聚合，避免「B站只有综合热门有标记、其余三个没有」这种不可解释的差异。
  // 用 QR 小标记而不是「可扫码登录」文字 tag：chip 里的小字读不懂、还像警告。
  const loginPlatforms = new Set(
    [...f.builtins, ...f.rsshub]
      .filter((c) => c.loginable)
      .map((c) => platformOf(c.key)),
  )
  const channelChip = (c: ChannelInfo) => {
    const platform = platformOf(c.key)
    const canLogin = loginPlatforms.has(platform)
    return (
      <button
        key={c.key}
        className="chip"
        aria-pressed={f.channelKey === c.key}
        aria-label={canLogin ? `${c.name}（支持扫码登录）` : undefined}
        onClick={() => f.onPick(c.key)}
      >
        <Icon
          name={c.kind === "audio" ? "music" : (PLATFORM_ICON[platform] ?? "layers")}
          size={14}
        />
        {c.name}
        {canLogin ? (
          <span className="chip-login" title="支持扫码登录；未登录也能先订阅" aria-hidden="true">
            <Icon name="qr" size={13} strokeWidth={2} />
          </span>
        ) : null}
      </button>
    )
  }
  return (
    <div className="stack" style={{ gap: "var(--sp-5)" }} {...overlayBlock("channel-panel", "add:channel")}>
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
        <span className="field-help">
          带二维码标记的渠道支持扫码登录（同平台共用登录态）；未登录也能先订阅。
        </span>
      </div>

      {f.rssFeeds.length > 0 ? (
        <div className="field">
          <label className="field-label" htmlFor="add-rss-feed">
            内置 RSS 源
          </label>
          <Select
            id="add-rss-feed"
            value={f.rssFeeds.some((c) => c.key === f.channelKey) ? f.channelKey : ""}
            onChange={(v) => {
              if (v) f.onPick(v)
              // 「不使用内置源」不是空操作：当前正选中某条内置 RSS 时退回通用直链；
              // 当前本来就是其它渠道（bili 等）则保持不动。
              else if (f.channelKey.startsWith("rss:")) f.onPick("rss:url")
            }}
            placeholder="选择内置 RSS 源（可选）"
            options={[
              // radix 不接受空串 value；给一个显式的「未选」项，避免 value 为哨兵时
              // 触发器渲染成空白。
              { value: "", label: "不使用内置源" },
              ...f.rssFeeds.map((c) => ({ value: c.key, label: c.name })),
            ]}
          />
          <span className="field-help">
            Hacker News、V2EX 等预置直链；选中后参数已填好，直接订阅即可。
          </span>
        </div>
      ) : null}

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
          </div>

          {f.channel.defaultInfo ? (
            <Banner tone="ok" icon="checkCircle" title="自带默认参数">
              该渠道无需填写参数，添加后会立即抓取一次最新内容。
            </Banner>
          ) : null}
          {f.channel.loginable ? (
            <Banner tone="info" icon="lock">
              登录后可解锁部分内容或更高画质；需要时到「账号与凭证」扫码登录。未登录也能先订阅。
            </Banner>
          ) : null}

          {/* 列表型参数(roomIds)才允许并入已有订阅；与搜索模式的「添加到」同义。 */}
          {f.targets.length > 0 ? (
            <div className="field">
              <span className="field-label" id="lbl-manual-target">
                添加到
              </span>
              <div className="chip-row" role="radiogroup" aria-labelledby="lbl-manual-target">
                <button
                  className="chip"
                  role="radio"
                  aria-checked={f.targetId === "new"}
                  onClick={() => f.onTargetId("new")}
                >
                  <Icon name="plus" size={13} /> 新建订阅
                </button>
                {f.targets.map((s) => (
                  <button
                    key={s.id}
                    className="chip"
                    role="radio"
                    aria-checked={f.targetId === s.id}
                    onClick={() => f.onTargetId(s.id)}
                  >
                    {s.title}
                    <span className="cand-chip">{valueList(s as never, f.landParam).length} 房</span>
                  </button>
                ))}
              </div>
              <span className="field-help">选中已有订阅后，本次填写的房间会并入它，原有房间保留。</span>
            </div>
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
