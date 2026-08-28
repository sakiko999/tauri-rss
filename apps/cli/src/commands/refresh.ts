/**
 * refresh — core DataLayer 编排冒烟:add/update 订阅 → refresh → store 查询。
 * 走 file-JSON 持久化(订阅幂等:同 channelKey 复用已有订阅,只更新 info)。
 * info 不注入 cookie——DataLayer.sourceInfoFor 按 settings 自动注入(订阅跟随
 * settings 更新,不固化),这是与 fetch/item 探针直连 source 的关键差异。
 */
import pc from "picocolors"
import { createDataLayer } from "@tauri-playground/core"
import { getChannel } from "@tauri-playground/crawler"
import { exampleInfo, parseKvPairs } from "../info.ts"
import { fail, fmtMs, ok, printJson, startTimer, trunc } from "../ui/render.ts"

export interface RefreshOptions {
  json?: boolean
  kv?: string | string[]
  /** cac 把 `--no-force` 解析成 `force:false`(键是 force 不是 noForce);默认 = 强制(调试拿最新)。 */
  force?: boolean
}

export async function runRefresh(keysInput: string[] | string, opts: RefreshOptions): Promise<void> {
  // cac variadic 偶发降级成单 string(参数被逐字符迭代过一次)——入口归一。
  const keys = Array.isArray(keysInput) ? keysInput : [keysInput]
  const dl = createDataLayer()
  const overrides = parseKvPairs(opts.kv)
  // 默认 force(true);--no-force → cac 产出 force:false → 走 TTL 缓存(验证命中)。
  const force = opts.force !== false

  const results: Array<{
    key: string
    id?: string
    itemCount?: number
    tookMs?: number
    error?: string
    sample?: string[]
  }> = []

  for (const key of keys) {
    const ch = getChannel(key)
    if (!ch) {
      results.push({ key, error: `unknown channel: ${key}` })
      continue
    }
    const info = { ...(ch.defaultInfo ?? {}), ...exampleInfo(key), ...overrides }
    const existing = (await dl.subscriptions.list()).find((s) => s.channelKey === key)

    const elapsed = startTimer()
    let id: string
    if (existing) {
      await dl.subscriptions.update(existing.id, { info })
      id = existing.id
    } else {
      id = await dl.addSubscription(key, ch.name, info) // 内部已 refresh
    }
    const result = existing ? await dl.refresh(id, { force }) : null
    const ms = elapsed()

    const items = dl.store.all().filter((it) => it.subscriptionId === id)
    const error = result?.error
    results.push({
      key,
      id,
      itemCount: error ? 0 : items.length,
      tookMs: Math.round(ms),
      error,
      sample: items.slice(0, 3).map((it) => trunc(it.title, 48)),
    })
  }

  if (opts.json) {
    printJson(results)
    return
  }
  for (const r of results) {
    if (r.error) {
      console.log(`${r.key} — ${fail(r.error)}`)
      continue
    }
    console.log(`${r.key} — ${ok(`${r.itemCount} 条`)} ${fmtMs(r.tookMs ?? 0)}${pc.dim(`  (${r.id})`)}`)
    if (r.sample?.length) console.log(pc.dim(`  样本: ${r.sample.join(" / ")}`))
  }
}
