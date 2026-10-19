/**
 * lx-visibility-probe —— 实测「窗口可见性」对页面行为的影响（风控文档 §4.1）。
 *
 * 背景：LX 被动采集要靠浏览器窗口。生产 release 的 Edge 是 SW_HIDE 的，
 * 但“藏起来之后页面还剩多少行为”一直没实测。本脚本起一个独立 Edge（临时
 * profile）+ 本地测试页，在五种窗口状态下量页面自己能看到/能做到什么：
 *
 *   visible              正常可见
 *   offscreen            --window-position=-32000,-32000（IsWindowVisible 仍为真）
 *   offscreen+节流关闭    同 offscreen，加生产 hide 分支的四个 --disable-* 参数
 *   hidden               启动后 ShowWindow(SW_HIDE)（= 生产 release 的行为）
 *   hidden+生产参数       再加 --blink-settings=imagesEnabled=false
 *
 * 每轮测：document.visibilityState、rAF 帧数、100ms 定时器实际触发数、
 * IntersectionObserver（首屏 + 滚动后）、loading=lazy 图片是否真的发请求、
 * 页面内 fetch 是否照常发出。
 *
 * 用法：
 *   bun scripts/lx-visibility-probe.ts              # 跑全部 5 组
 *   bun scripts/lx-visibility-probe.ts hidden       # 只跑匹配的一组
 */

import { rm } from "node:fs/promises"

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
const PORT = Number(process.env.CDP_PORT ?? 9333)
const PAGE_URL_PATH = "/page"

interface Run {
  name: string
  offscreen?: boolean
  hide?: boolean
  /** 置顶，避免被终端遮挡（可见组专用）。 */
  topmost?: boolean
  /** 去掉任务栏按钮（WS_EX_TOOLWINDOW），窗口本身仍 shown。 */
  toolwindow?: boolean
  /** 先 SW_HIDE，再用 SW_SHOWNA（不激活）重新显示。 */
  reshow?: boolean
  extra?: string[]
}

const RUNS: Run[] = [
  { name: "visible", topmost: true },
  { name: "offscreen", offscreen: true },
  {
    name: "offscreen+occlusion-off",
    offscreen: true,
    extra: ["--disable-features=CalculateNativeWinOcclusion"],
  },
  {
    name: "offscreen+backgrounding-off",
    offscreen: true,
    extra: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
  },
  {
    name: "offscreen+all-flags",
    offscreen: true,
    extra: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-features=CalculateNativeWinOcclusion",
    ],
  },
  {
    name: "offscreen+flags+no-images",
    offscreen: true,
    extra: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-features=CalculateNativeWinOcclusion",
      "--blink-settings=imagesEnabled=false",
    ],
  },
  {
    name: "offscreen+flags+toolwindow",
    offscreen: true,
    toolwindow: true,
    extra: [
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-features=CalculateNativeWinOcclusion",
    ],
  },
  { name: "hidden", hide: true },
  {
    name: "hidden+reshow-na",
    hide: true,
    reshow: true,
    offscreen: true,
    extra: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-features=CalculateNativeWinOcclusion",
    ],
  },
  {
    name: "hidden+occlusion-off",
    hide: true,
    extra: ["--disable-features=CalculateNativeWinOcclusion"],
  },
  {
    name: "hidden+backgrounding-off",
    hide: true,
    extra: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
  },
  { name: "hidden+timer-off", hide: true, extra: ["--disable-background-timer-throttling"] },
  {
    name: "hidden+all-flags",
    hide: true,
    extra: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-features=CalculateNativeWinOcclusion",
    ],
  },
  {
    name: "hidden+prod-flags",
    hide: true,
    extra: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-features=CalculateNativeWinOcclusion",
      "--blink-settings=imagesEnabled=false",
    ],
  },
]

