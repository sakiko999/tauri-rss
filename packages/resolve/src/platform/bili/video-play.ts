/**
 * bilibili 视频流解析 —— 懒解析 playurl 全档位可播直链。
 *
 * 能力抽离:从 channels/bili/video-common.ts 迁入。独立纯函数,由 crawler/resolver
 * 按 item.url 路由调用。bvid/aid → cid → 全档位 durl mp4 直链。
 * info 携带 core 层注入的登录 cookie → 解锁更高档位(登录 1080P+);无则零登录。
 *
 * 顺带取 UP 主标的章节(`view_points`):多数视频没有,空数组即「没有章节」;
 * 取失败也只是少一栏,不拖垮播放。
 */

import type { Stream } from "@amoeba/xml"

import type { SourceInfo } from "../../index.ts"
import { biliClient } from "./index.ts"

/** 章节时间点(秒 + UP 主写的标题)。 */
export interface PlaybackChapter {
  t: number
  label: string
}

/** bilibili UGC 视频懒解析:bvid/aid → cid → 全档位 durl mp4 直链 + 章节。 */
export async function resolveBiliVideoPlay(
  itemId: string,
  info?: SourceInfo,
): Promise<{ streams: Stream[]; chapters: PlaybackChapter[] }> {
  const cookie = info?.cookie || undefined
  const cid = await biliClient.resolveCid(itemId, cookie)
  const streams = await biliClient.resolvePlayUrl(itemId, cid, cookie)
  // 放在 playurl 之后:章节接口要 cid,而 playurl 是主路径,失败要原样抛。
  const chapters = await biliClient.viewPoints(itemId, cid, cookie).catch(() => [])
  return { streams, chapters }
}
