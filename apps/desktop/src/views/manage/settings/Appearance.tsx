import { SideCard } from "../../../components/StateBlock.tsx"
/** 外观 tab:全部是**表现型**偏好(usePrefs,localStorage)。 */
import { type Density, type Measure, type Motion, type ThemeMode, usePrefs } from "../../../store/prefs.ts"
import { Row } from "./Row.tsx"

export function Appearance() {
  const p = usePrefs()
  return (
    <SideCard title="外观" icon="sun">
      <Row label="主题" help="深色为默认;「跟随系统」按操作系统的明暗设置切换。">
        <div className="segmented">
          {(["dark", "light", "system"] as ThemeMode[]).map((t) => (
            <button key={t} aria-pressed={p.theme === t} onClick={() => p.set({ theme: t })}>
              {{ dark: "深色", light: "浅色", system: "跟随系统" }[t]}
            </button>
          ))}
        </div>
      </Row>
      <Row label="密度" help="影响卡片内边距、网格间距与列表行高。">
        <div className="segmented">
          {(["compact", "standard", "relaxed"] as Density[]).map((d) => (
            <button key={d} aria-pressed={p.density === d} onClick={() => p.set({ density: d })}>
              {{ compact: "紧凑", standard: "标准", relaxed: "宽松" }[d]}
            </button>
          ))}
        </div>
      </Row>
      <Row label="正文字号" help="文章详情的正文尺寸(A− / A+ 也会改它)。">
        <div className="range">
          <input
            type="range"
            min={13}
            max={24}
            value={p.fontSize}
            aria-label="正文字号"
            onChange={(e) => p.set({ fontSize: Number(e.target.value) })}
          />
          <span className="range-value num">{p.fontSize}px</span>
        </div>
      </Row>
      <Row label="阅读行宽">
        <div className="segmented">
          {(["narrow", "comfortable", "wide"] as Measure[]).map((m) => (
            <button key={m} aria-pressed={p.measure === m} onClick={() => p.set({ measure: m })}>
              {{ narrow: "窄", comfortable: "适中", wide: "宽" }[m]}
            </button>
          ))}
        </div>
      </Row>
      <Row label="动效" help="「关闭」会去掉过渡与动画（也可由系统的减少动效设置触发）。">
        <div className="segmented">
          {(["off", "standard", "rich"] as Motion[]).map((m) => (
            <button key={m} aria-pressed={p.motion === m} onClick={() => p.set({ motion: m })}>
              {{ off: "关闭", standard: "标准", rich: "更丰富" }[m]}
            </button>
          ))}
        </div>
      </Row>
    </SideCard>
  )
}
