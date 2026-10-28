/**
 * AddPanels —— 「添加订阅」弹窗的两块功能件。
 *
 * 表单状态与提交编排都在 `AddSubscriptionDialog`（经 `f` 传入）；这里只有渲染，
 * 外加浏览步骤自己的临时 UI 状态（分类 / 搜索词 / 分页），它们不影响订阅结果。
 *
 * 拆出来的理由:两块互不依赖 —— 「搜索添加」是调平台搜索接口选候选，
 * 「浏览渠道」是查渠道目录再填参数。
 */

import type { ChannelInfo } from "@amoeba/core"
import { MediaImage } from "@amoeba/ui"
import { useMemo, useState } from "react"

import { Button } from "../../components/Button.tsx"
import { Icon } from "../../components/Icon.tsx"
import { Select } from "../../components/Modal.tsx"
import { Banner } from "../../components/StateBlock.tsx"
import { CATALOG_PAGE, catalogView, isSingleton } from "../../lib/channel-catalog.ts"
import { isImeComposing } from "../../lib/ime.ts"
import { type Candidate, platformOf, SEARCH_CHANNEL, USER_SEARCH_CHANNEL, valueList } from "../../lib/subscriptions.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { KIND_META } from "../../store/nodes.ts"

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
  candidateValue: string
  onPick: (c: Candidate) => void
  subscribed: Set<string>
  platform: string
}

/**
 * 候选列表:缩略图 + label/sub/meta 一行看全,点击选中(再点取消)。
 * 发现页的搜索/分区/搜主播也用它 —— 与「添加订阅」保持同一套候选形态。
 * 列表上方不再印「匹配 N / N 项」:没有筛选入口,两个数字恒等。
 */
