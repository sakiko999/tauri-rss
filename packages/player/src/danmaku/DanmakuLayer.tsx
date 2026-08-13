/**
 * DanmakuLayer —— Canvas 2D 弹幕渲染层(自研,不依赖第三方弹幕库)。
 *
 * 消费统一 DanmakuStream(订阅即开始,全量或增量由实现方定),内部按 timeMs 分流:
 *   - 有 timeMs(VOD 视频弹幕):累积到全量池,按 currentTime×1000 时间窗口发射
 *     (暂停冻结;seek 回跳重置发射起点,已发射不重发);
 *   - 无 timeMs(live 直播聊天):实时增量直接发射(不受暂停影响)。
 * 渲染:requestAnimationFrame 自绘循环,不随 React 每帧重渲染。
 * mode 分支:1/2/3/6 滚动(右→左),4 底 / 5 顶 静态居中停留。
 */
import { useEffect, useRef } from "react"
import type { DanmakuItem, DanmakuStream } from "@tauri-playground/crawler"
import { log } from "../log/index.ts"

const FONT = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif'
const FONT_SIZE = 22
const LINE_HEIGHT = FONT_SIZE * 1.35
/** 滚动弹幕从右到左全程时长,ms。 */
const SCROLL_MS = 6000
/** 顶/底静态停留时长,ms。 */
const STATIC_MS = 4000
/** VOD 预取提前量,ms(提前进入右边缘,避免时间点到了才闪现)。 */
const PRE_MS = 500
/** 同 lane 弹幕间的最小右端间隔,px。 */
const LANE_GAP = 24
/** seek 回跳阈值,ms(超过则重置 VOD 发射起点,防跳过未看区域弹幕丢失)。 */
const SEEK_RESET_MS = 5000

interface Active {
  item: DanmakuItem
  born: number
  x: number
  lane: number
  width: number
  speed: number
  /** true = 静态(顶/底),false = 滚动。 */
  isStatic: boolean
}

/** 滚动 lane 状态:该 lane 最后一条弹幕的右端位置。 */
type Lanes = number[]

/** 顶/底弹幕固定 lane(顶=顶部第 0 条,底=最末条)。 */
function staticLaneOf(mode: number, laneCount: number): number {
  return mode === 4 ? Math.max(0, laneCount - 1) : 0
}

/** 创建活跃弹幕:测宽 + 分配 lane + 定速(滚动)。 */
function mkActive(item: DanmakuItem, ctx: CanvasRenderingContext2D, w: number, lanes: Lanes, now: number): Active {
  ctx.font = `${FONT_SIZE}px ${FONT}`
  const width = ctx.measureText(item.text).width
  const mode = item.mode ?? 1
  const isStatic = mode === 4 || mode === 5
  if (isStatic) {
    return { item, born: now, x: 0, lane: staticLaneOf(mode, lanes.length), width, speed: 0, isStatic }
  }
  // 滚动:找「右端最小」的 lane(最空)。
  let best = 0
  let bestRight = Infinity
  for (let i = 0; i < lanes.length; i++) {
    const r = lanes[i] ?? -Infinity
    if (r < bestRight) {
      bestRight = r
      best = i
    }
  }
  const lastRight = lanes[best] ?? -Infinity
  // 从右边缘进入;若 lane 被占用(上一条未滚出)则紧跟其后。
  const x = Math.max(w, lastRight + LANE_GAP)
  lanes[best] = x + width
  return { item, born: now, x, lane: best, width, speed: (w + width + LANE_GAP) / (SCROLL_MS / 1000), isStatic }
}

