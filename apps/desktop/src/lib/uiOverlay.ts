/**
 * Numbered UI Overlay 的区块声明（dev-only）。
 *
 * 用法：把属性展开到「重要区块」的根元素上：
 *
 *   <section {...overlayBlock("settings-card", "setting:playback")}>
 *   <article {...overlayBlock("reader-body")}>
 *
 * - `kind`：区块类型（人/AI 可读的短标签，如 "media-card" / "reader-body"）。
 * - `key`：可选稳定键。**重复出现的区块**（列表项/卡片）建议传业务 id；
 *   单例区块可省略（overlay 会从 fiber 业务 id / 标题 / 结构推导）。
 * - DEV 之外返回空对象 → 生产 DOM 不出现 `data-ui-overlay-*` 属性。
 */
export function overlayBlock(kind: string, key?: string): Record<string, string> {
  if (!import.meta.env?.DEV) return {}
  return {
    "data-ui-overlay-block": kind,
    ...(key ? { "data-ui-overlay-key": key } : {}),
  }
}
