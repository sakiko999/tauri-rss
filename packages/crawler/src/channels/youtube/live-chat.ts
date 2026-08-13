/**
 * youtube live chat —— YouTube 直播实时聊天(InnerTube continuation 轮询)。
 *
 * 不是 WebSocket:抓直播间页面 → 提 ytcfg(INNERTUBE_API_KEY + CONTEXT) +
 * ytInitialData(初始 continuation token) → 递归 POST get_live_chat → 增量文本消息。
 * 匿名可行、零 quota、走 appHost.http 隧道(POST 已支持)。⚠️ 与播放的 ANDROID_VR
 * client 不同套(播放走 gapis ANDROID_VR;live chat 是 www.youtube.com web client
 * 的 InnerTube,context/api key 各取各的,共享 liveId)。
 *
 * poll 语义:createLiveChatPoller(liveId) 返回 `(onItems) => () => void`——
 * 启动轮询循环,onItems 收增量消息;返回 unsubscribe。首轮失败(未开播/无聊天)
 * 静默(log.warn),不回调 onItems。
 */
import type { DanmakuItem } from "../../danmaku/types.ts"
import { httpText } from "../../host.ts"
import { extractInlineJson } from "../../utils/inline-json.ts"
import { log } from "../../log.ts"
import { DESKTOP_CHROME_UA } from "../../utils/ua.ts"

const YOUTUBE = "https://www.youtube.com"
const CHAT_API = "https://www.youtube.com/youtubei/v1/live_chat/get_live_chat"
const WEB_UA = DESKTOP_CHROME_UA
/** 服务端未给 timeoutMs 时的兜底轮询间隔,ms。 */
const DEFAULT_TIMEOUT_MS = 5000

interface ChatState {
  token: string
  timeoutMs: number
  context: Record<string, any>
  apiKey: string
}

/** 递归搜任意子树里的 reloadContinuationData.continuation(结构变更兜底)。 */
function findReloadContinuation(node: unknown, depth = 0): string {
  if (!node || typeof node !== "object" || depth > 10) return ""
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findReloadContinuation(n, depth + 1)
      if (r) return r
    }
    return ""
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "reloadContinuationData" && (v as { continuation?: unknown })?.continuation) {
      return String((v as { continuation: unknown }).continuation)
    }
    const r = findReloadContinuation(v, depth + 1)
    if (r) return r
  }
  return ""
}

/** 初始 continuation token:优先页面标准路径,结构变更递归兜底。 */
function initialContinuation(data: Record<string, any>): string {
  const direct =
    data?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer?.continuations?.[0]
      ?.reloadContinuationData?.continuation
  return String(direct ?? "") || findReloadContinuation(data)
}

/** message.runs → 纯文本(text run 直取,emoji run 取 emojiId)。 */
function runsToText(
  runs?: Array<{ text?: string; emoji?: { emojiId?: string } }>,
): string {
  if (!runs) return ""
  return runs
    .map((r) => r.text ?? r.emoji?.emojiId ?? "")
    .join("")
    .trim()
}

/** 抓直播间页面(web client 页面,SSR 内嵌 ytcfg + ytInitialData)。 */
async function fetchPage(liveId: string): Promise<string> {
  return httpText(`${YOUTUBE}/live/${liveId}`, {
    "user-agent": WEB_UA,
    "accept-language": "en-US,en;q=0.9",
  })
}

/** 初始化:提 apiKey + context + 初始 token。 */
async function initChat(liveId: string): Promise<ChatState> {
  const html = await fetchPage(liveId)
  // ⚠️ 用对象形式 marker(`ytcfg.set({`)——页面顶部有单 key 调用
  // `ytcfg.set('KEY', value)`,裸 `ytcfg.set(` 会错位截取。
  const ytcfg = extractInlineJson(html, "ytcfg.set({", undefined, "YouTube ytcfg")
  const apiKey = String(ytcfg.INNERTUBE_API_KEY ?? "")
  const context = (ytcfg.INNERTUBE_CONTEXT ?? {}) as Record<string, any>
  const initial = extractInlineJson(html, "ytInitialData", undefined, "YouTube ytInitialData")
  const token = initialContinuation(initial)
  if (!apiKey || !token) {
    throw new Error("youtube live chat: 未开播或无聊天(页面无 liveChat continuation)")
  }
  return { token, timeoutMs: DEFAULT_TIMEOUT_MS, context, apiKey }
}

/** 轮询一次:POST get_live_chat → 提取增量文本 + 下一 token。 */
async function pollOnce(liveId: string, state: ChatState, onItems: (items: DanmakuItem[]) => void): Promise<void> {
  const res = await globalThis.appHost.http.request({
    url: `${CHAT_API}?key=${encodeURIComponent(state.apiKey)}`,
    method: "POST",
    responseType: "json",
    headers: {
      "user-agent": WEB_UA,
      "content-type": "application/json",
      origin: YOUTUBE,
      referer: `${YOUTUBE}/live/${liveId}`,
    },
    body: JSON.stringify({ context: state.context, continuation: state.token }),
  })
  if (res.status !== 200) throw new Error(`youtube live chat HTTP ${res.status}`)
  const data = res.body as { continuationContents?: { liveChatContinuation?: Record<string, any> } }
  const lc = data?.continuationContents?.liveChatContinuation
  if (!lc) throw new Error("youtube live chat: 无 continuation(直播结束?)")

  const items: DanmakuItem[] = []
  for (const action of (lc.actions ?? []) as Array<{ addChatItemAction?: { item?: { liveChatTextMessageRenderer?: { message?: { runs?: Array<{ text?: string; emoji?: { emojiId?: string } }> }; authorName?: { simpleText?: string } } } } }>) {
    const msg = action?.addChatItemAction?.item?.liveChatTextMessageRenderer
    if (!msg) continue
    const text = runsToText(msg.message?.runs)
    if (text) items.push({ text, user: msg.authorName?.simpleText ?? "" })
  }
  if (items.length) onItems(items)

  const cont = (lc.continuations?.[0]?.timedContinuationData ?? lc.continuations?.[0]?.invalidationContinuationData) as
    | { continuation?: string; timeoutMs?: number }
    | undefined
  if (!cont?.continuation) throw new Error("youtube live chat: 直播结束(无下一 continuation)")
  state.token = cont.continuation
  state.timeoutMs = cont.timeoutMs ?? DEFAULT_TIMEOUT_MS
}

/** 创建直播聊天轮询:返回 (onItems) => unsubscribe。 */
export function createLiveChatPoller(liveId: string): (onItems: (items: DanmakuItem[]) => void) => () => void {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let statePromise: Promise<ChatState> | null = null

  function schedule(state: ChatState, onItems: (items: DanmakuItem[]) => void): void {
    if (cancelled) return
    timer = setTimeout(() => {
      void pollOnce(liveId, state, onItems)
        .catch((e) => {
          if (!cancelled) log.youtube.warn("live chat 轮询失败:", (e as Error)?.message)
        })
        .finally(() => schedule(state, onItems))
    }, state.timeoutMs)
  }

  return (onItems) => {
    if (!statePromise) {
      statePromise = initChat(liveId)
        .catch((e) => {
          log.youtube.warn("live chat 初始化失败(未开播?):", (e as Error)?.message)
          throw e
        })
    }
    void statePromise.then((state) => schedule(state, onItems)).catch(() => {})
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }
}
