/**
 * bilibili 视频流解析 —— 懒解析 playurl 全档位可播直链。
 *
 * 能力抽离:从 channels/bili/video-common.ts 迁入。独立纯函数,由 crawler/resolver
 * 按 item.url 路由调用。bvid/aid → cid → 全档位 durl mp4 直链。
 * info 携带 core 层注入的登录 cookie → 解锁更高档位(登录 1080P+);无则零登录。
 */
import type { Stream } from "@tauri-playground/xml"
import type { SourceInfo } from "../../index.ts"
import { biliClient } from "./index.ts"

/** bilibili UGC 视频懒解析:bvid/aid → cid → 全档位 durl mp4 直链。 */
export async function resolveBiliVideoPlay(itemId: string, info?: SourceInfo): Promise<Stream[]> {
  const cookie = info?.cookie || undefined
  const cid = await biliClient.resolveCid(itemId, cookie)
  return biliClient.resolvePlayUrl(itemId, cid, cookie)
}