# 文档索引

> 2026-10-21 重组：按「架构 / 平台 / UI / 播放 / 风控 / 运维 / 审计」分类，相近文档已合并。
> `CLAUDE.md` 只保留高频硬契约与本文的精简版。

## 怎么读

- **刚接手**：`architecture/` → `platforms/platform-notes.md` → `ops/smoke-check.md`
- **改代码前**：先看 `ops/smoke-check.md` 的「改了什么 → 跑什么」
- **平台行为存疑**：`platforms/platform-notes.md` 是总表，专项细节看同目录的 youtube / twitch / xhs-signature / login
- **浏览器抓取 / 风控**：`risk/crawler-risk-control.md`

## 架构与契约

| 文档 | 内容 |
| --- | --- |
| `architecture/host-abi.md` | 全局 `appHost` 门面：注入方式、必填/可选能力、storage 三态 |
| `architecture/data-and-storage.md` | 数据契约（XML 唯一通道 / id 唯一性 / 分页 / 正文补全 / 种子）+ SQLite 选型与迁移 |
| `architecture/crawler-topology.md` | desktop 爬虫服务化决策与切分边界 + 移动端为何不能复用 CDP |
| `architecture/system/README.md` | ★ 全仓系统架构文档集：系统总览、包职责与依赖、跨包契约、核心流程、扩展指南、风险与演进 |
| `architecture/system/06-data-service.md` | 数据服务（CLI 载具）计划：单写者边界、HTTP/WS 协议、事件/存储、客户端改造、打包与阶段 |

## 平台

| 文档 | 内容 |
| --- | --- |
| `platforms/platform-notes.md` | ★ 各平台实测行为与坑：bili / 斗鱼虎牙抖音 / YouTube / 小红书 / Twitch / 时间戳 / Apple 播客 / cookie 登录 |
| `platforms/channels.md` | 渠道与能力总表：已实现的渠道扩展（YouTube 栏目、播放列表、B站合集/收藏夹、分区目录）、未做的缺口、已证伪的路线 |
| `platforms/youtube.md` | YouTube 直链提取（InnerTube / VISIONOS / poToken / DASH 自拼） |
| `platforms/twitch.md` | Twitch 渠道（公开 GQL + PlaybackAccessToken + usher HLS） |
| `platforms/xhs-signature.md` | 小红书 x-s 签名：461 根因、有效参照、社区现状复核、不重启的决定 |
| `platforms/login.md` | 三平台扫码登录 + 保活设计（仅 bili 可自动续期；保活未实现） |
| `platforms/domestic-feeds.md` | 国内 RSS/Atom feed 可用性实测 |

## UI

| 文档 | 内容 |
| --- | --- |
| `ui/ui-conventions.md` | ★ 样式组织、浮层、滚动与虚拟化、交互守卫、卡片分流、发现页、图片防盗链、调试工具 |
| `ui/heliu-redesign-plan.md` | 桌面端「合流」改版计划：原型差距矩阵、目标 IA 与路由、M0–M7 分期、风险登记与决策记录（草案） |
| `ui/numbered-ui-overlay.md` | Numbered UI Overlay（dev-only）：编号语义、400 上限、AI 清单 |
| `ui/rail-tree-accordion.md` | 侧栏树为何用 Accordion + 三个静默失败坑 |

## 播放与弹幕

| 文档 | 内容 |
| --- | --- |
| `playback/playback.md` | ★ 选流契约、HLS/DASH 锁档、loader 路由、自动播放、统计信息 |
| `playback/danmaku.md` | 弹幕机制（VOD 分段 / 直播四平台 codec）+ 播放器侧约定 |
| `playback/mpv.md` | 外部 mpv 播放器接入（**未做**） |

## 风控

| 文档 | 内容 |
| --- | --- |
| `risk/crawler-risk-control.md` | ★ L0–L3 等级与配额、governor、CDP 闸门、浏览器被动采集、窗口模式、多 tab/lane 设计 |

## 运维

| 文档 | 内容 |
| --- | --- |
| `ops/commands.md` | ★ 全部命令、自检脚本、UI/浏览器探针 + CLI 设计与边界 |
| `ops/smoke-check.md` | ★ 端到端巡检清单（改了什么 → 跑什么） |
| `ops/release-updater.md` | 发布产物（NSIS）、签名密钥、自动更新链路、发版步骤 |

## 审计

| 文档 | 内容 |
| --- | --- |
| `audit/findings.md` | 审计结论（故意不改 / 误报证伪）+ 兼容补丁清单 + 破坏性变更 |
| `audit/refactor-candidates.md` | 重构候选分档（A 建议做 / B 改到再动 / C 明确不改 / D 待确认） |

## 本次整理的合并与删除

| 原文档 | 去向 |
| --- | --- |
| `capability-gaps.md` + `channel-expansion-research.md` | → `platforms/channels.md` |
| `audit-backlog.md` + `compatibility-inventory.md` | → `audit/findings.md` |
| `desktop-crawler-service.md` + `mobile-cdp-feasibility.md` | → `architecture/crawler-topology.md` |
| `data-conventions.md` + `sqlite-storage-research.md` | → `architecture/data-and-storage.md` |
| `commands.md` + `cli-plan.md` | → `ops/commands.md` |
| `image-loading-referrer.md` | → `ui/ui-conventions.md`（图片加载与防盗链一节） |
| `rsshub-vs-crawler.md` | 删除；RSSHub 具名渠道已于 2026-10-18 移除，决策教训并入 `platforms/channels.md` |
| `folo-architecture-research.md` | 删除；未采纳任何结论 |

其余文档仅移动/改名（`youtube-stream-extraction` → `youtube`、`twitch-channel` → `twitch`、
`xhs-signature-research` → `xhs-signature`、`platform-login-research` → `login`、
`domestic-feed-availability` → `domestic-feeds`、`danmaku-research` → `danmaku`、
`mpv-playback-research` → `mpv`），内容不变。
