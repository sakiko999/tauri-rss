/**
 * cn — className 合并（tailwind-design-system skill 的标准工具）。
 *
 * clsx 处理条件类，tailwind-merge 消解冲突类（后写的同类工具类胜出，
 * 如组件默认 `p-4` 与调用方覆盖 `p-6`）。CVA 变体组件（cva()）的输出也走这里。
 */

import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
