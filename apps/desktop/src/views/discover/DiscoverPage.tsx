/**
 * DiscoverPage —— 发现页:平台能力矩阵 + 分区浏览 + 搜索,全部接真实渠道。
 *
 * new_desktop 的 discoveries 是静态快照(capabilities/categories 写死在 content.js)。
 * 这里改成**从渠道注册表推导**:
 *   - 平台能力:`dl.listChannels()` 里是否存在 <platform>:category / <platform>:search /
 *     <platform>:anchor 决定;
 *   - 分区浏览/搜索:core `previewChannel(channelKey, info)` 取一次真实数据(不建订阅);
 *   - 一键订阅:`dl.addSubscription`。
 */
import { useMemo, useRef, useState } from "react"
import type { ChannelInfo, MediaItem } from "@tauri-playground/core"
import { fetchDouyinSuggestions } from "@tauri-playground/resolve"
import { useDesktop } from "../../store/index.ts"
import { Icon } from "../../components/Icon.tsx"
import { Banner, StateBlock } from "../../components/StateBlock.tsx"
import { CardMini } from "../../components/cards.tsx"
import { itemKey } from "../../lib/media.ts"
import { AddSubscriptionDialog } from "../manage/AddSubscriptionDialog.tsx"
import { usePlayerNav } from "../player/usePlayerNav.ts"

/** 展示用的平台清单(能力从渠道注册表推导,不在数据里写死)。 */
const PLATFORMS: Array<{ id: string; label: string; icon: string }> = [
  { id: "bili", label: "bilibili", icon: "radio" },
  { id: "douyu", label: "斗鱼", icon: "radio" },
  { id: "huya", label: "虎牙", icon: "radio" },
  { id: "douyin", label: "抖音", icon: "radio" },
  { id: "youtube", label: "YouTube", icon: "play" },
  { id: "weibo", label: "微博", icon: "message" },
  { id: "xhs", label: "小红书", icon: "image" },
]

type Cap = "category" | "search" | "anchor"

const CAP_LABEL: Record<Cap, string> = { category: "分区浏览", search: "搜索房间", anchor: "搜主播" }

/** PlatformBrowser 三个子视图(与 Cap 同键)的中文名。 */
const VIEW_LABEL: Record<Cap, string> = { category: "分区", search: "搜索", anchor: "主播搜索" }