// ── 测试页 ────────────────────────────────────────────────────────────────────
/** 请求计数：img = lazy 图被真正请求的次数；ping = 页面内 fetch 的次数。 */
const hits = { img: 0, ping: 0 }

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>lx-probe</title>
<style>body{margin:0}.spacer{background:linear-gradient(#ddd,#444);height:1800px}.marker{height:40px;background:#0a0}</style>
</head><body>
<div id="io-initial" class="marker">io-initial</div>
<div class="spacer">top</div>
<img id="lazy" loading="lazy" src="/img" width="240" height="160">
<div class="spacer">mid</div>
<div id="io-scrolled" class="marker">io-scrolled</div>
<div class="spacer">bottom</div>
<script>
(() => {
  const P = window.__probe = {
    t0: performance.now(), raf: 0, ticks: 0, vs: [document.visibilityState],
    ioInitial: null, ioScrolled: null, lazy: null, ping: null, scrolledAt: null, done: false,
  };
  addEventListener('visibilitychange', () => P.vs.push(document.visibilityState));
  // scroll 事件是否在隐藏窗口下照常触发（站点常用的「滚动加载」入口）
  addEventListener('scroll', () => { P.scrolls = (P.scrolls || 0) + 1; P.lastScrollTop = Math.round(scrollY) }, { passive: true });
  const rafLoop = () => { P.raf++; requestAnimationFrame(rafLoop) };
  requestAnimationFrame(rafLoop);
  setInterval(() => { P.ticks++ }, 100);

  const img = document.getElementById('lazy');
  img.addEventListener('load', () => { P.lazy = Math.round(performance.now() - P.t0) });
  img.addEventListener('error', () => { P.lazy = -1 });

  // 首屏内元素的 IO：不需要滚动就该触发一次（隐藏窗口下是否还有渲染帧？）
  new IntersectionObserver((es) => {
    if (!P.ioInitial) P.ioInitial = { at: Math.round(performance.now() - P.t0), hit: es.some(e => e.isIntersecting) };
  }).observe(document.getElementById('io-initial'));

  // 滚动到 lazy 图附近，测「滚动驱动的懒加载」在隐藏窗口下是否还工作。
  setTimeout(() => {
    window.scrollTo(0, 1800);
    P.scrolledAt = Math.round(performance.now() - P.t0);
    new IntersectionObserver((es) => {
      if (!P.ioScrolled) P.ioScrolled = { at: Math.round(performance.now() - P.t0), hit: es.some(e => e.isIntersecting) };
    }).observe(document.getElementById('io-scrolled'));
  }, 1500);

  // 页面自己发请求（站点原生 XHR/fetch）：隐藏窗口下是否还被正常发出。
  setTimeout(() => {
    fetch('/ping?t=' + Math.round(performance.now())).then(() => {
      P.ping = Math.round(performance.now() - P.t0);
    }).catch(() => { P.ping = -1 });
  }, 2500);

  setTimeout(() => {
    P.done = true; P.elapsed = Math.round(performance.now() - P.t0); P.scrollTop = Math.round(scrollY);
  }, 6000);
})();
</script>
</body></html>`

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === "/img") {
      hits.img++
      // 1x1 透明 GIF，保证 load 事件可达。
      const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
      return new Response(gif, { headers: { "content-type": "image/gif", "cache-control": "no-store" } })
    }
    if (u.pathname === "/ping") {
      hits.ping++
      return new Response("pong")
    }
    if (u.pathname === "/hits") return Response.json(hits)
    return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
  },
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── 进程 / 窗口 ───────────────────────────────────────────────────────────────
/** 端口上 LISTENING 的 PID（Edge 的浏览器主进程，持窗的那个）。 */
async function portOwner(port: number): Promise<number | null> {
  const p = Bun.spawn(["netstat", "-ano"], { stdout: "pipe", stderr: "ignore" })
  const text = await new Response(p.stdout).text()
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(`:${port} `) || !line.includes("LISTENING")) continue
    const pid = Number(line.trim().split(/\s+/).pop())
    if (pid) return pid
  }
  return null
}

type WinMode = "hide" | "show" | "showna" | "topmost" | "toolwindow" | "noactivate" | "count"

/** 对端口属主进程的可见顶层窗口执行 ShowWindow / SetWindowPos，返回 `mode:acted,visible:N`。 */
const psWindow = (pid: number, mode: WinMode) => `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class LxWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int idx, IntPtr val);
  static int Count(uint[] pids) {
    int vis = 0;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (Array.IndexOf(pids, p) >= 0 && IsWindowVisible(h)) vis++;
      return true;
    }, IntPtr.Zero);
    return vis;
  }
  public static string Run(uint[] pids, string mode) {
    int acted = 0;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (Array.IndexOf(pids, p) < 0) return true;
      if (mode == "hide") { if (IsWindowVisible(h)) { ShowWindow(h, 0); acted++; } }
      else if (mode == "show") { if (!IsWindowVisible(h)) { ShowWindow(h, 5); acted++; } }
      else if (mode == "showna") { if (!IsWindowVisible(h)) { ShowWindow(h, 8); acted++; } }
      else if (mode == "topmost") { ShowWindow(h, 5); SetWindowPos(h, (IntPtr)(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040); acted++; }
      else if (mode == "toolwindow") {
        long ex = GetWindowLongPtr(h, -20).ToInt64();
        ex = (ex & ~0x00040000L) | 0x00000080L; // 去 WS_EX_APPWINDOW，加 WS_EX_TOOLWINDOW
        SetWindowLongPtr(h, -20, (IntPtr)ex);
        acted++;
      }
      else if (mode == "noactivate") {
        long ex = GetWindowLongPtr(h, -20).ToInt64();
        ex = ex | 0x08000000L; // + WS_EX_NOACTIVATE
        SetWindowLongPtr(h, -20, (IntPtr)ex);
        acted++;
      }
      return true;
    }, IntPtr.Zero);
    return mode + ":" + acted + ",visible:" + Count(pids);
  }
}
"@
[LxWin]::Run(@(${pid}), "${mode}")
`

async function windowOp(pid: number, mode: WinMode): Promise<{ acted: number; visible: number }> {
  const p = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", psWindow(pid, mode)], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const text = (await new Response(p.stdout).text()).trim()
  await p.exited
  const m = /:(\d+),visible:(\d+)/.exec(text)
  return { acted: Number(m?.[1] ?? 0), visible: Number(m?.[2] ?? -1) }
}

/** 当前前台窗口所属 PID（判断启动/运行期间是否抢焦点）。 */
async function foregroundPid(): Promise<number> {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class LxFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static int Pid() { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return (int)p; }
}
"@
[LxFg]::Pid()
`
  const p = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = (await new Response(p.stdout).text()).trim()
  await p.exited
  return Number(text) || 0
}

