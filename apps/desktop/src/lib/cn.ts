import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** 合并 className:clsx 条件拼装 + tailwind-merge 去重冲突类。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
