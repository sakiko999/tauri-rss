/**
 * Source registry — the plugin seam for producer.
 *
 * A new platform plugs in with one line: `registerSource(new XxxSource())`.
 * Built-in adapters are registered via `registerAllSources()` (see
 * `register-all.ts`); plugins register their own in app startup. Modeled on the
 * live platform registry (`live/index.ts`), but source adapters need no host.
 *
 * The registry is a module-level singleton shared across `createDataLayer`
 * calls. `createDataLayer` snapshots the current contents into its adapter map,
 * so a plugin registered once at startup is available to every data layer.
 */
import type { SourceAdapter } from "./source-adapter.ts"
import type { SubscriptionKind } from "../types/subscription.ts"

const adapters = new Map<SubscriptionKind, SourceAdapter>()

export function registerSource(adapter: SourceAdapter): void {
  adapters.set(adapter.kind, adapter)
}

export function getSource(kind: SubscriptionKind): SourceAdapter | undefined {
  return adapters.get(kind)
}

export function listSources(): SourceAdapter[] {
  return [...adapters.values()]
}

/** Override an existing kind (a plugin replacing built-in behavior). */
export function overrideSource(adapter: SourceAdapter): void {
  adapters.set(adapter.kind, adapter)
}

/**
 * Test-only: clear the registry so tests start from a known state.
 * Not part of the public plugin API.
 */
export function __resetSources(): void {
  adapters.clear()
}
