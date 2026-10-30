/**
 * attach — CLI 作为数据服务的客户端。
 *
 * 服务与桌面同生命周期：默认读 **dev 实例**（app.amoeba.dev）的 endpoint.json，使用
 * **client token**（只能命令，不能 shutdown）。要连安装版用 `--profile desktop`。
 * 改数据/刷新会立刻通过 WS 事件反映到对应实例。
 *
 *   rss attach status [--json]
 *   rss attach list [--json]
 *   rss attach refresh <id...> | --all [--no-force]
 *   rss attach rpc <method> [json] [--json]
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { createRemoteDataLayer, ServiceClient } from "@amoeba/service-client"
import type { EndpointInfo, RpcMethod, RpcParams } from "@amoeba/service-protocol"
import pc from "picocolors"

import { fail, fmtMs, ok, printJson, startTimer } from "../ui/render.ts"

export interface AttachOptions {
  endpoint?: string
  /** 选哪个实例身份的服务目录（dev = app.amoeba.dev / desktop = 安装版）。 */
  profile?: string
  json?: boolean
  all?: boolean
  force?: boolean
}

/** 实例身份 → 服务目录。与 tauri.conf.dev.json / tauri.conf.json 的 identifier 对齐。 */
export type ServiceProfile = "dev" | "desktop"
const PROFILE_DIR: Record<ServiceProfile, string> = {
  dev: "app.amoeba.dev",
  desktop: "app.amoeba.desktop",
}

function resolveProfile(explicit?: string): ServiceProfile {
  if (explicit === "desktop" || explicit === "dev") return explicit
  const fromEnv = process.env.AMOEBA_SERVICE_PROFILE
  if (fromEnv === "desktop" || fromEnv === "dev") return fromEnv
  // 默认 dev：CLI 是仓库调试工具，attach/login 面向的「桌面服务」就是 dev 实例。
  return "dev"
}

function endpointFile(explicit?: string, profile?: string): string {
  if (explicit && existsSync(explicit)) {
    return statSync(explicit).isDirectory() ? join(explicit, "endpoint.json") : explicit
  }
  if (explicit) return explicit
  if (process.env.AMOEBA_SERVICE_ENDPOINT) return process.env.AMOEBA_SERVICE_ENDPOINT
  // fail-closed：只认选定身份的目录，不回退另一个身份 —— attach/login 是写操作，
  // 静默连错（尤其连到安装版的真实库）比报错危险得多。
  return join(
    process.env.LOCALAPPDATA ?? process.env.HOME ?? process.cwd(),
    PROFILE_DIR[resolveProfile(profile)],
    "service",
    "endpoint.json",
  )
}

export function resolveEndpoint(explicit?: string, profile?: string): EndpointInfo {
  const file = endpointFile(explicit, profile)
  if (!existsSync(file)) {
    const current = resolveProfile(profile)
    const other = current === "dev" ? "desktop" : "dev"
    throw new Error(
      `找不到服务 endpoint：${file}\n` +
        `当前实例身份是 ${current}（dev = bun run tauri 调试实例，desktop = 安装版）。\n` +
        `换身份用 --profile ${other} 或 AMOEBA_SERVICE_PROFILE=${other}；先启动对应实例，` +
        `或用 --endpoint 指定 endpoint.json/目录。`,
    )
  }
  const info = JSON.parse(readFileSync(file, "utf8")) as EndpointInfo
  if (info.schema !== "amoeba-service/1") throw new Error(`endpoint schema 不支持：${info.schema}`)
  if (!info.clientToken) throw new Error("endpoint 缺少 clientToken（服务版本过旧？）")
  return info
}

function printResult(value: unknown, asJson?: boolean): void {
  if (asJson) {
    printJson(value)
    return
  }
  console.log(JSON.stringify(value, null, 2))
}

export async function runAttach(action: string, args: string[], opts: AttachOptions): Promise<void> {
  switch (action) {
    case "status":
      return status(opts)
    case "list":
      return list(opts)
    case "refresh":
      return refresh(args, opts)
    case "rpc":
      return rpc(args, opts)
    default:
      throw new Error(`未知 attach 动作：${action}（status | list | refresh | rpc）`)
  }
}