/** 该 profile 下整棵 Edge 进程树累计的 CPU 秒数（Get-Process.CPU）。 */
async function edgeCpuSeconds(profileTag: string): Promise<number> {
  const script = `
$procs = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profileTag}*' }
$sum = 0.0
foreach ($p in $procs) {
  $g = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
  if ($g) { $sum += $g.CPU }
}
$sum
`
  const p = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = (await new Response(p.stdout).text()).trim().replace(",", ".")
  await p.exited
  return Number(text) || 0
}

async function killPort(port: number): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const pid = await portOwner(port)
    if (pid === null) return
    const p = Bun.spawn(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" })
    await p.exited
    await sleep(200)
  }
}

interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<any>
  evaluate(expression: string): Promise<any>
  close(): void
}

async function waitForCdp(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (r.ok) return
    } catch {
      // 未就绪
    }
    if (Date.now() > deadline) throw new Error(`CDP ${port} 未就绪`)
    await sleep(200)
  }
}

async function connect(port: number): Promise<Cdp> {
  const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
    type: string
    webSocketDebuggerUrl?: string
  }>
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
  if (!page?.webSocketDebuggerUrl) throw new Error("没有 page target")
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map<number, (v: any) => void>()
  await new Promise<void>((res, rej) => {
    ws.addEventListener("open", () => res(), { once: true })
    ws.addEventListener("error", () => rej(new Error("CDP ws 连接失败")), { once: true })
  })
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data)) as { id?: number; result?: any }
    if (m.id === undefined) return
    const p = pending.get(m.id)
    if (p) {
      pending.delete(m.id)
      p(m.result)
    }
  })
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((res) => {
      const myId = ++id
      pending.set(myId, res)
      ws.send(JSON.stringify({ id: myId, method, params }))
    })
  const evaluate = async (expression: string) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (r?.exceptionDetails) throw new Error(String(r.exceptionDetails.text ?? "evaluate 失败"))
    return r?.result?.value
  }
  return { send, evaluate, close: () => ws.close() }
}

