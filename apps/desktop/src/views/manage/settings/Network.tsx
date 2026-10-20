/** 网络与风控 tab:全局等级 / 平台覆盖 / 后台自动刷新(docs/crawler-risk-control.md §2.4)。 */
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

const LEVEL_TEXT: Record<string, string> = {
  "0": "L0 无限制",
  "1": "L1 入门",
  "2": "L2 标准",
  "3": "L3 严格",
}

const LEVEL_OPTIONS = [
  { value: "0", label: "L0 无限制（仅调试）" },
  { value: "1", label: "L1 入门（最宽松）" },
  { value: "2", label: "L2 标准" },
  { value: "3", label: "L3 严格" },
]

/**
 * 覆盖表的行 = 平台名(宿主按 URL host 推导的平台桶)。
 *
 * ⚠️ 粒度必须停在这里：账号/冷却/配额都是**平台**维度(见风控 §2.4)，按订阅拆没有
 * 可执行语义；「谁发起请求」是渠道属性 `RssChannel.passive`，也不在这张表里。
 */
const PLATFORM_ROWS: Array<{ key: string; name: string; hint?: string }> = [
  { key: "xhs", name: "小红书" },
  { key: "bili", name: "B站" },
  { key: "weibo", name: "微博" },
  { key: "douyin", name: "抖音" },
  { key: "douyu", name: "斗鱼" },
  { key: "huya", name: "虎牙" },
  { key: "youtube", name: "YouTube" },
  { key: "twitch", name: "Twitch" },
  { key: "apple", name: "Apple 播客" },
  {
    key: "*",
    name: "其它（RSS 直链 / 未知 host）",
    hint: "所有未单独列出的 host 共用这一档。配额仍按 host 各自计数（并发/RPM/冷却互不影响），一个 feed 不会拖累另一个。",
  },
]

export function Network() {
  const settings = useDesktop((s) => s.settings)
  const setSetting = useDesktop((s) => s.setSetting)
  if (!settings) return null

  const currentLevels = settings.netLevels
  const globalLevel = settings.netLevel

  /** 空值 = 继承(从覆盖表里删掉该键);`"*"` 对未覆盖的平台同样生效。 */
  function setLevelAt(key: string, value: string) {
    const next = { ...currentLevels }
    if (value === "") delete next[key]
    else next[key] = toLevel(value)
    void setSetting("netLevels", next)
  }

  return (
    <>
      <SideCard title="网络与风控" icon="shield">
        <Row
          label="默认等级"
          help="所有未单独设置平台的默认档。L1 只兜极端情况；L2/L3 才是主动防御档。L0 仅供调试。"
        >
          <Select
            value={String(globalLevel)}
            onChange={(v) => void setSetting("netLevel", toLevel(v))}
            options={LEVEL_OPTIONS}
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

      <SideCard title="平台覆盖" icon="settings">
        <Row
          label="按平台设置"
          help="等级是平台级的：账号风控、冷却与并发/RPM 都按平台（URL host）生效，无法按订阅拆开。L0 = 该平台直通（调试用，也是绕过平台冷却的入口）。被动采集（如小红书发现页）是渠道属性，不在这里设置。"
        >
          <span className="tag">{PLATFORM_ROWS.length - 1} 个平台</span>
        </Row>
        {PLATFORM_ROWS.map(({ key, name, hint }) => {
          const own = currentLevels[key]
          // `"*"` 是兜底覆盖:精确平台 → "*" → 全局。
          const fallback = key === "*" ? globalLevel : (currentLevels["*"] ?? globalLevel)
          const inheritLabel = `继承默认（${LEVEL_TEXT[String(fallback)]}）`
          return (
            <Row key={key} label={name} help={hint ?? key}>
              <Select
                value={own === undefined ? "" : String(own)}
                onChange={(v) => setLevelAt(key, v)}
                options={[{ value: "", label: inheritLabel }, ...LEVEL_OPTIONS]}
                ariaLabel={`${name}等级`}
              />
            </Row>
          )
        })}
      </SideCard>
    </>
  )
}
