/**
 * Bilibili wbi request signing — legacy entry point, kept for backward
 * compatibility. The real implementation lives in `BilibiliClient`
 * (`createBilibiliClient().signWeb`), which all bilibili consumers share.
 *
 * Key insight (verified live, 2026-08): `GET /x/web-interface/nav` returns the
 * `data.wbi_img` signing keys even when NOT logged in (`code:-101`). So no
 * cookie / puppeteer is needed — plain
 * `MD5( sortedParams & wts & mixinKey )` suffices. The mixin key is derived by
 * permuting `imgKey + subKey` through the 64-entry `MIXIN_KEY_ENC_TAB` and
 * truncating to 32 chars.
 */
import type { ProducerHost } from "../../types/producer-host.ts"
import { createBilibiliClient } from "./client.ts"

export { MIXIN_KEY_ENC_TAB } from "./client.ts"

export interface WbiSigner {
  /** Append `w_rid` + `wts` to the given (unsorted) query string. */
  sign(query: string): Promise<string>
}

/**
 * A wbi signer that lazily fetches & caches the mixin key on first `sign()`.
 * Each client instance owns its cache (no cross-test pollution). `host`
 * supplies CORS-free HTTP; `now` may be overridden for deterministic tests.
 */
export function createWbiSigner(
  host: ProducerHost,
  now: () => number = () => host.now(),
): WbiSigner {
  const client = createBilibiliClient({ host, now })
  return {
    sign: (query) => client.signWeb(query),
  }
}
