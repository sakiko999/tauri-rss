/** 网络与风控 tab:全局等级 / 平台覆盖 / 渠道覆盖 / 后台自动刷新(docs/crawler-risk-control.md §2.4)。 */
import { BUILTIN_CHANNEL_LEVELS, type AppSettings } from "@amoeba/core"
import { useDesktop } from "../../../store/index.ts"
import { SideCard } from "../../../components/StateBlock.tsx"
import { Select, Switch } from "../../../components/Modal.tsx"
import { Row } from "./Row.tsx"

type Level = 0 | 1 | 2 | 3 | 9

/** Select 只吃字符串值,这里在边界把 "0"~"9" 还原成数字等级。 */
function toLevel(v: string): Level {
  const n = Number(v)
  return n === 0 || n === 1 || n === 2 || n === 3 || n === 9 ? n : 1
}

/** 全局默认档不允许 L9(不是所有渠道都适合浏览器被动)。 */
function toGlobalLevel(v: string): AppSettings["netLevel"] {
  const n = toLevel(v)
  return n === 9 ? 1 : n
}

/** channelKey → 平台名(与 core/host 的解析保持一致)。 */
function platformOfChannel(key: string): string | undefined {
  if (key.startsWith("bili:")) return "bili"
  if (key.startsWith("weibo:")) return "weibo"
  if (key.startsWith("xhs:")) return "xhs"
  if (key.startsWith("live:douyin") || key.startsWith("douyin:")) return "douyin"
  if (key.startsWith("live:douyu") || key.startsWith("douyu:")) return "douyu"
  if (key.startsWith("live:huya") || key.startsWith("huya:")) return "huya"
  if (key.startsWith("youtube:")) return "youtube"
  if (key.startsWith("apple:")) return "apple"
  return undefined
}

const LEVEL_TEXT: Record<string, string> = {
  "0": "L0 无限制",
  "1": "L1 入门",
  "2": "L2 标准",
  "3": "L3 严格",
  "9": "L9 浏览器被动",
}

const GLOBAL_OPTIONS = [
  { value: "0", label: "L0 无限制（仅调试）" },
  { value: "1", label: "L1 入门（最宽松）" },
  { value: "2", label: "L2 标准" },
  { value: "3", label: "L3 严格" },
]

/** L9 只给声明了 `supportsL9` 的渠道；未声明时选项保留但禁用（便于显示存量值）。 */
function levelOptions(supportsL9: boolean) {
  return [
    ...GLOBAL_OPTIONS,
    {
      value: "9",
      label: supportsL9 ? "L9 浏览器被动（LX）" : "L9 浏览器被动（该渠道不支持）",
      disabled: !supportsL9,
    },
  ]
}

