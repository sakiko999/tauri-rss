/**
 * Live platform registration. Call `registerAllLiveSites(host)` once at data-
 * layer construction so the `LiveSource` adapter can resolve each platform via
 * the registry in `live/index.ts`.
 *
 * Each platform site is constructed with the host (for HTTP + JS), then
 * registered by its platform id.
 */
import type { ProducerHost } from "../../types/producer-host.ts"
import { registerLiveSite } from "../index.ts"
import { BilibiliSite } from "./bilibili/site.ts"
import { DouyuSite } from "./douyu/site.ts"
import { DouyinSite } from "./douyin/site.ts"
import { HuyaSite } from "./huya/site.ts"

export function registerAllLiveSites(host: ProducerHost): void {
  registerLiveSite(new BilibiliSite(host))
  registerLiveSite(new DouyuSite(host))
  registerLiveSite(new DouyinSite(host))
  registerLiveSite(new HuyaSite(host))
}