export function DiscoverPage() {
  const dl = useDesktop((s) => s.dl)
  const channels = useMemo(() => dl?.listChannels() ?? [], [dl])
  const [platform, setPlatform] = useState("bili")

  // 能力矩阵:某平台的某能力是否可用 = 注册表里存在对应渠道。
  const caps = useMemo(() => {
    const m: Record<string, Record<Cap, ChannelInfo | undefined>> = {}
    for (const p of PLATFORMS) {
      const find = (suffix: string) => channels.find((c) => c.key === `${p.id}:${suffix}` || c.key === `live:${p.id}:${suffix}`)
      m[p.id] = { category: find("category"), search: find("search"), anchor: find("anchor") }
    }
    return m
  }, [channels])

  // 「可一键订阅」= 无需用户输入:有 defaultInfo,或参数表里没有 required 字段。
  // 榜单意图本身 = 直播榜 + 视频榜;⚠️ 曾用 /hot|live/ 正则,`live:` 前缀让**所有**
  // live 渠道都命中,把 live:huya:search / live:douyu:anchor 这类必填参渠道也列进来
  // (一键订阅空 info 必失败)。改为「榜单类 kind」∧「无必填参数」双闸。
  const boards = useMemo(
    () =>
      channels.filter(
        (c) =>
          (c.kind === "live" || (c.kind === "video" && /popular|weekly|ranking|square/.test(c.key))) &&
          (!!c.defaultInfo || !(c.sourceInfoTpl ?? []).some((f) => f.required)),
      ),
    [channels],
  )

  return (
    <div className="page">
      <div className="scroll-area page-scroll">
        <div className="page-wrap">
          <h1 className="page-title">发现</h1>
          <p className="page-lead">
            平台能力从已注册渠道推导:能看到的按钮就有对应实现。分区浏览与搜索直接取真实数据,
            不需要先建订阅;找到想看的内容再一键订阅。
          </p>

          <section className="section-first section">
            <div className="section-head">
              <h2 className="section-title">平台能力</h2>
              <span className="section-desc">灰掉的项 = 该平台当前没有对应渠道实现</span>
            </div>
            <div className="platform-grid">
              {PLATFORMS.map((p) => {
                const c = caps[p.id]
                return (
                  <div className="platform-card" key={p.id}>
                    <div className="platform-head">
                      <span className="platform-mark">
                        <Icon name={p.icon} size={17} />
                      </span>
                      <span className="platform-title">
                        <span className="platform-name">{p.label}</span>
                        <span className="t-micro t-dim">{p.id}</span>
                      </span>
                    </div>
                    <div className="cap-list">
                      {(Object.keys(CAP_LABEL) as Cap[]).map((k) => (
                        <div className="cap-row" data-on={String(!!c[k])} key={k}>
                          <Icon name={c[k] ? "checkCircle" : "close"} size={13} />
                          <span>{CAP_LABEL[k]}</span>
                          <span className="spacer" />
                          <span className="t-micro t-dim">{c[k] ? "可用" : "无渠道"}</span>
                        </div>
                      ))}
                    </div>
                    <div className="chip-row">
                      {c.category ? (
                        <button className="chip chip-sm" onClick={() => setPlatform(p.id)}>
                          浏览分区
                        </button>
                      ) : null}
                      {c.search || c.anchor ? (
                        <button className="chip chip-sm" onClick={() => setPlatform(p.id)}>
                          搜索
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <PlatformBrowser platform={platform} caps={caps[platform]} onPickPlatform={setPlatform} />

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">可订阅榜单</h2>
              <span className="section-desc">无参渠道，一键订阅即可持续收到内容</span>
            </div>
            <BoardList boards={boards} />
          </section>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">数据源</h2>
              <span className="section-desc">抓取在本机完成,内容与凭证都存本地 SQLite,不经中转服务器</span>
            </div>
            <div className="stat-strip">
              {[
                { k: "可用渠道", v: channels.length },
                { k: "平台能力", v: Object.values(caps).reduce((n, c) => n + Object.values(c).filter(Boolean).length, 0) },
                { k: "可一键订阅", v: boards.length },
              ].map((s) => (
                <div className="stack" key={s.k} style={{ gap: 2 }}>
                  <span className="t-micro t-dim">{s.k}</span>
                  <span className="t-h2 num">{s.v}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/** 分区浏览 + 搜索:走 previewChannel 取真实数据。 */
function PlatformBrowser({
  platform,
  caps,
  onPickPlatform,
}: {
  platform: string
  caps: Record<Cap, ChannelInfo | undefined>
  onPickPlatform: (id: string) => void
}) {
  const dl = useDesktop((s) => s.dl)
  const actions = usePlayerNav()
  const [view, setView] = useState<"category" | "search" | "anchor">("category")
  const [categoryValue, setCategoryValue] = useState("")
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [items, setItems] = useState<MediaItem[] | null>(null)
  /** 抖音搜索联想词(datalist 候选;匿名可用,其他平台为空)。 */
  const [sug, setSug] = useState<string[]>([])
  const sugTimer = useRef<number | undefined>(undefined)
  const [subscribeKey, setSubscribeKey] = useState<string | undefined>()
  const [subscribeInfo, setSubscribeInfo] = useState<Record<string, string>>({})
  const [dialogOpen, setDialogOpen] = useState(false)
  /** 请求世代:切换平台/新搜索会自增,旧请求响应回来时若世代不符则丢弃。 */
  const genRef = useRef(0)
  const ch = view === "category" ? caps.category : view === "anchor" ? caps.anchor : caps.search

  async function run() {
    if (!dl || !ch) return
    const gen = ++genRef.current
    setBusy(true)
    setError("")
    const info: Record<string, string> = {}
    // 参数名来自渠道的 sourceInfoTpl(不硬编码字段名)。
    const fields = ch.sourceInfoTpl ?? []
    if (fields[0]) info[fields[0].key] = view === "category" ? categoryValue : q
    try {
      const r = await dl.previewChannel(ch.key, info)
      if (gen !== genRef.current) return // 已被更新的请求取代,丢弃(否则面板显示上一个平台的数据)
      setItems(r.items)
    } catch (e) {
      if (gen !== genRef.current) return
      setError(e instanceof Error ? e.message : String(e))
      setItems(null)
    } finally {
      if (gen === genRef.current) setBusy(false)
    }
  }

  const fields = ch?.sourceInfoTpl ?? []

  /** 抖音联想词:防抖 250ms,空输入清空;失败静默(联想只是锦上添花)。 */
  function loadSug(v: string) {
    window.clearTimeout(sugTimer.current)
    const kw = v.trim()
    if (!kw) {
      setSug([])
      return
    }
    sugTimer.current = window.setTimeout(() => {
      void fetchDouyinSuggestions(kw)
        .then(setSug)
        .catch(() => setSug([]))
    }, 250)
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">分区浏览与搜索</h2>
        <span className="section-desc">取真实数据，不写进订阅列表</span>
      </div>

      <div className="chip-row" style={{ marginBottom: "var(--sp-4)" }}>
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            className="chip"
            aria-pressed={platform === p.id}
            onClick={() => {
              onPickPlatform(p.id)
              setItems(null)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="segmented" style={{ marginBottom: "var(--sp-4)" }}>
        <button aria-pressed={view === "category"} onClick={() => setView("category")} disabled={!caps.category}>
          分区
        </button>
        <button aria-pressed={view === "search"} onClick={() => setView("search")} disabled={!caps.search}>
          搜索
        </button>
        <button aria-pressed={view === "anchor"} onClick={() => setView("anchor")} disabled={!caps.anchor}>
          搜主播
        </button>
      </div>

      {!ch ? (
        <Banner tone="warn" icon="warning">
          {platform} 当前没有「{VIEW_LABEL[view]}」渠道（能力矩阵里是灰的）。
        </Banner>
      ) : (
        <div className="inline-row" style={{ marginBottom: "var(--sp-4)" }}>
          <input
            className="input input-wide"
            value={view === "category" ? categoryValue : q}
            placeholder={fields[0]?.placeholder ?? fields[0]?.label ?? "参数"}
            aria-label={fields[0]?.label ?? "参数"}
            // 抖音搜索/搜主播输入联想词(datalist,原生零依赖;其他平台无此能力)。
            list={platform === "douyin" && view !== "category" && fields[0]?.key === "keyword" ? "dy-sug" : undefined}
            onChange={(e) => {
              const v = e.target.value
              if (view === "category") setCategoryValue(v)
              else {
                setQ(v)
                if (platform === "douyin") void loadSug(v)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run()
            }}
          />
          {platform === "douyin" && view !== "category" && sug.length > 0 ? (
            <datalist id="dy-sug">
              {sug.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
          ) : null}
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
        items.length === 0 ? (
          <StateBlock icon="inbox" tight title="没有取到内容" text="换个参数再试;若渠道需要登录，先去「账号与凭证」。" />
        ) : (
          <div className="result-grid">
            {items.map((it) => (
              <CardMini key={itemKey(it)} item={it} actions={actions} />
            ))}
          </div>
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

/** 可订阅榜单(无参渠道一键订阅)。 */
function BoardList({ boards }: { boards: ChannelInfo[] }) {
  const subscriptions = useDesktop((s) => s.subscriptions)
  const addSubscription = useDesktop((s) => s.addSubscription)
  const toast = useDesktop((s) => s.toast)
  const [busy, setBusy] = useState<string | null>(null)

  if (boards.length === 0) {
    return <StateBlock icon="layers" tight title="没有可一键订阅的无参渠道" text="用上面的分区浏览找内容。" />
  }

  return (
    <div className="result-grid">
      {boards.map((b) => {
        const subscribed = subscriptions.some((s) => s.channelKey === b.key)
        return (
          <div className="platform-card" key={b.key}>
            <div className="platform-head">
              <span className="platform-mark">
                <Icon name={b.kind === "live" ? "radio" : "layers"} size={17} />
              </span>
              <span className="platform-title">
                <span className="platform-name" style={{ fontSize: "var(--fs-h3)" }}>
                  {b.name}
                </span>
                <span className="t-micro t-dim">{b.key}</span>
              </span>
            </div>
            <div className="chip-row">
              <button
                className={subscribed ? "btn btn-secondary btn-sm" : "btn btn-primary btn-sm"}
                disabled={subscribed || busy === b.key}
                onClick={async () => {
                  setBusy(b.key)
                  try {
                    await addSubscription(b.key, b.name, b.defaultInfo ?? {})
                  } catch (e) {
                    // 一键订阅失败要可见(旧代码无 catch → 只有 unhandled rejection)。
                    toast("error", `订阅「${b.name}」失败`, e instanceof Error ? e.message : String(e))
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {subscribed ? (
                  <>
                    <Icon name="check" size={13} /> 已订阅
                  </>
                ) : (
                  <>
                    <Icon name="plus" size={13} /> 一键订阅
                  </>
                )}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

