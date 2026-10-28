/**
 * 输入法组合态守卫自检。
 *
 * 这条守卫本身极短,但它守的是**静默错值**(名叫 `fenzu` 的分组、半截标题)。
 * 真正的失败模式是「keyCode 兜底被删掉」或「nativeEvent 取值取错」—— 两者都
 * 不会让 tsc 报错,只会让中文输入法用户偶尔建出垃圾数据,所以留断言。
 */

import { isImeComposing } from "./ime.ts"

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  if (!cond) {
    failed += 1
    console.error(`✘ ${msg}`)
  }
}

/** 造一个够用的假事件(只需 isComposing / keyCode / nativeEvent)。 */
const ev = (o: { isComposing?: boolean; keyCode?: number; native?: boolean }) =>
  (o.native
    ? { isComposing: o.isComposing ?? false, keyCode: o.keyCode ?? 0 }
    : {
        nativeEvent: { isComposing: o.isComposing ?? false, keyCode: o.keyCode ?? 0 },
        isComposing: undefined,
        keyCode: 0,
      }) as never

// ── React 合成事件路径(输入框) ────────────────────────────────────────────
ok(isImeComposing(ev({ isComposing: true })), "合成事件 isComposing=true 应判为组合中")
ok(isImeComposing(ev({ keyCode: 229 })), "合成事件 keyCode=229 应判为组合中(上屏那一下的兜底)")
ok(!isImeComposing(ev({})), "合成事件普通回车应放行")

// ── 原生事件路径(window 上的命令面板) ────────────────────────────────────
ok(isImeComposing(ev({ isComposing: true, native: true })), "原生 isComposing=true 应判为组合中")
ok(isImeComposing(ev({ keyCode: 229, native: true })), "原生 keyCode=229 应判为组合中")
ok(!isImeComposing(ev({ native: true })), "原生普通回车应放行")

if (failed) {
  console.error(`✘ ime 守卫自检失败 ${failed} 条`)
  process.exit(1)
}
console.log("✔ ime 守卫自检通过(nativeEvent 取值 + 229 兜底 + 原生/合成两条路径)")
