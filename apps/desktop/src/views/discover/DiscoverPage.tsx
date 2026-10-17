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
import { useMemo, useState } from "react"
import type { ChannelInfo } from "@amoeba/core"
import { useDesktop } from "../../store/index.ts"
import { Icon } from "../../components/Icon.tsx"
import { PLATFORMS, CAP_LABEL, type Cap } from "./platforms.ts"
import { SEARCH_CHANNEL } from "../../lib/subscriptions.ts"
import { PlatformBrowser } from "./PlatformBrowser.tsx"
import { BoardList } from "./BoardList.tsx"

export function DiscoverPage() {
  const dl = useDesktop((s) => s.dl)
  const channels = useMemo(() => dl?.listChannels() ?? [], [dl])
  const [platform, setPlatform] = useState("bili")
  // 子视图提升到此处:能力矩阵的「浏览分区/搜索」按钮要能一并切视图
  // (否则点「搜索」只换平台、视图停在「分区」,bili 无分区渠道 → 显示分区警告)。
  const [view, setView] = useState<Cap>("category")

  // 能力矩阵:某平台的某能力是否可用 = 注册表里存在对应渠道。
  const caps = useMemo(() => {
    const m: Record<string, Record<Cap, ChannelInfo | undefined>> = {}
    for (const p of PLATFORMS) {
      const find = (suffix: string) => channels.find((c) => c.key === `${p.id}:${suffix}` || c.key === `live:${p.id}:${suffix}`)
      // 搜索渠道 key 不一定叫 `<platform>:search`(如 youtube:live-search),
      // 以 SEARCH_CHANNEL 映射为准,再回退旧的命名约定。
      const search = channels.find((c) => c.key === SEARCH_CHANNEL[p.id]) ?? find("search")
      m[p.id] = { category: find("category"), search, anchor: find("anchor") }
    }
    return m
  }, [channels])

  // 「可一键订阅」= 无需用户输入:有 defaultInfo,或参数表里没有 required 字段。
  // ⚠️ 别再按 kind / key 正则缩范围:榜单语义就是「无参渠道」——曾经 /hot|live/ 正则
  // 让 `live:` 前缀误命中(把必填参的 live:huya:search 列进来,一键订阅必失败);
  // 后改为 kind 白名单,又漏掉 social/article 类无参榜单(douyin:trend / weibo:hot /
  // xhs:explore / bili:square)。现只排除原生 RSS 直链(`rss:` —— 它们走「添加订阅」,
  // 属发现页之外的入口,35 条会把榜单淹没)。
  const boards = useMemo(
    () =>
      channels.filter(
        (c) =>
          !c.key.startsWith("rss:") &&
          (!!c.defaultInfo || !(c.sourceInfoTpl ?? []).some((f) => f.required)),
      ),
    [channels],
  )

  return (
    <div className="page">
      <div className="scroll-area page-scroll">
        <div className="page-wrap">
          <h1 className="page-title">发现</h1>
          <p className="page-lead">
            平台能力从已注册渠道推导:能看到的按钮就有对应实现。分区浏览与搜索直接取真实数据,
            不需要先建订阅;找到想看的内容再一键订阅。
          </p>

          <section className="section-first section">
            <div className="section-head">
              <h2 className="section-title">平台能力</h2>
              <span className="section-desc">灰掉的项 = 该平台当前没有对应渠道实现</span>
            </div>
            <div className="platform-grid">
              {PLATFORMS.map((p) => {
                const c = caps[p.id]
                return (
                  <div className="platform-card" key={p.id}>
                    <div className="platform-head">
                      <span className="platform-mark">
                        <Icon name={p.icon} size={17} />
                      </span>
                      <span className="platform-title">
                        <span className="platform-name">{p.label}</span>
                        <span className="t-micro t-dim">{p.id}</span>
                      </span>
                    </div>
                    <div className="cap-list">
                      {(Object.keys(CAP_LABEL) as Cap[]).map((k) => (
                        <div className="cap-row" data-on={String(!!c[k])} key={k}>
                          <Icon name={c[k] ? "checkCircle" : "close"} size={13} />
                          <span>{CAP_LABEL[k]}</span>
                          <span className="spacer" />
                          <span className="t-micro t-dim">{c[k] ? "可用" : "无渠道"}</span>
                        </div>
                      ))}
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
                      {c.search || c.anchor ? (
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
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <PlatformBrowser
            platform={platform}
            caps={caps[platform]}
            view={view}
            onView={setView}
            onPickPlatform={setPlatform}
          />

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">可订阅榜单</h2>
              <span className="section-desc">无参渠道，一键订阅即可持续收到内容</span>
            </div>
            <BoardList boards={boards} />
          </section>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">数据源</h2>
              <span className="section-desc">抓取在本机完成，内容与凭证只存本地，不经中转服务器</span>
            </div>
            <div className="stat-strip">
              {[
                { k: "可用渠道", v: channels.length },
                { k: "平台能力", v: Object.values(caps).reduce((n, c) => n + Object.values(c).filter(Boolean).length, 0) },
                { k: "可一键订阅", v: boards.length },
              ].map((s) => (
                <div className="stack" key={s.k} style={{ gap: 2 }}>
                  <span className="t-micro t-dim">{s.k}</span>
                  <span className="t-h2 num">{s.v}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
