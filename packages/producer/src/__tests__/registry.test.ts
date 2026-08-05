import { test, expect, describe, beforeEach } from "bun:test"
import { registerSource, getSource, listSources, overrideSource, __resetSources } from "../source/registry.ts"
import { registerAllSources } from "../source/register-all.ts"
import { serializeFeed } from "../source/feed-serializer.ts"
import type { SourceAdapter } from "../source/source-adapter.ts"
import type { FeedItem } from "../types/feed-item.ts"
import type { ProducerHost } from "../types/producer-host.ts"
import type { Subscription } from "../types/subscription.ts"

/** A fake plugin source with a custom sourceId + config schema. */
class FakePluginSource implements SourceAdapter<Subscription> {
  readonly sourceId = "github-repo" as const
  readonly meta = {
    name: "GitHub Releases",
    configSchema: [
      { key: "owner", label: "Owner", type: "text" as const, required: true },
    ],
  }
  async fetch(subscription: Subscription, _host: ProducerHost): Promise<FeedItem[]> {
    const owner = String(subscription.config.owner ?? "?")
    return [
      {
        id: "rel",
        sourceId: "github-repo",
        kind: "article",
        title: `${subscription.title}:${owner}`,
        fetchedAt: 0,
      },
    ]
  }
  async toXml(subscription: Subscription, host: ProducerHost): Promise<string> {
    return serializeFeed(await this.fetch(subscription, host), { channelTitle: subscription.title })
  }
}

const noopHost = {
  http: { async request() { return { status: 200, headers: {}, body: "" } } },
  storage: { async get() { return null }, async set() {}, async delete() {}, async keys() { return [] } },
  js: { eval() { return undefined }, call() { return undefined } },
  log: { log() {} },
  now: () => 0,
} as unknown as ProducerHost

describe("source registry", () => {
  beforeEach(() => {
    // Reset the module-level registry to a clean state for each test.
    __resetSources()
  })

  test("register + get returns the same instance", () => {
    const plugin = new FakePluginSource()
    registerSource(plugin)
    expect(getSource("github-repo")).toBe(plugin)
  })

  test("listSources contains a registered plugin", () => {
    const before = listSources().length
    registerSource(new FakePluginSource())
    const after = listSources()
    expect(after.length).toBe(before + 1)
    expect(after.some((a) => a.sourceId === "github-repo")).toBe(true)
  })

  test("re-registering the same source overrides", () => {
    const first = new FakePluginSource()
    registerSource(first)
    const second = new FakePluginSource()
    registerSource(second)
    expect(getSource("github-repo")).toBe(second)
  })

  test("overrideSource replaces an existing source", () => {
    registerSource(new FakePluginSource())
    const replacement = new FakePluginSource()
    overrideSource(replacement)
    expect(getSource("github-repo")).toBe(replacement)
  })

  test("registerAllSources registers all built-ins", () => {
    registerAllSources(noopHost)
    for (const sourceId of ["rss", "bilibili", "youtube", "douyu", "douyin", "huya"]) {
      expect(getSource(sourceId)).toBeDefined()
    }
  })

  test("plugin config fields flow through the open subscription shape", async () => {
    registerSource(new FakePluginSource())
    const plugin = getSource("github-repo")!
    const items = await plugin.fetch(
      {
        id: "gh-1",
        sourceId: "github-repo",
        title: "test-repo",
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
        config: { owner: "foo" },
      },
      noopHost,
    )
    expect(items[0]).toMatchObject({ title: "test-repo:foo", sourceId: "github-repo" })
  })
})
