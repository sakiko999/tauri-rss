/**
 * store 动作的类型别名 —— 让拆出去的设置页子组件**直接引用 store 的签名**,而不是手抄
 * 返回值(手抄踩过:`addGroup` 返 `string | null`、`autoGroupByKind` 返 `number`,
 * 抄成 `Promise<void>` 就编译不过)。
 */

import type { useDesktop } from "../../../store/index.ts"

export type Store = ReturnType<typeof useDesktop.getState>
