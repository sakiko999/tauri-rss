/**
 * color — 弹幕颜色归一(十进制 → #RRGGBB)。
 *
 * 各平台弹幕 color 形态不一:bili 是十进制 ARGB、huya 是 0xRRGGBB 数字。
 * 统一到 #RRGGBB 字符串(danmaku/types.ts color 契约)。douyu 走专属 6 色映射表,不走这里。
 */

/** 十进制 ARGB → #RRGGBB(跳 alpha;4 位补零;非法返回白色)。对齐 dart LiveMessageColor.numberToColor。 */
export function argbToHex(intColor: number): string {
  const hex = intColor.toString(16)
  return hex.length === 8
    ? `#${hex.slice(2)}`
    : hex.length === 4
      ? `#00${hex}`
      : hex.length === 6
        ? `#${hex}`
        : "#ffffff"
}

/** 0xRRGGBB → #RRGGBB(huya 等数字色)。 */
export function rgbToHex(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`
}
