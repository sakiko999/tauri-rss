/**
 * danmaku 类型 —— 弹幕统一契约(对齐 dart LiveMessage + VOD 时间戳)。
 *
 * 各平台弹幕(crawler 解析)归一成 DanmakuItem,player 的 DanmakuLayer 消费。
 * - 视频弹幕(VOD):timeMs 绝对位置,按播放时间轴过滤;
 * - 直播聊天(Live):实时追加,timeMs 可省。
 * color 统一 #RRGGBB(各平台 crawler 侧归一;douyu 走专属 6 色映射表)。
 */

export interface DanmakuItem {
  text: string
  /** 发送者昵称(直播聊天必填;视频弹幕通常无,可省)。 */
  user?: string
  /** #RRGGBB。 */
  color?: string
  /** VOD 绝对位置,毫秒(与播放器 currentTime×1000 对比);live 实时追加可省。 */
  timeMs?: number
  /** B站视频弹幕 mode:1/2/3 滚动,4 底,5 顶,6 逆向,7 高级(渲染层用)。 */
  mode?: number
}

/** 弹幕流:订阅即开始,onItems 收批次(全量或增量);返回 unsubscribe。 */
export type DanmakuStream = (onItems: (items: DanmakuItem[]) => void) => () => void

/** 弹幕请求选项(platform client 的 getDanmaku 能力)。 */
export interface DanmakuOptions {
  /** 登录 cookie(部分平台握手需带,如 douyin ttwid / bili 登录态)。 */
  cookie?: string
}
