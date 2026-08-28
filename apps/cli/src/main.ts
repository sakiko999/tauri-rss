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
 */
import { cac } from "cac"
import pc from "picocolors"
import { setupHost } from "./host/node-host.ts"
import { runChannels } from "./commands/channels.ts"
import { runFetch } from "./commands/fetch.ts"
import { runItem } from "./commands/item.ts"
import { runPlay } from "./commands/play.ts"
import { runDm } from "./commands/dm.ts"
import { runAlign } from "./commands/align.ts"
import { runEnv } from "./commands/env.ts"
import { runRefresh } from "./commands/refresh.ts"

// 先注入宿主(file storage / node http+js+ws / log shim)再进命令逻辑。
setupHost()

/** 统一错误出口:消息一行 + 完整堆栈,exit 1。 */
function onError(err: unknown): void {
  console.error(`${pc.red("✘")} ${err instanceof Error ? err.message : String(err)}`)
  if (err instanceof Error && err.stack) {
    console.error(pc.dim(err.stack.split("\n").slice(1).join("\n")))
  }
  process.exit(1)
}

/** action 包装:同步/异步错误统一走 onError(cac 不 await 异步 action)。 */
function guard<A extends unknown[]>(fn: (...args: A) => Promise<void> | void): (...args: A) => void {
  return (...args: A) => {
    try {
      const r = fn(...args)
      if (r instanceof Promise) r.catch(onError)
    } catch (err) {
      onError(err)
    }
  }
}

const cli = cac("rss")

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
    guard((key: string, opts: { xml?: boolean; json?: boolean; n?: number; kv?: string | string[] }) =>
      runFetch(key, opts),
    ),
  )

cli
  .command("item <url>", "★ by-url 一站式:路由 + streams 全档位 + 弹幕元信息")
  .option("--json", "JSON 输出")
  .action(guard((url: string, opts: { json?: boolean }) => runItem(url, opts)))

cli
  .command("play <url>", "解析直链;--open 丢系统播放器实测直链活性")
  .option("--open", "用系统默认播放器打开首选(非 dash)直链")
  .action(guard((url: string, opts: { open?: boolean }) => runPlay(url, opts)))

cli
  .command("dm <url>", "弹幕探针:VOD 样本 / 直播窗口统计")
  .option("-n <n>", "样本条数(vod 默认 10 / live 默认 3)")
  .option("-s, --seconds <sec>", "直播采集窗口秒数(默认 5)")
  .option("--json", "JSON 输出")
  .action(
    guard((url: string, opts: { n?: number; seconds?: number; json?: boolean }) => runDm(url, opts)),
  )

cli
  .command("align", "crawler XML 与 rsshub 同构消费断言(收编 verify-alignment)")
  .action(guard(() => runAlign()))

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
