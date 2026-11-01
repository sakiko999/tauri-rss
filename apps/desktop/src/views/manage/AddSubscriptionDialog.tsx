/**
 * AddSubscriptionDialog —— 添加订阅弹窗(radix Dialog + 设计系统类名)。
 *
 * 两种入口:①搜索添加(调平台搜索接口选房间/UP主)②浏览渠道(按平台分类 + 搜索的
 * 渠道目录,选中后出摘要 + 参数表单)。两种都接标题 + 归入分组 + 独立刷新间隔。
 *
 * 渠道来自 core `dl.listChannels()`;参数表单由 `sourceInfoTpl` 动态渲染;
 * 带 `defaultInfo` 的渠道表单已预填，直接提交即可。提交走 store.addSubscription
 * (内部 dl.addSubscription = add + refresh)。
 *
 * ⚠️ 两大块 JSX 已拆到同目录的 `AddPanels.tsx`(SearchPanel 搜索添加 / ChannelPanel
 * 按渠道配置);这里只留**表单状态与提交编排**。
 */

import { platformDef } from "@amoeba/platform"
import { useEffect, useMemo, useState } from "react"

import { Button } from "../../components/Button.tsx"
import { Icon } from "../../components/Icon.tsx"
import { Modal, Select } from "../../components/Modal.tsx"
import { Banner } from "../../components/StateBlock.tsx"
import {
  type Candidate,
  candidateKey,
  candidatesFromSearch,
  candidatesFromUsers,
  type CandidateTarget,
  isManualEntryOnly,
  mergeCandidates,
  mergeValues,
  multiParamOf,
  searchSources,
  splitValues,
  subsHolding,
  subsOfChannel,
  TARGET_LABEL,
  targetKey,
  valueList,
} from "../../lib/subscriptions.ts"
import { useLatestOnly } from "../../lib/useLatestOnly.ts"
import { useDesktop } from "../../store/index.ts"
import { ChannelPanel, SearchPanel } from "./AddPanels.tsx"

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
  /** 各渠道已有的订阅条数：目录行显示「已订阅 N」，无参渠道据此禁用重复订阅。 */
  const subCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const s of subscriptions) m[s.channelKey] = (m[s.channelKey] ?? 0) + 1
    return m
  }, [subscriptions])

  const [mode, setMode] = useState<"search" | "manual">("search")
  /** 手工模式选中的渠道(搜索模式的订阅渠道由平台推导,不走这个)。 */
  const [channelKey, setChannelKey] = useState("")
  const [values, setValues] = useState<Record<string, string>>({})
  /** 统一搜索:关键词 + 搜索范围("all" 或平台 id)+ 合并后的候选。 */
  const [keyword, setKeyword] = useState("")
  const [platformFilter, setPlatformFilter] = useState("all")
  const [cands, setCands] = useState<Candidate[]>([])
  const [searched, setSearched] = useState(false)
  const [failedPlatforms, setFailedPlatforms] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  /** 搜索模式:选中的候选键(`candidateKey`;'' = 未选,提交按钮禁用)。 */
  const [candidateValue, setCandidateValue] = useState("")
  /** 选中候选后「添加为」哪个目标(直播间 / 用户主页);换候选时归零。 */
  const [targetIndex, setTargetIndex] = useState(0)
  /** 手工模式：列表型参数(roomIds)可并入已有订阅。 */
  const [manualTargetId, setManualTargetId] = useState("new")
  /** 搜索模式：直播目标(roomIds)同样可并入已有订阅（与手工模式同一语义）。 */
  const [searchTargetId, setSearchTargetId] = useState("new")
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
  // ⚠️ 但两个**非预制**的通用渠道必须放行:
  //   `rss:url`     = 任意 RSS 直链(OPML 导入也落它);
  //   `rss:podcast` = 播客 RSS(解 enclosure → kind:audio,条目可播)。
  // 原先把整个 `rss:` 前缀都滤掉,导致**手工加外部 feed / 订阅一个播客都没有入口**。
  const RSS_GENERIC = new Set(["rss:url", "rss:podcast"])
  // 分区 / 用户主页 / 搜索类渠道只从「统一搜索」或发现页进入：不再列出需要手填
  // uid / 分区 ID / 关键词的入口（2026-11-01）。
  const builtins = channels.filter(
    (c) =>
      !c.key.startsWith("rsshub:") && (!c.key.startsWith("rss:") || RSS_GENERIC.has(c.key)) && !isManualEntryOnly(c),
  )
  // 36 条内置 RSS 直链(Hacker News / V2EX 等)不铺成 chip(太噪),单独用下拉暴露。
  // 它们带 defaultInfo,选中即可直接订阅。
  const rssFeeds = channels.filter((c) => c.key.startsWith("rss:") && !RSS_GENERIC.has(c.key))
  const rsshub = channels.filter((c) => c.key.startsWith("rsshub:"))
  const channel = channels.find((c) => c.key === channelKey)

  /** 统一搜索的取数源(用户搜索 + 主播搜索)。 */
  const sources = useMemo(() => searchSources(channels), [channels])
  /** 可指定搜索范围的平台(按取数源顺序去重)。 */
  const searchPlatforms = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sources) m.set(s.platform, platformDef(s.platform)?.label ?? s.platform)
    return [...m].map(([id, label]) => ({ id, label }))
  }, [sources])
  /** 当前是否处于搜索添加(有搜索源,且用户没切到手工)。 */
  const searchMode = mode === "search" && (sources.length > 0 || !!presetKey)

  /** 选中的候选(候选自带多个可落地目标)。 */
  const selectedCand = cands.find((c) => candidateKey(c) === candidateValue)
  /** 当前选中的落地点(「添加为」);越界时回落首项。 */
  const selectedTarget: CandidateTarget | undefined = selectedCand?.targets[targetIndex] ?? selectedCand?.targets[0]
  /** 落地订阅的渠道(搜索模式 = 选中目标;手工模式 = 选中的渠道)。 */
  const landChannel = searchMode ? channels.find((c) => c.key === selectedTarget?.channelKey) : channel
  /** 每个落地点的「已订阅」状态(同一候选的直播间/主页可能只有一个已订)。 */
  const subscribedTargets = useMemo(() => {
    const s = new Set<string>()
    for (const c of cands) {
      for (const t of c.targets) {
        if (subsHolding(subscriptions, t.channelKey, t.param, t.value).length) s.add(targetKey(t))
      }
    }
    return s
  }, [cands, subscriptions])
  /** 候选是否至少有一个目标已订阅(列表行的「已订阅」标记)。 */
  const subscribed = useMemo(() => {
    const s = new Set<string>()
    for (const c of cands) {
      if (c.targets.some((t) => subscribedTargets.has(targetKey(t)))) s.add(candidateKey(c))
    }
    return s
  }, [cands, subscribedTargets])

  useEffect(() => {
    if (!open) return
    latest.invalidate() // 重开面板作废上一次会话的在途搜索
    setError("")
    setMissing([])
    setBusy(false)
    setGroupId("")
    setTtl("")
    setCandidateValue("")
    setTargetIndex(0)
    setManualTargetId("new")
    setSearchTargetId("new")
    // 作废在途搜索后其 finally 不会再清 searching —— 这里显式复位，否则重开弹窗
    // 按钮永久转圈（旧 runSearch 的世代已失效）。
    setSearching(false)
    // 带预置渠道(发现页「订阅该分区」)→ 直接进手工模式,预填参数。
    setMode(presetKey ? "manual" : "search")
    setKeyword("")
    setPlatformFilter("all")
    setCands([])
    setSearched(false)
    setFailedPlatforms([])
    // 不预选渠道:打开就是渠道目录。原先默认落「RSS 直链」,等于用户还没看目录,
    // 下面那套参数表单就已经按一条他没选的渠道填好了。
    const key = presetKey ?? ""
    const ch = channels.find((c) => c.key === key)
    setChannelKey(key)
    setValues({ ...(ch?.defaultInfo ?? {}), ...(presetKey ? presetInfo : {}) })
    // 标题留空,由 placeholder 显示渠道名;提交时仍回退到 channel.name。
    // 预置入口(发现页「订阅该分区」)才用渠道名做初始标题。
    setTitle(presetKey ? (ch?.name ?? "") : "")
  }, [open, channels, presetKey, presetInfo])

  const fields = channel?.sourceInfoTpl ?? []
  /** 手工模式可并入的已有订阅：只有列表型参数(roomIds)才有「加进去」语义。 */
  const manualParam = channel?.sourceInfoTpl?.[0]?.key
  const manualTargets = useMemo(
    () => (multiParamOf(channel) ? subsOfChannel(subscriptions, channelKey) : []),
    [channel, channelKey, subscriptions],
  )
  /** 当前是「并入已有订阅」：此时标题/分组/刷新间隔都不生效，不渲染以免误解。 */
  const merging = searchMode ? searchTargetId !== "new" : manualTargetId !== "new"
  /** 搜索模式下当前落地目标可并入的已有订阅（只有 roomIds 列表型参数才有）。 */
  const searchTargets = useMemo(
    () => (selectedTarget && multiParamOf(landChannel) ? subsOfChannel(subscriptions, selectedTarget.channelKey) : []),
    [selectedTarget, landChannel, subscriptions],
  )

  /**
   * 统一搜索:一个关键词并发查取数源(用户搜索 + 主播搜索),**边到边填** ——
   * 不等最慢的浏览器源,先返回的平台先出现在列表里。单个源失败不拖垮整次搜索
   * (失败平台单独列出,多是没登录/风控)。
   */
  async function runSearch() {
    const kw = keyword.trim()
    const active = sources.filter((s) => platformFilter === "all" || s.platform === platformFilter)
    if (!dl || !kw || !active.length) return
    const gen = latest.start()
    setSearching(true)
    setError("")
    setCandidateValue("")
    setTargetIndex(0)
    setSearchTargetId("new")
    setTitle("")
    setCands([])
    setFailedPlatforms([])
    setSearched(true)
    // 按取数源顺序(平台 → 用户/主播)排列,同平台结果连在一起。
    // ⚠️ 排序键必须是**取数源**顺序，不是落地渠道(targets[0].channelKey)：
    // 两者是不同的键空间（bili:user → bili:user_video），按落地渠道查会恒 99。
    const candidateOrder = new Map<string, number>()
    const acc: Candidate[] = []
    /** 取数源失败的平台（id）与至少成功过一次的平台。 */
    const failed = new Set<string>()
    const succeeded = new Set<string>()
    const flushFailed = () => {
      const labels = [...failed].filter((p) => !succeeded.has(p)).map((p) => platformDef(p)?.label ?? p)
      setFailedPlatforms(labels)
    }
    const flush = () => {
      const merged = mergeCandidates(acc)
      merged.sort((a, b) => (candidateOrder.get(candidateKey(a)) ?? 99) - (candidateOrder.get(candidateKey(b)) ?? 99))
      setCands(merged)
    }
    try {
      await Promise.all(
        active.map(async (s, i) => {
          try {
            const r = await dl.previewChannel(s.channelKey, { [s.field]: kw })
            if (latest.stale(gen)) return
            // 用户搜索产主页 URL(候选值从 URL 解析);主播搜索产 live 条目(roomId)。
            const list =
              s.kind === "user" ? candidatesFromUsers(r.items, s.platform) : candidatesFromSearch(r.items, s.platform)
            // 每个源只取前 10:多源全量合并会有几百行,候选列表是「挑一个」不是浏览。
            acc.push(...list.slice(0, 10))
            succeeded.add(s.platform)
            failed.delete(s.platform)
            for (const c of list) {
              const key = candidateKey(c)
              const prev = candidateOrder.get(key)
              if (prev === undefined || i < prev) candidateOrder.set(key, i)
            }
            flush()
            flushFailed()
          } catch {
            if (latest.stale(gen)) return
            // 同平台只要有一个取数源成功，就不把整站标成「没有返回结果」。
            failed.add(s.platform)
            flushFailed()
          }
        }),
      )
    } catch (e) {
      if (latest.stale(gen)) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!latest.stale(gen)) setSearching(false)
    }
  }

  /** 换搜索范围:作废在途搜索并清空上一范围的结果(不自动发起新搜索)。 */
  function pickPlatform(id: string) {
    latest.invalidate()
    setSearching(false) // 作废在途搜索后其 finally 不会再清（见 open effect）
    setPlatformFilter(id)
    setCands([])
    setCandidateValue("")
    setTargetIndex(0)
    setSearchTargetId("new")
    setTitle("")
    setFailedPlatforms([])
    setSearched(false)
  }

  function pick(key: string) {
    const ch = channels.find((c) => c.key === key)
    setChannelKey(key)
    setValues({ ...(ch?.defaultInfo ?? {}) })
    setTitle("")
    setMissing([])
    setCandidateValue("")
    setTargetIndex(0)
    setManualTargetId("new")
  }

  /** 选中/取消选中一个候选(再点一次 = 取消)。 */
  function pickCandidate(c: Candidate) {
    const key = candidateKey(c)
    if (candidateValue === key) {
      setCandidateValue("")
      return
    }
    setCandidateValue(key)
    setTargetIndex(0)
    setSearchTargetId("new")
    setTitle(c.label)
    // 重复只作提示(在 targetHint 里),不拦提交 —— 重复订阅是合法选择。
  }

  async function submit() {
    if (searchMode) {
      /* ── 搜索模式:把选中的候选落到「添加为」选中的目标 ────────────── */
      if (!selectedCand || !selectedTarget) {
        setError("请先搜索并选中一项。")
        return
      }
      setBusy(true)
      setError("")
      try {
        const { channelKey: landKey, param, value } = selectedTarget
        // 列表型目标(roomIds)+ 选中已有订阅 → 追加进去，不新建（与手工模式同语义）。
        if (multiParamOf(landChannel) && searchTargetId !== "new") {
          const target = searchTargets.find((s) => s.id === searchTargetId)
          if (!target) throw new Error("目标订阅已不存在,可能刚刚被删除,请改选「新建订阅」。")
          const { merged, added } = mergeValues(valueList(target, param), [value])
          if (!added.length) {
            toast("info", "已经在该订阅里了", `「${target.title}」中已有这个房间。`)
            onOpenChange(false)
            return
          }
          await updateSubscription(target.id, { info: { ...target.info, [param]: merged.join(",") } })
          toast("ok", `已并入「${target.title}」`, `现在共 ${merged.length} 个房间，内容已更新。`)
          onOpenChange(false)
          return
        }
        // 直播类目标落地 roomIds,用户类落地 uid/channelId…
        const info = { [param]: value }
        const id = await addSubscription(landKey, title.trim() || selectedCand.label, info, {
          groupId: groupId || null,
          refreshIntervalSec: Number(ttl) > 0 ? Number(ttl) * 60 : undefined,
        })
        if (!id) throw new Error("数据层未初始化")
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
      // 列表型参数 + 选中已有订阅 → 把本次填的房间并进去（不新建）。
      // 与搜索模式的「添加到」同一语义，但手工模式没有候选，直接用工单里的值。
      if (multiParamOf(channel) && manualTargetId !== "new" && manualParam) {
        const target = manualTargets.find((s) => s.id === manualTargetId)
        if (!target) throw new Error("目标订阅已不存在,可能刚被删除,请改选「新建订阅」。")
        const held = valueList(target, manualParam)
        const { merged, added } = mergeValues(held, splitValues(values[manualParam], manualParam))
        if (!added.length) {
          toast("info", "已经在该订阅里了", `「${target.title}」中已有这些房间。`)
          onOpenChange(false)
          return
        }
        const info = { ...target.info, [manualParam]: merged.join(",") }
        await updateSubscription(target.id, { info })
        toast("ok", `已并入「${target.title}」`, `新增 ${added.length} 个房间，现在共 ${merged.length} 个。`)
        onOpenChange(false)
        return
      }
      const ttlMin = Number(ttl)
      // 空字段不入 info:cookie 等可选字段留空串会被 sourceInfoFor 视为
      // 「显式强制匿名」(键存在即尊重),把 settings 登录态屏蔽掉 —— 留空 = 未填。
      const info = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""))
      const id = await addSubscription(channelKey, title.trim() || channel.name || channelKey, info, {
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

  /** 选中候选后的提示。用户/主播都是单值落地，只能新建。 */
  const targetHint = (() => {
    if (!selectedCand || !selectedTarget) return ""
    const what = TARGET_LABEL[selectedTarget.kind]
    return subscribedTargets.has(targetKey(selectedTarget))
      ? `「${selectedCand.label}」的${what}已在订阅里，新建会得到两条相同订阅。`
      : `已选中「${selectedCand.label}」，将添加${what}。`
  })()

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="添加订阅"
      size="wide"
      dismissable={!busy}
      footer={
        <>
          <span className="t-micro t-dim flex-1">
            {searchMode
              ? targetHint || "先搜索并选中一个用户或主播，再添加到订阅。"
              : !channelKey
                ? "先从目录里选一个渠道。"
                : channel?.defaultInfo
                  ? "该渠道带默认参数，可直接订阅。"
                  : "请填写必填参数后再订阅。"}
          </span>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={busy || (searchMode ? !selectedTarget : !channelKey)} onClick={() => void submit()}>
            {busy ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="plus" size={14} />} 添加订阅
          </Button>
        </>
      }
    >
      <div className="add-mode">
        <span className="segmented" role="tablist" aria-label="添加方式">
          <button
            role="tab"
            aria-pressed={mode === "search"}
            onClick={() => {
              latest.invalidate() // 切模式作废在途搜索，避免回填到另一模式的面板
              setSearching(false)
              setMode("search")
              setSearchTargetId("new")
            }}
          >
            <Icon name="search" size={14} /> 搜索添加
          </button>
          <button
            role="tab"
            aria-pressed={mode === "manual"}
            onClick={() => {
              latest.invalidate()
              setSearching(false)
              setMode("manual")
              setManualTargetId("new")
            }}
          >
            <Icon name="layers" size={14} /> 浏览渠道
          </button>
        </span>
      </div>

      {searchMode ? (
        <SearchPanel
          platforms={searchPlatforms}
          platform={platformFilter}
          onPlatform={pickPlatform}
          keyword={keyword}
          onKeyword={setKeyword}
          onSearch={() => void runSearch()}
          searching={searching}
          searched={searched}
          cands={cands}
          candidateValue={candidateValue}
          onPickCandidate={pickCandidate}
          subscribed={subscribed}
          failedPlatforms={failedPlatforms}
          targets={searchTargets}
          targetId={searchTargetId}
          onTargetId={setSearchTargetId}
          landParam={selectedTarget?.param}
        />
      ) : (
        <ChannelPanel
          builtins={builtins}
          rssFeeds={rssFeeds}
          rsshub={rsshub}
          channelKey={channelKey}
          onPick={pick}
          channel={channel}
          fields={fields}
          values={values}
          onValue={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
          missing={missing}
          targets={manualTargets}
          targetId={manualTargetId}
          onTargetId={setManualTargetId}
          landParam={manualParam}
          subCounts={subCounts}
        />
      )}

      {landChannel && !merging ? (
        <div className="stack" style={{ gap: "var(--sp-5)" }}>
          {/* 同一人既有直播间又有主页时,由用户选这一条结果要加哪种。 */}
          {searchMode && selectedCand && selectedCand.targets.length > 1 ? (
            <div className="field">
              <span className="field-label" id="lbl-target-kind">
                添加为
              </span>
              <div className="chip-row" role="radiogroup" aria-labelledby="lbl-target-kind">
                {selectedCand.targets.map((t, i) => (
                  <button
                    key={targetKey(t)}
                    className="chip"
                    role="radio"
                    aria-checked={selectedTarget === t}
                    onClick={() => {
                      setTargetIndex(i)
                      setSearchTargetId("new")
                    }}
                  >
                    <Icon name={t.kind === "live" ? "radio" : "user"} size={14} />
                    {TARGET_LABEL[t.kind]}
                    {subscribedTargets.has(targetKey(t)) ? <span className="cand-chip">已订阅</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="field">
            <label className="field-label" htmlFor="add-title">
              订阅标题
            </label>
            <input
              id="add-title"
              className="input"
              value={title}
              placeholder={landChannel.name}
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
            <span className="field-help">该订阅的刷新间隔优先于全局设置，可降低被频繁访问的源的压力。</span>
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
