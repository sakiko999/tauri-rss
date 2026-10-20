/** 网络与风控 tab:全局等级 / 渠道覆盖 / 后台自动刷新(docs/crawler-risk-control.md §2.4)。 */
import { useDesktop } from "../../../store/index.ts"
import { SideCard } from "../../../components/StateBlock.tsx"
import { Select, Switch } from "../../../components/Modal.tsx"
import { Row } from "./Row.tsx"

type Level = 0 | 1 | 2 | 3

/** Select 只吃字符串值,这里在边界把 "0"~"3" 还原成数字等级。 */
function toLevel(v: string): Level {
  const n = Number(v)
  return n === 0 || n === 1 || n === 2 || n === 3 ? n : 1
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
  if (key.startsWith("twitch:")) return "twitch"
  return undefined
}

const LEVEL_TEXT: Record<string, string> = {
  "0": "L0 无限制",
  "1": "L1 入门",
  "2": "L2 标准",
  "3": "L3 严格",
}

const GLOBAL_OPTIONS = [
  { value: "0", label: "L0 无限制（仅调试）" },
  { value: "1", label: "L1 入门（最宽松）" },
  { value: "2", label: "L2 标准" },
  { value: "3", label: "L3 严格" },
]

/** 渠道覆盖与全局同一组防御等级 0~3;被动采集不在这里选（渠道属性）。 */
const CHANNEL_OPTIONS = GLOBAL_OPTIONS

export function Network() {
  const settings = useDesktop((s) => s.settings)
  const setSetting = useDesktop((s) => s.setSetting)
  const subscriptions = useDesktop((s) => s.subscriptions)
  const dl = useDesktop((s) => s.dl)
  if (!settings) return null

  const currentLevels = settings.netLevels
  const globalLevel = settings.netLevel

  const allChannels = dl?.listChannels() ?? []
  /** 渠道元信息(来自注册表;未注册的 key 直接显示 key、按主动渠道处理)。 */
  const channelMeta = new Map<string, { name: string; passive: boolean }>()
  for (const c of allChannels) channelMeta.set(c.key, { name: c.name, passive: c.passive })

  /**
   * 渠道覆盖候选 = 已覆盖 + 当前订阅里**有平台归属**的渠道。
   *
   * ⚠️ 不要把所有订阅的 channelKey 都列出来：内置 RSS 源（rss:hn / rss:ruanyifeng…）
   * 各自是一个 channelKey，但都走同一套通用抓取、没有平台级风控语义，逐个列出只是噪声。
   * 它们仍可经下方「添加渠道覆盖」显式加入；全局 / `"*"` 等级本来就覆盖它们。
   */
  const channelKeys = Array.from(
    new Set([
      ...Object.keys(currentLevels).filter((k) => k.includes(":")),
      ...subscriptions
        .map((s) => s.channelKey)
        .filter((k) => platformOfChannel(k) !== undefined),
    ]),
  ).sort()
  const addableChannels = allChannels.filter(
    (c) => !channelKeys.includes(c.key) && !c.passive,
  )

  /** 某渠道"未覆盖时"会落到的等级(用于继承文案与新增覆盖的初始值)。 */
  function inheritedLevel(key: string): Level {
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
            onChange={(v) => void setSetting("netLevel", toLevel(v))}
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
          help="精确到 channelKey，优先于平台/默认等级。L0 = 该平台直通（调试用，也是绕过平台冷却的入口）；L1~L3 会投影到平台（多者取严格），影响该平台的全部请求 —— 上游风控按平台/账号生效，配额无法按订阅拆分。"
        >
          <span className="tag">{channelKeys.length} 个渠道</span>
        </Row>
        {channelKeys.map((key) => {
          const own = currentLevels[key]
          const platform = platformOfChannel(key)
          const platformLevel = platform ? currentLevels[platform] : undefined
          const fallback = currentLevels["*"] ?? globalLevel
          const meta = channelMeta.get(key)
          const inheritLabel =
            platformLevel !== undefined
              ? `继承平台（${LEVEL_TEXT[String(platformLevel)]}）`
              : `继承默认（${LEVEL_TEXT[String(fallback)]}）`
          // 被动渠道不吃等级:防御等级只约束「应用构造的主动请求」,它不产生这类请求。
          if (meta?.passive) {
            return (
              <Row
                key={key}
                label={meta.name}
                help={`${key} · 该渠道固定走浏览器被动采集（导航 + 读页面），不产生应用构造的请求`}
              >
                <span className="tag">浏览器被动</span>
              </Row>
            )
          }
          return (
            <Row key={key} label={meta?.name ?? key} help={key}>
              <Select
                value={own === undefined ? "" : String(own)}
                onChange={(v) => setLevelAt(key, v)}
                options={[{ value: "", label: inheritLabel }, ...CHANNEL_OPTIONS]}
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