export function CandidateList(f: CandidateListProps) {
  if (f.cands.length === 0) return null
  return (
    <div className="field" {...overlayBlock("candidate-list", "add:candidates")}>
      <div className="cand-list" role="listbox" aria-label="候选项">
        {f.cands.map((c) => (
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
          <Button variant="secondary" size="sm" disabled={f.searching || !f.keyword.trim()} onClick={f.onSearch}>
            {f.searching ? <Icon name="loader" size={13} className="animate-spin" /> : <Icon name="search" size={13} />}{" "}
            搜索
          </Button>
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
          <span className="field-help">并入后原有房间保留。</span>
        </div>
      ) : null}

      <CandidateList
        cands={f.cands}
        candidateValue={f.candidateValue}
        onPick={f.onPickCandidate}
        subscribed={f.subscribed}
        platform={f.platform}
      />
    </div>
  )
}

/** 「浏览渠道」面板的入参。 */
export interface ChannelPanelProps {
  builtins: ChannelInfo[]
  /** 内置 RSS 直链清单(36 条,用下拉收起来,不铺进目录)。 */
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
  /** 各渠道已有的订阅条数：目录行显示「已订阅 N」，单例渠道据此禁用。 */
  subCounts: Record<string, number>
}

/**
 * 浏览渠道 → 点一行进配置步骤。
 *
 * 近百个渠道平铺成 chip 是不可读的（合流原型改成「分类 + 搜索 + 行式目录」）；
 * 分类/搜索/分页的算法在 `lib/channel-catalog.ts`，这里只管渲染与步骤切换。
 * `channelKey` 为空 = 目录步骤，非空 = 配置步骤（「返回渠道列表」= `onPick("")`）。
 */
export function ChannelPanel(f: ChannelPanelProps) {
  const [cat, setCat] = useState("all")
  const [query, setQuery] = useState("")
  const [limit, setLimit] = useState(CATALOG_PAGE)
  const all = useMemo(() => [...f.builtins, ...f.rsshub], [f.builtins, f.rsshub])
  const view = useMemo(() => catalogView(all, cat, query, limit), [all, cat, query, limit])

  // loginable 是**channel 级**能力，但登录态是**平台级**的（同平台共用一个 cookie）。
  // 先按平台聚合，避免「B站只有综合热门有标记、其余三个没有」这种不可解释的差异。
  // 用 QR 小标记而不是「可扫码登录」文字 tag：目录行里的小字读不懂、还像警告。
  const loginPlatforms = useMemo(() => new Set(all.filter((c) => c.loginable).map((c) => platformOf(c.key))), [all])

  /* ── 配置步骤:选中的渠道 ──────────────────────────────────────────── */
  if (f.channel) {
    return (
      <div className="stack" style={{ gap: "var(--sp-5)" }} {...overlayBlock("channel-panel", "add:channel")}>
        {/* 目录状态(cat/query/limit)留在 ChannelPanel 里:返回时回到刚才那一屏 */}
        <button className="cat-back" onClick={() => f.onPick("")}>
          <Icon name="back" size={14} /> 返回渠道列表
        </button>
        <div className="channel-form">
          <div className="channel-summary">
            <span className="platform-mark platform-mark-sm">
              <Icon name={PLATFORM_ICON[platformOf(f.channel.key)] ?? "layers"} size={16} />
            </span>
            <span className="platform-title">
              <span className="t-h3">{f.channel.name}</span>
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
              登录后可解锁部分内容或更高画质；未登录也能先订阅。
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
              <span className="field-help">并入后原有房间保留。</span>
            </div>
          ) : null}

          {f.fields.length > 0
            ? f.fields.map((fd) => (
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
            : null}
        </div>
      </div>
    )
  }

  /* ── 目录步骤:分类 + 搜索 + 行式列表 + 分页 ───────────────────────── */
  const rest = view.total - view.shown
  return (
    <div className="stack" style={{ gap: "var(--sp-4)" }} {...overlayBlock("channel-panel", "add:channel")}>
      <div className="chip-row" role="group" aria-label="渠道分类">
        {view.cats.map((c) => (
          <button
            key={c.id}
            className="chip"
            aria-pressed={cat === c.id}
            onClick={() => {
              setCat(c.id)
              setLimit(CATALOG_PAGE)
            }}
          >
            {c.label}
            <span className="cand-chip">{c.count}</span>
          </button>
        ))}
      </div>

      <div className="input-group">
        <Icon name="search" size={16} />
        <input
          className="input"
          type="search"
          value={query}
          placeholder="搜索渠道或平台"
          aria-label="搜索订阅渠道"
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(CATALOG_PAGE)
          }}
        />
      </div>

      {view.groups.length === 0 ? (
        <div className="field">
          <p className="t-small t-dim">{query.trim() ? `没有匹配「${query.trim()}」的渠道。` : "没有可用渠道。"}</p>
          {/* 在某个分类里搜空是最常见的死路：给一条出路，而不是让用户自己切 tab 重搜 */}
          {query.trim() ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (cat !== "all") {
                  setCat("all")
                  setLimit(CATALOG_PAGE)
                } else setQuery("")
              }}
            >
              {cat !== "all" ? "在全部渠道中搜索" : "清除搜索"}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="cat-list">
          {view.groups.map((g) => (
            <div className="cat-group" key={g.id}>
              {/* 只剩一组时组头与分类 tab 说的是同一件事，不画 */}
              {view.groups.length > 1 ? (
                <div className="cat-head eyebrow">
                  {g.label}
                  <span>{g.items.length}</span>
                </div>
              ) : null}
              {g.items.map((c) => {
                const n = f.subCounts[c.key] ?? 0
                const canLogin = loginPlatforms.has(platformOf(c.key))
                // 无参渠道再订阅一份就是同一份内容 → 已订阅即禁用；带参数的可反复添加
                const blocked = n > 0 && isSingleton(c)
                const needsParams = (c.sourceInfoTpl?.length ?? 0) > 0
                return (
                  <button
                    key={c.key}
                    className="cat-row"
                    aria-disabled={blocked || undefined}
                    title={canLogin ? "支持扫码登录；未登录也能先订阅" : undefined}
                    onClick={() => {
                      if (!blocked) f.onPick(c.key)
                    }}
                  >
                    <span className="cat-ico">
                      <Icon
                        name={c.kind === "audio" ? "music" : (PLATFORM_ICON[platformOf(c.key)] ?? "layers")}
                        size={16}
                      />
                    </span>
                    <span className="cat-name">
                      {c.name}
                      {canLogin ? (
                        <span className="chip-login" aria-hidden="true">
                          <Icon name="qr" size={12} strokeWidth={2} />
                        </span>
                      ) : null}
                    </span>
                    {/* 单例渠道的「已订阅」在行尾已经说了，这里只给可反复添加的渠道报数量 */}
                    {n > 0 && !blocked ? <span className="cand-chip">已订阅 {n}</span> : null}
                    <span className="cat-go">
                      {blocked ? "已订阅" : needsParams ? "配置" : "添加"}
                      <Icon name={blocked ? "check" : needsParams ? "chevronRight" : "plus"} size={12} />
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
          {rest > 0 ? (
            <button className="cat-more" onClick={() => setLimit((l) => l + CATALOG_PAGE)}>
              显示更多渠道 · 还有 {rest} 个 <Icon name="chevronDown" size={14} />
            </button>
          ) : null}
        </div>
      )}

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
              // 已订阅的内置源不可再选:与目录同一规则(无参渠道重复订阅只是同一份内容)
              ...f.rssFeeds.map((c) => ({
                value: c.key,
                label: c.name,
                disabled: (f.subCounts[c.key] ?? 0) > 0,
              })),
            ]}
          />
        </div>
      ) : null}
    </div>
  )
}
