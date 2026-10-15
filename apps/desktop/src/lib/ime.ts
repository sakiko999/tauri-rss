/**
 * 输入法组合态守卫 —— **「回车提交」类输入框必须先过这里**。
 *
 * 中文/日文输入法候选未上屏时的回车是**选词**,不是提交。不拦就会:
 * 拼音 `fenzu` 直接建成名为 `fenzu` 的分组、关键词搜到一半就发请求、
 * 订阅标题存成半截拼音。全是静默的错值,不看输出根本发现不了。
 *
 * ⚠️ **取的是 `nativeEvent.isComposing`**:本仓 `@types/react` 只给**原生**
 * `KeyboardEvent` 声明了 `isComposing`,React 合成事件上该字段没类型,直接
 * `e.isComposing` 编译不过(`apps/mobile` 的 `e.nativeEvent.isComposing` 同因)。
 * `keyCode === 229` 是组合中的兜底 —— 部分输入法在「上屏那一下」keydown 里
 * `isComposing` 已是 false。
 */
import type { KeyboardEvent as ReactKeyboardEvent } from "react"

/** React 合成事件与原生事件都收(命令面板挂在 window 上,拿的是原生事件)。 */
type ImeKeyEvent = ReactKeyboardEvent | globalThis.KeyboardEvent

/** 该按键是否发生在 IME 组合过程中(是 → 调用方应直接忽略)。 */
export function isImeComposing(e: ImeKeyEvent): boolean {
  const native = "nativeEvent" in e ? e.nativeEvent : e
  return native.isComposing || native.keyCode === 229
}