export function Network() {
  const settings = useDesktop((s) => s.settings)
  const setSetting = useDesktop((s) => s.setSetting)
  const subscriptions = useDesktop((s) => s.subscriptions)
  const dl = useDesktop((s) => s.dl)
  if (!settings) return null

  const currentLevels = settings.netLevels
  const globalLevel = settings.netLevel
  const hasL9 = Object.values(currentLevels).includes(9) || Object.values(BUILTIN_CHANNEL_LEVELS).includes(9)

  const allChannels = dl?.listChannels() ?? []
  /** 渠道元信息(来自注册表;未注册的 key 直接显示 key、按不支持 L9 处理)。 */
  const channelMeta = new Map<string, { name: string; supportsL9: boolean }>()
  for (const c of allChannels) channelMeta.set(c.key, { name: c.name, supportsL9: c.supportsL9 })

  /**
   * 渠道覆盖候选 = 已覆盖 + 内置默认 + 当前订阅里**有平台归属**的渠道。
   *
   * ⚠️ 不要把所有订阅的 channelKey 都列出来：内置 RSS 源（rss:hn / rss:ruanyifeng…）
   * 各自是一个 channelKey，但都走同一套通用抓取、没有平台级风控语义，逐个列出只是噪声。
   * 它们仍可经下方「添加渠道覆盖」显式加入；全局 / `"*"` 等级本来就覆盖它们。
   */
  const channelKeys = Array.from(
    new Set([
      ...Object.keys(currentLevels).filter((k) => k.includes(":")),
      ...Object.keys(BUILTIN_CHANNEL_LEVELS),
      ...subscriptions
        .map((s) => s.channelKey)
        .filter((k) => platformOfChannel(k) !== undefined),
    ]),
  ).sort()
  const addableChannels = allChannels.filter((c) => !channelKeys.includes(c.key))

  /** 某渠道"未覆盖时"会落到的等级(用于继承文案与新增覆盖的初始值)。 */
  function inheritedLevel(key: string): Level {
    const builtin = BUILTIN_CHANNEL_LEVELS[key]
    if (builtin !== undefined) return builtin
    const platform = platformOfChannel(key)
    const platformLevel = platform ? currentLevels[platform] : undefined
    return platformLevel ?? currentLevels["*"] ?? globalLevel
  }

  /** 空值 = 继承(从覆盖表里删掉该键)。 */
  function setLevelAt(key: string, value: string) {
    const next = { ...currentLevels }
    if (value === "") delete next[key]
    else next[key] = toLevel(value)
    void setSetting("netLevels", next)
  }

  /** 新增渠道覆盖:先写成它当前继承的等级,保证不改变行为,再由用户调整。 */
  function addChannelOverride(key: string) {
    if (!key) return
    const next = { ...currentLevels }
    next[key] = inheritedLevel(key)
    void setSetting("netLevels", next)
  }

  return (
    <>
      <SideCard title="网络与风控" icon="shield">
        <Row
          label="默认等级"
          help="所有未单独设置平台/渠道的默认档。L1 只兜极端情况；L2/L3 才是主动防御档。L0 仅供调试。"
        >
          <Select
            value={String(globalLevel)}
            onChange={(v) => void setSetting("netLevel", toGlobalLevel(v))}
            options={GLOBAL_OPTIONS}
            ariaLabel="默认等级"
          />
        </Row>
        <Row
          label="后台自动刷新"
          help="关闭后启动应用与新建订阅都不再自动抓取，只允许手动刷新；已缓存的条目仍可正常浏览。"
        >
          <Switch
            checked={settings.autoRefresh}
            label="后台自动刷新"
            onChange={(v) => void setSetting("autoRefresh", v)}
          />
        </Row>
      </SideCard>

      <SideCard title="渠道覆盖" icon="settings">
        <Row
          label="按渠道设置"
          help={`精确到 channelKey（优先于平台/默认等级）。内置：xhs:user 默认 L9 —— 它必须走浏览器导航读 SSR，页面内 fetch 不属于被动采集。只有声明了 L9 支持的渠道可选 L9，其余渠道选 L9 只会读缓存。${
            hasL9 ? " L9 会禁用该渠道/平台的全部应用构造请求（含播放解析）。" : ""
          }`}
        >
          <span className="tag">{channelKeys.length} 个渠道</span>
        </Row>
        {channelKeys.map((key) => {
          const own = currentLevels[key]
          const builtin = BUILTIN_CHANNEL_LEVELS[key]
          const platform = platformOfChannel(key)
          const platformLevel = platform ? currentLevels[platform] : undefined
          const fallback = currentLevels["*"] ?? globalLevel
          const meta = channelMeta.get(key)
          // 注册表尚未加载时，内置 L9 渠道按支持处理（避免瞬时把 xhs:user 的 L9 禁用）。
          const supportsL9 = meta?.supportsL9 ?? builtin === 9
          const inheritLabel =
            builtin !== undefined
              ? `内置默认（${LEVEL_TEXT[String(builtin)]}）`
              : platformLevel !== undefined
                ? `继承平台（${LEVEL_TEXT[String(platformLevel)]}）`
                : `继承默认（${LEVEL_TEXT[String(fallback)]}）`
          return (
            <Row
              key={key}
              label={meta?.name ?? key}
              help={supportsL9 ? key : `${key} · 未声明 L9 被动采集，选 L9 只会读缓存`}
            >
              <Select
                value={own === undefined ? "" : String(own)}
                onChange={(v) => setLevelAt(key, v)}
                options={[{ value: "", label: inheritLabel }, ...levelOptions(supportsL9)]}
                ariaLabel={`${key}等级`}
              />
            </Row>
          )
        })}
        {addableChannels.length ? (
          <Row label="添加渠道覆盖" help="给未列出的渠道单独设等级；新增时先写入它当前的继承值，不改变行为。">
            <Select
              value=""
              onChange={addChannelOverride}
              // 占位提示走 placeholder，不要塞进 options —— 否则它会渲染成
              // 一个可点击的 role=option（选它只是空操作）。
              placeholder={`选择渠道（${addableChannels.length} 个）`}
              options={addableChannels.map((c) => ({ value: c.key, label: c.name }))}
              ariaLabel="添加渠道覆盖"
            />
          </Row>
        ) : null}
      </SideCard>
    </>
  )
}
