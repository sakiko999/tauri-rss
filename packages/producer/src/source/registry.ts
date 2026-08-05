/**
 * Source registry — the plugin seam for producer.
 *
 * A new platform plugs in with one line: `registerSource(new XxxSource())`.
 * Built-in adapters are registered via `registerAllSources(host)` (see
 * `register-all.ts`); plugins register their own in app startup.
 *
 * The registry is a module-level singleton shared across `createDataLayer`
 * calls. `createDataLayer` snapshots the current contents into its adapter map,
 * so a plugin registered once at startup is available to every data layer.
 */
import type { BuiltinSubscription, SourceAdapter } from "./source-adapter.ts"

const adapters = new Map<string, SourceAdapter>()

export function registerSource(adapter: SourceAdapter): void {
  adapters.set(adapter.sourceId, adapter)
}

export function getSource(sourceId: string): SourceAdapter | undefined {
  return adapters.get(sourceId)
}

export function listSources(): SourceAdapter[] {
  return [...adapters.values()]
}

/** Override an existing source (a plugin replacing built-in behavior). */
export function overrideSource(adapter: SourceAdapter): void {
  adapters.set(adapter.sourceId, adapter)
}

/**
 * Test-only: clear the registry so tests start from a known state.
 * Not part of the public plugin API.
 */
export function __resetSources(): void {
  adapters.clear()
}

/** A built-in subscription paired with the source that owns it. */
export interface BuiltinEntry {
  sourceId: string
  sub: BuiltinSubscription
}

/** Aggregate all built-in subscriptions across every registered source. */
export function listBuiltinSubscriptions(): BuiltinEntry[] {
  const out: BuiltinEntry[] = []
  for (const a of listSources()) {
    for (const b of a.builtinSubscriptions ?? []) out.push({ sourceId: a.sourceId, sub: b })
  }
  return out
}
