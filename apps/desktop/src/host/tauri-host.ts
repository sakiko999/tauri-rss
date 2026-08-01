/**
 * createTauriHost — a production `PlatformHost` for the desktop webview.
 *
 *   - http:    `TauriHttpBackend` (Rust reqwest, CORS-free)
 *   - storage: localStorage-backed (persists across launches)
 *   - js:      `FunctionJsBackend` — runs the live-platform sign blobs
 *              (Douyu CryptoJS / Douyin ABogus). CSP in tauri.conf is null.
 *   - log:     console
 *   - now:     Date.now
 *
 * Reuses the web-standard pieces from core (`LocalStorageBackend`,
 * `FunctionJsBackend`, `ConsoleLogger`) and swaps in the native HTTP backend.
 */
import {
  LocalStorageBackend,
  FunctionJsBackend,
  ConsoleLogger,
  type PlatformHost,
} from "@tauri-playground/core"
import { TauriHttpBackend } from "./tauri-http"

export function createTauriHost(): PlatformHost {
  return {
    http: new TauriHttpBackend(),
    storage: new LocalStorageBackend("tauri-rss:"),
    js: new FunctionJsBackend(),
    log: new ConsoleLogger(),
    now: () => Date.now(),
  }
}
