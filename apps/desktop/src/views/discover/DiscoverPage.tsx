/**
 * DiscoverPage —— 发现页:平台能力矩阵 + 分区浏览 + 搜索,全部接真实渠道。
 *
 * new_desktop 的 discoveries 是静态快照(capabilities/categories 写死在 content.js)。
 * 这里改成**从渠道注册表推导**:
 *   - 平台能力:`dl.listChannels()` 里是否存在 <platform>:category / <platform>:search /
 *     <platform>:anchor 决定;
 *   - 分区浏览/搜索:core `previewChannel(channelKey, info)` 取一次真实数据(不建订阅);
 *   - 一键订阅:`dl.addSubscription`。
 *
 * 面板与榜单已拆到同目录:`PlatformBrowser.tsx`(分区/搜索)· `BoardList.tsx`(一键订阅)·
 * `platforms.ts`(共用常量)。本文件保留能力矩阵与三块 section 的布局。
 */

import type { ChannelInfo } from "@amoeba/core"
import { useEffect, useMemo, useState } from "react"

import { Icon } from "../../components/Icon.tsx"
import { CATEGORY_CHANNEL, SEARCH_CHANNEL } from "../../lib/subscriptions.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { useDesktop } from "../../store/index.ts"
import { AddSubscriptionDialog } from "../manage/AddSubscriptionDialog.tsx"
import { BoardList } from "./BoardList.tsx"
import { PlatformBrowser } from "./PlatformBrowser.tsx"
import { type Cap, CAP_LABEL, CAPS, PLATFORMS } from "./platforms.ts"

