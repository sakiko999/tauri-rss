import { test, expect, describe } from "bun:test"
import { PRESETS, getPreset, buildPreset, buildPresetSubscription } from "../presets/index.ts"
import { registerAllSources } from "../source/register-all.ts"
import { getSource } from "../source/registry.ts"
import type { PresetSubscription } from "../presets/types.ts"
import type { Subscription } from "../types/subscription.ts"

const runtime = { enabled: true, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 }

describe("presets data", () => {
  test("ids are unique", () => {
    const ids = PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("required fields present per kind", () => {
    for (const p of PRESETS) {
      expect(p.id.length).toBeGreaterThan(0)
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.tag.length).toBeGreaterThan(0)
      switch (p.kind) {
        case "rss":
          expect(p.url.length).toBeGreaterThan(0)
          break
        case "youtube":
          expect(p.channelId.length).toBeGreaterThan(0)
          break
        case "bilibili":
          expect(["popular", "ranking", "weekly", "user-video"]).toContain(p.route)
          if (p.route === "ranking") expect(p.rid).toBeDefined()
          if (p.route === "user-video") expect(p.uid).toBeDefined()
          break
        case "bilibili-rank":
          break // no extra required fields
      }
    }
  })

  test("every preset kind has a registered adapter", () => {
    registerAllSources()
    for (const p of PRESETS) {
      expect(getSource(p.kind), `kind ${p.kind} (${p.id}) should have an adapter`).toBeDefined()
    }
  })
})

describe("preset → subscription builder", () => {
  test("buildPresetSubscription round-trips id/title/kind + kind-specific fields", () => {
    for (const p of PRESETS) {
      const sub = buildPresetSubscription(p, runtime)
      expect(sub.id).toBe(p.id)
      expect(sub.title).toBe(p.title)
      expect(sub.enabled).toBe(true)
      expect(sub.createdAt).toBe(runtime.createdAt)
      expect(sub.updatedAt).toBe(runtime.updatedAt)
      switch (p.kind) {
        case "rss":
          expect(sub).toMatchObject({ kind: "rss", url: p.url })
          break
        case "youtube":
          expect(sub).toMatchObject({ kind: "youtube", channelId: p.channelId })
          break
        case "bilibili":
          expect(sub.kind).toBe("bilibili")
          if (p.rid) expect((sub as { rid?: string }).rid).toBe(p.rid)
          if (p.uid) expect((sub as { uid?: string }).uid).toBe(p.uid)
          break
        case "bilibili-rank":
          expect(sub.kind).toBe("bilibili-rank")
          break
      }
    }
  })

  test("getPreset returns by id; unknown id is undefined", () => {
    expect(getPreset("hn")).toBeDefined()
    expect(getPreset("does-not-exist")).toBeUndefined()
  })

  test("buildPreset throws on unknown id", () => {
    expect(() => buildPreset("does-not-exist", runtime)).toThrow(/Unknown preset id/)
  })

  test("builder default branch throws on an unknown kind", () => {
    const fake = { id: "x", kind: "nope", title: "x", tag: "x" } as unknown as PresetSubscription
    expect(() => buildPresetSubscription(fake, runtime)).toThrow(/Unknown preset kind/)
  })
})