export function DanmakuLayer({
  danmaku,
  currentTime,
  live,
  paused,
}: {
  /** 弹幕流(随 resolve 结果附带,已探测;无弹幕平台不传,不渲染层)。 */
  danmaku?: DanmakuStream
  /** 播放时间,秒(VOD 窗口发射用)。 */
  currentTime: number
  /** 媒体是否直播(决定暂停冻结:点播暂停弹幕停,直播暂停聊天照收)。 */
  live: boolean
  paused: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pendingRef = useRef<DanmakuItem[]>([])
  const activeRef = useRef<Active[]>([])
  const lanesRef = useRef<Lanes>([])
  /** VOD 全量池(有 timeMs 的累积,按时间轴发射)。 */
  const vodPoolRef = useRef<DanmakuItem[]>([])
  const spawnedRef = useRef<Set<number>>(new Set())
  const lastTRef = useRef(0)
  const lastNowRef = useRef(0)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const liveRef = useRef(live)
  liveRef.current = live

  // 订阅弹幕流(已探测,直接订阅)。有 timeMs → 累积 vodPool(待时间窗口);
  // 无 timeMs → 直接发射。生命周期(退订)收敛在本层,danmaku 身份由 resolve
  // 结果决定,身份稳定不反复重订阅。
  useEffect(() => {
    if (!danmaku) return
    log.danmakuSubscribed()
    const unsub = danmaku((batch) => {
      const vod: DanmakuItem[] = []
      const liveNow: DanmakuItem[] = []
      for (const d of batch) (d.timeMs !== undefined ? vod : liveNow).push(d)
      if (vod.length) vodPoolRef.current.push(...vod)
      if (liveNow.length) pendingRef.current.push(...liveNow)
      if (vod.length || liveNow.length) log.danmakuBatch({ vod: vod.length, live: liveNow.length })
    })
    return () => {
      log.danmakuUnsubscribed()
      unsub()
    }
  }, [danmaku])

  // VOD 时间窗口发射(暂停不推进;seek 大幅回跳重置起点,已发射不重发)。
  useEffect(() => {
    if (pausedRef.current) return
    const t = currentTime * 1000
    if (t < lastTRef.current - SEEK_RESET_MS) {
      lastTRef.current = t
      return
    }
    if (t <= lastTRef.current) return
    const start = lastTRef.current
    lastTRef.current = t
    const fresh: DanmakuItem[] = []
    for (const d of vodPoolRef.current) {
      if (d.timeMs === undefined) continue
      if (d.timeMs > start && d.timeMs <= t + PRE_MS && !spawnedRef.current.has(d.timeMs)) {
        spawnedRef.current.add(d.timeMs)
        fresh.push(d)
      }
    }
    if (fresh.length) {
      log.danmakuEmit({ count: fresh.length, windowMs: t - start })
      pendingRef.current.push(...fresh)
    }
  }, [currentTime])

  // rAF 主循环:同步尺寸/lane → 发射 pending → 推进 active → 绘制。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    let raf = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      // DPR + 尺寸同步。⚠️ 尺寸从父容器(与 video 同源)读取,不是 canvas 自身——
      // canvas `absolute inset-0` 无显式宽高时 clientWidth/Height 可能读到异常值,
      // 位图被撑到巨大(rAF 每帧开销暴增 + 盖住视频)。容器尺寸稳定且与 video 区域一致。
      const host = canvas.parentElement
      const w = Math.max(1, Math.round(host?.clientWidth ?? 0))
      const h = Math.max(1, Math.round(host?.clientHeight ?? 0))
      const dpr = window.devicePixelRatio || 1
      const pw = Math.min(Math.round(w * dpr), 4096)
      const ph = Math.min(Math.round(h * dpr), 4096)
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
      }
      const laneCount = Math.max(1, Math.floor((h * 0.75) / LINE_HEIGHT))
      if (lanesRef.current.length !== laneCount) lanesRef.current = new Array(laneCount).fill(-Infinity)

      // 发射 pending。
      if (pendingRef.current.length) {
        const list = pendingRef.current
        pendingRef.current = []
        for (const item of list) activeRef.current.push(mkActive(item, ctx, w, lanesRef.current, now))
      }

      // 推进 + 移除(点播暂停冻结,直播不停)。
      const frozen = pausedRef.current && !liveRef.current
      const dt = lastNowRef.current ? Math.min((now - lastNowRef.current) / 1000, 0.1) : 0
      lastNowRef.current = now
      const still: Active[] = []
      for (const a of activeRef.current) {
        if (frozen) {
          still.push(a)
        } else if (a.isStatic) {
          if (now - a.born >= STATIC_MS) continue
          still.push(a)
        } else {
          a.x -= a.speed * dt
          if (a.x + a.width < 0) continue
          still.push(a)
        }
      }
      activeRef.current = still

      // 绘制(CSS 像素坐标系,DPR 已 scale)。
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.font = `${FONT_SIZE}px ${FONT}`
      ctx.textBaseline = "middle"
      for (const a of still) {
        ctx.fillStyle = a.item.color ?? "#ffffff"
        const y = (a.lane + 0.5) * LINE_HEIGHT
        if (a.isStatic) ctx.fillText(a.item.text, (w - a.width) / 2, y)
        else ctx.fillText(a.item.text, a.x, y)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      lastNowRef.current = 0
    }
  }, [])

  // ⚠️ canvas 必须与 <video> 同款定位 `absolute inset-0 h-full w-full`——VideoShell 容器
  // 用 paddingTop 撑高(content 高 0),仅 `inset-0` 会按 padding box 拉伸,实测 canvas 尺寸
  // 异常(撑到巨大,盖住视频 + rAF 每帧开销暴增)。h-full w-full 显式对齐 video 区域。
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
}
