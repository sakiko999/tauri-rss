#!/usr/bin/env bun
/**
 * rss — crawler/resolve/core 的正式观测面(docs/cli-plan.md,2026-08-27 定稿)。
 *
 * Bun + cac 零构建,ad-hoc 直跑取代「开 tauri dev + desktop UI 复现」的调试循环:
 *   bun run apps/cli/src/main.ts <command>
 * 根 package.json 有快捷:`bun run rss <command>`。
 *
 * 命令:
 *   channels  渠道注册表快照          fetch  单渠道抓取探针(★)
 *   item      by-url 一站式(★)       play   解析直链 + --open
 *   dm        弹幕探针                align  crawler/rsshub 同构断言
 *   env       appHost 门面自检        refresh core DataLayer 编排冒烟
 *   browser-reset 清掉 Edge CDP 的浏览器 profile(脏了才用)
 */
import { cac } from "cac"
import pc from "picocolors"
import { cookieFieldForPlatform } from "@amoeba/core"
import { setPlatformCookieLookup } from "@amoeba/resolve"
import { closeBrowser, setupHost } from "./host/node-host.ts"
import { loadSettings } from "./info.ts"
import { runChannels } from "./commands/channels.ts"
import { runFetch } from "./commands/fetch.ts"
import { runItem } from "./commands/item.ts"
import { runPlay } from "./commands/play.ts"
import { runDm } from "./commands/dm.ts"
import { runAlign } from "./commands/align.ts"
import { runEnv } from "./commands/env.ts"
import { runRefresh } from "./commands/refresh.ts"
import { runHot } from "./commands/hot.ts"
import { runSug } from "./commands/sug.ts"
import { runDetail } from "./commands/detail.ts"
import { runBrowserReset } from "./commands/browser-reset.ts"
import { runAttach } from "./commands/attach.ts"
import { runLogin } from "./commands/login.ts"

// --service 必须在 setupHost / loadSettings 之前分流：服务不读 CLI settings，
// 也不走命令注册。阶段 1 会把服务入口拆成独立模块，避免连带加载全部命令。
if (process.argv.includes("--service")) {
  const { runServiceFromArgv } = await import("./service/server.ts")
  process.exit(await runServiceFromArgv())
}

// 先注入宿主(file storage / node http+js+ws / log shim)再进命令逻辑。
setupHost()

// CLI 探针不经 DataLayer,credentials provider 在入口注册(与 core DataLayer 同一
// settings 源):渠道/client 未显式传 cookie 时回落本表登录态;`--kv cookie=` 的
// 空串在 client 侧强制匿名,不受 provider 影响。进程短命,快照静态即可。
{
  const settings = await loadSettings()
  setPlatformCookieLookup((platform) => {
    const field = cookieFieldForPlatform(platform)
    const v = field ? settings[field] : undefined
    return typeof v === "string" && v ? v : undefined
  })
}

/** 统一错误出口:消息一行 + 完整堆栈,exit 1。 */
function onError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`${pc.red("✘")} ${message}`)
  // 登录态只存在于数据服务（CLI 的 --browser sidecar profile 只用于抓取探针）。
  if (message.includes("登录") && !process.argv.includes("login")) {
    console.error(
      pc.dim(
        "提示：运行 `rss login <platform>` 扫码登录（登录态由数据服务持有，" +
          "CLI 自己的 sidecar profile 不承载登录态）。",
      ),
    )
  }
  if (err instanceof Error && err.stack) {
    // 只留调用帧：多行 message 时 stack 的第 2 行起是 message 的续行，直接 slice(1)
    // 会把它们当成堆栈再打一遍。
    const frames = err.stack
      .split("\n")
      .slice(1)
      .filter((line) => /^\s+at /.test(line))
    if (frames.length) console.error(pc.dim(frames.join("\n")))
  }
  process.exit(1)
}

/**
 * action 包装:同步/异步错误统一走 onError(cac 不 await 异步 action)。
 * 结束时关浏览器：sidecar 是子进程，不关句柄 Bun 不会退出。
 */
function guard<A extends unknown[]>(fn: (...args: A) => Promise<void> | void): (...args: A) => void {
  return (...args: A) => {
    const finish = () => {
      void closeBrowser()
    }
    try {
      const r = fn(...args)
      if (r instanceof Promise) {
        r.then(
          () => finish(),
          (err) => {
            finish()
            onError(err)
          },
        )
      } else {
        finish()
      }
    } catch (err) {
      finish()
      onError(err)
    }
  }
}

const cli = cac("rss")

// 全局开关：browser 必须显式 opt-in（见 host/node-host.ts 的注释）。
cli.option("--browser", "启用抓取浏览器（spawn amoeba-browser sidecar；需先 cargo build -p amoeba-browser）")
cli.option("--no-browser", "强制关闭抓取浏览器（默认）")
// fetch/item/play/dm 可走数据服务（与订阅抓取同一 cookie/被动/配额路径）。
cli.option("--via-service", "fetch/item/play/dm 改走数据服务 probe.*（需桌面或 AMOEBA_SERVICE_ENDPOINT）")
cli.option("--endpoint <path>", "服务 endpoint.json/目录（默认 desktop 服务）")

cli
  .command("channels", "列出全部 channel(key/kind/name/参数 tpl)")
  .option("--kind <kind>", "按 kind 过滤(article/social/video/audio/live)")
  .option("--json", "JSON 输出")
  .action(guard((opts: { kind?: string; json?: boolean }) => runChannels(opts)))

