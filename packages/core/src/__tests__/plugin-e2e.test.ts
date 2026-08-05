import { test, expect, describe, afterEach } from "bun:test"
import { createDataLayer } from "../data-layer.ts"
import { createBrowserHost } from "../host/browser-host.ts"
import type { SourceAdapter } from "../index.ts"
import {
  __resetSources,
  registerSource,
  getSource,
  listSources,
  serializeFeed,
} from "@tauri-playground/producer"
import type { FeedItem, ProducerHost, Subscription } from "@tauri-playground/producer"

/**
 * End-to-end plugin test: register a fake adapter with a custom sourceId, then
 * prove `createDataLayer.refresh` routes to it through the open source registry.
 * This is the "pluginability really works" proof for the producer plugin seam.
 * The adapter emits `FeedItem` (protocol); core bridges to MediaItem.
 */
class EchoSource implements SourceAdapter {
  readonly sourceId = "echo" as const
  readonly meta = { name: "Echo" }
  async fetch(subscription: Subscription, host: ProducerHost): Promise<FeedItem[]> {
    return [
      {
        id: "e1",
        sourceId: "echo",
        kind: "article",
        title: `echo:${subscription.title}`,
        fetchedAt: host.now(),
      },
    ]
  }
  async toXml(subscription: Subscription, host: ProducerHost): Promise<string> {
    const items = await this.fetch(subscription, host)
    return serializeFeed(items, { channelTitle: subscription.title })
  }
}

function echoSub(id: string, title: string): Subscription {
  // sourceId:"echo" is an open plugin source — it flows through PluginSubscription.
  return {
    id,
    sourceId: "echo",
    title,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    config: {},
  }
}

describe("producer plugin end-to-end", () => {
  afterEach(() => {
    __resetSources()
  })

  test("a plugin-kind subscription refreshes through the registered adapter", async () => {
    registerSource(new EchoSource())
    const dl = createDataLayer(createBrowserHost())

    await dl.subscriptions.add(echoSub("echo-1", "hello"))
    const res = await dl.refresh("echo-1")

    expect(res.error).toBeUndefined()
    expect(res.itemCount).toBe(1)
    const items = dl.store.query({ subscriptionId: "echo-1" })
    expect(items[0]?.title).toBe("echo:hello")
    expect(items[0]?.sourceId).toBe("echo")
  })

  test("resolveLivePlay on a non-live adapter rejects", async () => {
    registerSource(new EchoSource())
    const dl = createDataLayer(createBrowserHost())
    await dl.subscriptions.add(echoSub("echo-2", "x"))
    await expect(dl.resolveLivePlay("echo-2")).rejects.toThrow(/does not support resolveLivePlay/)
  })

  test("unknown source with no registered adapter throws NoAdapterError on refresh", async () => {
    const dl = createDataLayer(createBrowserHost())
    await dl.subscriptions.add({
      id: "gh",
      sourceId: "github-repo",
      title: "x",
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      config: {},
    })
    await expect(dl.refresh("gh")).rejects.toThrow(/No source adapter registered for subscription source: github-repo/)
  })

  test("registry is shared with producer package (getSource/listSources)", () => {
    registerSource(new EchoSource())
    expect(getSource("echo")).toBeInstanceOf(EchoSource)
    expect(listSources().some((a) => a.sourceId === "echo")).toBe(true)
  })
})