// ── 单轮 ──────────────────────────────────────────────────────────────────────
async function runOne(run: Run): Promise<void> {
  await killPort(PORT)
  hits.img = hits.ping = 0

  const profileTag = `lx-probe-profile-${process.pid}-${run.name.replace(/\W+/g, "_")}`
  const profile = `${process.env.TEMP ?? "."}\\${profileTag}`
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-extensions",
    "--disable-default-apps",
    "--window-size=1200,800",
  ]
  if (run.offscreen) args.push("--window-position=-32000,-32000")
  args.push(...(run.extra ?? []))
  args.push("about:blank")

  const fgBefore = await foregroundPid()
  Bun.spawn([EDGE, ...args], { stdout: "ignore", stderr: "ignore" })
  await waitForCdp(PORT)

  // 窗口操作结果（验证 SW_HIDE 是否真的生效；对齐 browser.rs 的「曾见可见窗口」判据）。
  let win = { acted: 0, visible: -1 }
  const pid = await portOwner(PORT)
  if (pid !== null && run.hide) {
    let seen = 0
    let quiet = 0
    for (let i = 0; i < 20 && quiet < 2; i++) {
      win = await windowOp(pid, "hide")
      if (win.acted > 0) {
        seen += win.acted
        quiet = 0
      } else if (seen > 0) {
        quiet++
      } else if (i >= 8) {
        break // 一直没见到可见窗口：窗口可能尚未创建，交给后面的 count 报告
      }
      await sleep(150)
    }
    win = await windowOp(pid, "count")
    win.acted = seen
  } else if (pid !== null && run.topmost) {
    win = await windowOp(pid, "topmost")
  } else if (pid !== null && run.toolwindow) {
    await sleep(600) // 等主框架窗口创建
    const tw = await windowOp(pid, "toolwindow")
    const cnt = await windowOp(pid, "count")
    win = { acted: tw.acted, visible: cnt.visible }
  }

  if (pid !== null && run.reshow) {
    await sleep(400)
    await windowOp(pid, "toolwindow") // 重新显示前先去任务栏
    await windowOp(pid, "noactivate") // 且禁止激活
    const sh = await windowOp(pid, "showna")
    const cnt = await windowOp(pid, "count")
    win = { acted: sh.acted, visible: cnt.visible }
  }

  const fgAfterWindow = await foregroundPid()

  const cdp = await connect(PORT)
  const cpu0 = await edgeCpuSeconds(profileTag)
  const cpuT0 = performance.now()
  try {
    await cdp.evaluate(`location.href = ${JSON.stringify(`http://127.0.0.1:${server.port}${PAGE_URL_PATH}`)}`)
    await sleep(7500)
    const cpu1 = await edgeCpuSeconds(profileTag)
    const fgEnd = await foregroundPid()
    const probe = await cdp.evaluate("JSON.stringify(window.__probe)")
    const view = await cdp.evaluate(
      "JSON.stringify({ w: innerWidth, h: innerHeight, screenX, screenY, hidden: document.hidden, vis: document.visibilityState, focus: document.hasFocus() })",
    )
    const out = {
      run: run.name,
      windows: win,
      // 无感知判据：窗口是否把前台从用户手里抢走（edgePid = CDP 端口属主）
      focus: { before: fgBefore, afterWindow: fgAfterWindow, end: fgEnd, edgePid: pid },
      // 渲染开销：整棵 Edge 进程树在观察窗口内的平均 CPU 占用（单核百分比）
      cpu: {
        seconds: Math.round((cpu1 - cpu0) * 100) / 100,
        pctOneCore: Math.round(((cpu1 - cpu0) / ((performance.now() - cpuT0) / 1000)) * 1000) / 10,
      },
      page: JSON.parse(probe),
      view: JSON.parse(view),
      hits: { ...hits },
    }
    console.log(JSON.stringify(out))
  } finally {
    cdp.close()
    await killPort(PORT)
    // 临时 profile 会累积到 GB 级，跑完必须删（Edge 释放文件句柄有延迟，带重试）。
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}

async function main() {
  const filter = process.argv[2]
  const runs = filter ? RUNS.filter((r) => r.name.includes(filter)) : RUNS
  if (!runs.length) throw new Error(`没有匹配的运行组: ${filter}`)
  console.error(`[lx-probe] 测试页 http://127.0.0.1:${server.port}${PAGE_URL_PATH}，共 ${runs.length} 组`)
  for (const run of runs) {
    console.error(`[lx-probe] → ${run.name}`)
    await runOne(run)
  }
}

main()
  .catch((e) => {
    console.error(String((e as Error)?.message ?? e))
    process.exitCode = 1
  })
  .finally(() => server.stop(true))
