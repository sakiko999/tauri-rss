/**
 * PlatformBrowser —— 发现页的「分区浏览 / 搜索 / 搜主播」面板。
 *
 * 从 DiscoverPage 拆出。走 core `previewChannel(channelKey, info)` 取一次**真实数据**
 * (不建订阅);找到想看的再「订阅该分区/搜索词」→ 预设渠道丢给 AddSubscriptionDialog。
 *
 * ⚠️ desktop 直引 resolve 属**新增依赖边**(原图只有 desktop→core→crawler→resolve):
 * 输入联想需在**每键**即时取,走 channel/DataLayer 太重(序列化 + 缓存 + 状态)。
 * resolve 的 fetchDouyinSuggestions 是纯函数(无 cookie/无状态),直调最轻。
 */
import { useEffect, useRef, useState } from "react"
import type { ChannelInfo, MediaItem } from "@tauri-playground/core"
import { fetchDouyinSuggestions } from "@tauri-playground/resolve"
import { useDesktop } from "../../store/index.ts"
import { Icon } from "../../components/Icon.tsx"
import { Banner, StateBlock } from "../../components/StateBlock.tsx"
import { CardMini } from "../../components/app/cards.tsx"
import { itemKey } from "../../lib/media.ts"
import { AddSubscriptionDialog } from "../manage/AddSubscriptionDialog.tsx"
import { usePlayerNav } from "../player/usePlayerNav.ts"
import { PLATFORMS, VIEW_LABEL, type Cap } from "./platforms.ts"

export function PlatformBrowser({
  platform,
  caps,
  view,
  onView,
  onPickPlatform,
}: {
  platform: string
  caps: Record<Cap, ChannelInfo | undefined>
  view: Cap
  onView: (v: Cap) => void
  onPickPlatform: (id: string) => void
}) {
  const dl = useDesktop((s) => s.dl)
  const actions = usePlayerNav()
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

  // ⚠️ 切平台/切视图也要作废在途请求:只 setItems(null) 挡不住 —— 旧响应回来时
  // gen 仍相等会覆盖成上一个平台的数据(c4aab55 只覆盖了「被新 run 取代」)。
  // props 变化作废 + 清结果,覆盖所有切换路径(含父组件能力矩阵按钮)。
  useEffect(() => {
    ++genRef.current
    setItems(null)
    setError("")
    setBusy(false) // 在途请求的 finally 因世代不符不再清 busy → 这里补，否则按钮卡禁用
  }, [platform, view])

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
        <button
          aria-pressed={view === "category"}
          onClick={() => {
            onView("category")
            setItems(null) // 换视图清旧结果,否则「分区」的数据留在「搜索」视图里、标注对不上
          }}
          disabled={!caps.category}
        >
          分区
        </button>
        <button
          aria-pressed={view === "search"}
          onClick={() => {
            onView("search")
            setItems(null)
          }}
          disabled={!caps.search}
        >
          搜索
        </button>
        <button
          aria-pressed={view === "anchor"}
          onClick={() => {
            onView("anchor")
            setItems(null)
          }}
          disabled={!caps.anchor}
        >
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