export function DiscoverPage() {
  const dl = useDesktop((s) => s.dl)
  const channels = useMemo(() => dl?.listChannels() ?? [], [dl])
  const [platform, setPlatform] = useState("bili")
  // 子视图提升到此处:能力矩阵的「浏览分区/搜索」按钮要能一并切视图
  // (否则点「搜索」只换平台、视图停在「分区」,bili 无分区渠道 → 显示分区警告)。
  const [view, setView] = useState<Cap>("category")
  /** 带「用户主页 → 直播间」解析渠道的平台（目前只有 douyin）→ 弹窗预选该渠道。 */
  const [userDialogKey, setUserDialogKey] = useState<string | null>(null)

  // 能力矩阵:某平台的某能力是否可用 = 注册表里存在对应渠道。
  const caps = useMemo(() => {
    const m: Record<string, Record<Cap, ChannelInfo | undefined>> = {}
    for (const p of PLATFORMS) {
      const find = (suffix: string) =>
        channels.find((c) => c.key === `${p.id}:${suffix}` || c.key === `live:${p.id}:${suffix}`)
      // 搜索渠道 key 不一定叫 `<platform>:search`(如 youtube:live-search),
      // 以 SEARCH_CHANNEL 映射为准,再回退旧的命名约定。
      const search = channels.find((c) => c.key === SEARCH_CHANNEL[p.id]) ?? find("search")
      // 分区渠道名不统一（`youtube:live-category` 不在 `<platform>:category` 约定里），
      // 以显式表为准，再回退旧的命名约定。
      const category = channels.find((c) => c.key === CATEGORY_CHANNEL[p.id]) ?? find("category")
      m[p.id] = { category, search, anchor: find("anchor") }
    }
    return m
  }, [channels])

  /** 有任意分区/搜索能力的平台才进入「分区浏览与搜索」平台条。 */
  const discoverable = useMemo(() => PLATFORMS.filter((p) => CAPS.some((k) => caps[p.id][k])), [caps])

  /** 切平台时把视图落到该平台**实际支持的第一个能力**，避免停在空视图。 */
  const pickPlatform = (id: string) => {
    setPlatform(id)
    const first = CAPS.find((k) => caps[id][k])
    if (first) setView(first)
  }

  // 能力异步就绪/平台能力变化后，当前 view 已不受支持 → 落到第一个可用能力。
  useEffect(() => {
    const c = caps[platform]
    if (c && !c[view]) {
      const first = CAPS.find((k) => c[k])
      if (first) setView(first)
    }
  }, [caps, platform, view])

  // 「可一键订阅」= 无需用户输入:有 defaultInfo,或参数表里没有 required 字段。
  // ⚠️ 别再按 kind / key 正则缩范围:榜单语义就是「无参渠道」——曾经 /hot|live/ 正则
  // 让 `live:` 前缀误命中(把必填参的 live:huya:search 列进来,一键订阅必失败);
  // 后改为 kind 白名单,又漏掉 social/article 类无参榜单(douyin:trend / weibo:hot /
  // xhs:explore / bili:square)。现只排除原生 RSS 直链(`rss:` —— 它们走「添加订阅」,
  // 属发现页之外的入口,35 条会把榜单淹没)。
  const boards = useMemo(
    () =>
      channels.filter(
        (c) => !c.key.startsWith("rss:") && (!!c.defaultInfo || !(c.sourceInfoTpl ?? []).some((f) => f.required)),
      ),
    [channels],
  )

  return (
    <div className="page" {...overlayBlock("discover-page", "page:discover")}>
      <div className="scroll-area page-scroll" {...overlayBlock("discover-scroll", "page:discover:scroll")}>
        <div className="page-wrap" {...overlayBlock("discover-wrap", "page:discover:wrap")}>
          <h1 className="page-title">发现</h1>

          <section className="section-first section" {...overlayBlock("discover-caps", "discover:caps")}>
            <div className="section-head">
              <h2 className="section-title">平台能力</h2>
            </div>
            <div className="platform-grid">
              {PLATFORMS.map((p) => {
                const c = caps[p.id]
                // 用户主页 → 直播间的入口（目前只有抖音）。落地点统一用 live:<platform>
                // （roomIds 已支持主页链接），这样新订阅能和搜索添加/并入已有共用一条渠道；
                // live:douyin:user 只保留给存量订阅。
                const userCh = channels.find((ch) => ch.key === `live:${p.id}:user`)
                const userSubKey = userCh ? (channels.find((ch) => ch.key === `live:${p.id}`)?.key ?? userCh.key) : ""
                const supported = CAPS.filter((k) => c[k])
                // 没有任何入口的平台（如微博/小红书）不摆一张空卡；它们的内容走「可订阅榜单」。
                if (supported.length === 0 && !userCh) return null
                return (
                  <div
                    className="platform-card"
                    key={p.id}
                    {...overlayBlock("platform-card", `discover:platform:${p.id}`)}
                  >
                    <div className="platform-head">
                      <span className="platform-mark">
                        <Icon name={p.icon} size={17} />
                      </span>
                      <span className="platform-title">
                        <span className="platform-name">{p.label}</span>
                      </span>
                    </div>
                    <div className="chip-row">
                      {c.category ? (
                        <button
                          className="chip chip-sm"
                          onClick={() => {
                            setPlatform(p.id)
                            setView("category")
                          }}
                        >
                          浏览分区
                        </button>
                      ) : null}
                      {c.search ? (
                        <button
                          className="chip chip-sm"
                          onClick={() => {
                            setPlatform(p.id)
                            setView("search")
                          }}
                        >
                          搜索
                        </button>
                      ) : null}
                      {c.anchor ? (
                        <button
                          className="chip chip-sm"
                          onClick={() => {
                            setPlatform(p.id)
                            setView("anchor")
                          }}
                        >
                          {CAP_LABEL.anchor}
                        </button>
                      ) : null}
                      {userCh ? (
                        <button className="chip chip-sm" onClick={() => setUserDialogKey(userSubKey)}>
                          用户直播间
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <PlatformBrowser
            platform={platform}
            platforms={discoverable}
            caps={caps[platform]}
            view={view}
            onView={setView}
            onPickPlatform={pickPlatform}
          />

          <section className="section" {...overlayBlock("discover-section", "discover:boards")}>
            <div className="section-head">
              <h2 className="section-title">可订阅榜单</h2>
            </div>
            <BoardList boards={boards} />
          </section>
        </div>
      </div>

      {/* 用户主页链接 → 直播间的直达入口（目前只有 douyin）。 */}
      <AddSubscriptionDialog
        open={!!userDialogKey}
        onOpenChange={(open) => {
          if (!open) setUserDialogKey(null)
        }}
        presetKey={userDialogKey ?? undefined}
      />
    </div>
  )
}
