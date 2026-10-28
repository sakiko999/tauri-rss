/**
 * channels — 渠道注册表快照(不 fetch)。
 * key / kind / name / 参数 tpl(* = required)/ defaultInfo。
 */

import { listChannels } from "@amoeba/crawler"
import pc from "picocolors"

import { printJson } from "../ui/render.ts"

export interface ChannelsOptions {
  kind?: string
  json?: boolean
}

export function runChannels(opts: ChannelsOptions): void {
  const all = listChannels()
  const list = opts.kind ? all.filter((c) => c.kind === opts.kind) : all
  if (opts.json) {
    printJson(
      list.map((c) => ({
        key: c.key,
        name: c.name,
        kind: c.kind,
        infoTpl: c.sourceInfoTpl,
        defaultInfo: c.defaultInfo,
        passive: c.passive === true,
      })),
    )
    return
  }
  console.log(`共 ${list.length}/${all.length} 个 channel${opts.kind ? ` (kind=${opts.kind})` : ""}`)
  for (const ch of list) {
    const tpl = (ch.sourceInfoTpl ?? []).map((f) => `${f.key}${f.required ? "*" : ""}`).join(", ")
    const passive = ch.passive ? pc.cyan("  被动") : ""
    console.log(`  ${ch.key.padEnd(24)} ${ch.kind.padEnd(7)} ${ch.name}${passive}${tpl ? pc.dim(`  [${tpl}]`) : ""}`)
  }
}