cli
  .command("fetch <key>", "★ 单渠道抓取探针:耗时 + 条数 + 样本")
  .option("--xml", "原样输出抓到的 XML")
  .option("--json", "JSON 输出(配 jq)")
  .option("-n <n>", "样本/JSON 条数(默认 5)")
  .option("--kv <pair>", "info 覆盖(k=v,可重复;`cookie=` 强制匿名)", { default: [] })
  .action(
    guard(
      (
        key: string,
        opts: {
          xml?: boolean
          json?: boolean
          n?: number
          kv?: string | string[]
          viaService?: boolean
          endpoint?: string
        },
      ) => runFetch(key, opts),
    ),
  )

cli
  .command("item <url>", "★ by-url 一站式:路由 + streams 全档位 + 弹幕元信息")
  .option("--json", "JSON 输出")
  .action(
    guard((url: string, opts: { json?: boolean; viaService?: boolean; endpoint?: string }) =>
      runItem(url, opts),
    ),
  )

cli
  .command("play <url>", "解析直链;--open 丢系统播放器实测直链活性")
  .option("--open", "用系统默认播放器打开首选(非 dash)直链")
  .action(
    guard((url: string, opts: { open?: boolean; viaService?: boolean; endpoint?: string }) =>
      runPlay(url, opts),
    ),
  )

cli
  .command("dm <url>", "弹幕探针:VOD 样本 / 直播窗口统计")
  .option("-n <n>", "样本条数(vod 默认 10 / live 默认 3)")
  .option("-s, --seconds <sec>", "直播采集窗口秒数(默认 5)")
  .option("--json", "JSON 输出")
  .action(
    guard(
      (
        url: string,
        opts: { n?: number; seconds?: number; json?: boolean; viaService?: boolean; endpoint?: string },
      ) => runDm(url, opts),
    ),
  )

cli
  .command("align", "crawler XML 与 rsshub 同构消费断言(收编 verify-alignment)")
  .action(guard(() => runAlign()))

cli
  .command("hot <word>", "★ 热搜词下微博流(weibo:hot resolveHotWord,收编 verify-new-channels)")
  .option("--json", "JSON 输出")
  .option("-n <n>", "样本条数(默认 8)")
  .action(guard((word: string, opts: { json?: boolean; n?: number }) => runHot(word, opts)))

cli
  .command("sug <keyword>", "搜索联想词(抖音匿名,输入补全)")
  .option("--json", "JSON 输出")
  .action(guard((kw: string, opts: { json?: boolean }) => runSug(kw, opts)))

cli
  .command("detail <url>", "xhs 单条详情补全(登录态 noteDetail;URL 需带 xsec_token)")
  .option("--json", "JSON 输出")
  .option("--cookie <ck>", "小红书登录 cookie(缺省回落 CLI settings 的 xhsCookie)")
  .action(guard((url: string, opts: { json?: boolean; cookie?: string }) => runDetail(url, opts)))

cli
  .command("login <platform>", "扫码登录平台账号（经数据服务；bili / weibo / xhs / douyin）")
  .option("--timeout <sec>", "等待扫码的秒数（缺省由平台决定）")
  .option("--json", "JSON 输出")
  .action(
    guard((platform: string, opts: { endpoint?: string; timeout?: string; json?: boolean }) => {
      const timeout = opts.timeout === undefined ? undefined : Number(opts.timeout)
      if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
        throw new Error("--timeout 需要正数秒")
      }
      return runLogin(platform, { endpoint: opts.endpoint, timeout, json: opts.json })
    }),
  )

cli
  .command("attach <action> [arg1] [arg2]", "作为数据服务客户端（status/list/refresh/rpc；默认连桌面）")
  .option("--endpoint <path>", "endpoint.json 或其目录（默认 desktop 服务）")
  .option("--json", "JSON 输出")
  .option("--all", "refresh 全部订阅")
  .option("--no-force", "refresh 走 TTL 缓存")
  .action(
    guard(
      (
        action: string,
        arg1: string | undefined,
        arg2: string | undefined,
        opts: { endpoint?: string; json?: boolean; all?: boolean; force?: boolean },
      ) => runAttach(action, [arg1, arg2].filter((v): v is string => !!v), opts),
    ),
  )

cli
  .command("browser-reset", "清掉抓取浏览器 profile(默认 CLI sidecar;--target desktop|all)")
  .option("--target <target>", "cli|desktop|all(默认 cli)")
  .action(
    guard((opts: { target?: "cli" | "desktop" | "all" }) => runBrowserReset(opts)),
  )

cli
  .command("env", "appHost 门面自检(http/js/storage/ws 注入状态)")
  .option("--probe", "实测各门面(轻请求 / JS 求值 / KV roundtrip)")
  .action(guard((opts: { probe?: boolean }) => runEnv(opts)))

cli
  .command("refresh [keys...]", "core DataLayer 编排冒烟(add/refresh/store,SQLite 持久化)")
  .option("--kv <pair>", "info 覆盖(k=v,可重复)")
  .option("--json", "JSON 输出")
  .option("--no-force", "走 TTL 缓存(默认强制抓取;验证缓存命中)")
  .action(
    guard((keys: string[], opts: { kv?: string | string[]; json?: boolean; force?: boolean }) =>
      runRefresh(keys, { kv: opts.kv, json: opts.json, force: opts.force }),
    ),
  )

cli.help()
cli.version("0.1.0")
cli.parse()