async function status(opts: AttachOptions): Promise<void> {
  const endpoint = resolveEndpoint(opts.endpoint, opts.profile)
  const client = new ServiceClient(endpoint)
  await client.hello()
  const [health, snap] = await Promise.all([client.health(), client.snapshot()])
  const out = {
    endpoint: {
      port: endpoint.port,
      pid: endpoint.pid,
      dbFile: endpoint.dbFile,
      profileDir: endpoint.profileDir,
    },
    health,
    state: {
      rev: snap.lastRev,
      subscriptions: snap.subscriptions.length,
      groups: snap.groups.length,
      items: snap.items.length,
      settings: {
        refreshIntervalMin: snap.settings.refreshIntervalMin,
        autoRefresh: snap.settings.autoRefresh,
        netLevel: snap.settings.netLevel,
      },
    },
  }
  if (opts.json) {
    printJson(out)
    return
  }
  console.log(`服务  ${ok("在线")}  ${pc.dim(`127.0.0.1:${endpoint.port} pid=${endpoint.pid}`)}`)
  console.log(pc.dim(`DB    ${endpoint.dbFile}`))
  console.log(pc.dim(`Profile ${endpoint.profileDir}`))
  console.log(
    `状态  rev=${health.rev}  订阅=${out.state.subscriptions}  分组=${out.state.groups}  条目=${out.state.items}  jobs=${health.jobs}`,
  )
}

async function list(opts: AttachOptions): Promise<void> {
  const endpoint = resolveEndpoint(opts.endpoint, opts.profile)
  const dl = await createRemoteDataLayer(endpoint)
  try {
    const [subs, groups] = await Promise.all([dl.subscriptions.list(), dl.subscriptions.listGroups()])
    const rows = subs.map((sub) => ({
      id: sub.id,
      channelKey: sub.channelKey,
      title: sub.title,
      enabled: sub.enabled,
      group: groups.find((g) => g.id === sub.groupId)?.title ?? null,
      items: dl.store.query({ subscriptionId: sub.id }).length,
      total: dl.totalOf(sub.id) ?? null,
    }))
    if (opts.json) {
      printJson(rows)
      return
    }
    for (const row of rows) {
      console.log(
        `${row.enabled ? ok("●") : pc.dim("○")} ${row.title} ${pc.dim(`(${row.channelKey})`)}  ${row.items} 条${row.total !== null ? ` / 总 ${row.total}` : ""}  ${pc.dim(row.id)}`,
      )
    }
    console.log(pc.dim(`共 ${rows.length} 个订阅 · ${groups.length} 个分组`))
  } finally {
    dl.close()
  }
}

async function refresh(idsInput: string[], opts: AttachOptions): Promise<void> {
  const endpoint = resolveEndpoint(opts.endpoint, opts.profile)
  const dl = await createRemoteDataLayer(endpoint)
  const force = opts.force !== false
  const ids = idsInput.flatMap((v) => v.split(",")).filter(Boolean)
  try {
    const subs = await dl.subscriptions.list()
    const targets = opts.all ? subs : subs.filter((sub) => ids.includes(sub.id) || ids.includes(sub.channelKey))
    if (!targets.length) {
      throw new Error("没有匹配的订阅；用 `rss attach list` 查 id/channelKey，或加 --all")
    }
    for (const sub of targets) {
      const elapsed = startTimer()
      const result = await dl.refresh(sub.id, { force })
      const ms = elapsed()
      if (result.error) {
        console.log(`${sub.title} — ${fail(result.error)}`)
      } else {
        console.log(`${sub.title} — ${ok(`${result.itemCount} 条`)} ${fmtMs(ms)}`)
      }
    }
  } finally {
    dl.close()
  }
}

async function rpc(args: string[], opts: AttachOptions): Promise<void> {
  const method = args[0]
  if (!method) throw new Error("用法：rss attach rpc <method> [json]")
  let params: unknown = {}
  if (args[1]) {
    try {
      // Windows 下 PowerShell 会把内联 JSON 的引号转义坏；`@file` 是可靠入口。
      const text = args[1].startsWith("@") ? readFileSync(args[1].slice(1), "utf8") : args[1]
      // PowerShell 的 `-Encoding utf8` 可能带 BOM。
      params = JSON.parse(text.replace(/^﻿/, ""))
    } catch (e) {
      throw new Error(
        `params 不是合法 JSON（可写 \`@path/to/params.json\`）：${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  const endpoint = resolveEndpoint(opts.endpoint, opts.profile)
  const client = new ServiceClient(endpoint)
  const result = await client.rpc(method as RpcMethod, params as RpcParams<RpcMethod>)
  printResult(result, opts.json)
}
