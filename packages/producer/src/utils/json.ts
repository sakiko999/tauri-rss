/**
 * Small shared helpers for platform adapters. Platform API responses are
 * unstructured JSON; `Json` lets adapters index deeply without per-key
 * narrowing fights, while the boundary stays `unknown`.
 */

/** Loose JSON object type — index freely inside adapters. */
export type Json = Record<string, any>

export function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10)
  return Number.isNaN(n) ? 0 : n
}

export function strOr(v: unknown): string | undefined {
  return v === undefined || v === null || v === "" ? undefined : String(v)
}

export function arr(v: unknown): Json[] {
  return Array.isArray(v) ? (v as Json[]) : []
}

/** Decode an HTTP body (string or bytes) to text. */
export function bodyText(body: string | Uint8Array): string {
  return typeof body === "string" ? body : new TextDecoder().decode(body)
}
