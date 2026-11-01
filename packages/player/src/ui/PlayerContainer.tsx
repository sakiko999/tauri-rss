/**
 * PlayerContainer —— 播放器容器上下文(P0a-2)。
 *
 * Radix 浮层(倍速/清晰度菜单)Portal 到 body 时,一旦播放器全屏,菜单会挂到
 * 全屏元素**外面** → 不可见。统一规则:浮层必须进**播放器容器**。
 *   - VideoShell 用本 Provider 提供容器元素(全屏/小窗/页面都在同一个容器子树内);
 *   - 控件里 `usePlayerContainer()` 取上下文;显式 `container` prop 仍然优先
 *     (有宿主要给别的挂载点)。
 *
 * `getPlayerContainer` 是给非 React 路径(如引擎回调里手挂 DOM)的逃生口。
 */

import { createContext, useContext } from "react"

const PlayerContainerContext = createContext<HTMLElement | null>(null)

export function PlayerContainerProvider({ value, children }: { value: HTMLElement | null; children: React.ReactNode }) {
  return <PlayerContainerContext.Provider value={value}>{children}</PlayerContainerContext.Provider>
}

/** 当前播放器容器(未包 Provider 时为 null)。 */
export function usePlayerContainer(): HTMLElement | null {
  return useContext(PlayerContainerContext)
}

// —— 非 React 路径的容器登记(同一时刻只有一个视频壳,最后挂载者胜出)——
let current: HTMLElement | null = null

/** VideoShell 挂载/卸载时登记(模块级,给引擎回调等非 React 路径读取)。 */
export function setPlayerContainer(el: HTMLElement | null): void {
  current = el
}

/** 当前播放器容器;没有播放器时退回 document.body(保证浮层至少可见)。 */
export function getPlayerContainer(): HTMLElement | null {
  if (current) return current
  return typeof document === "undefined" ? null : document.body
}
