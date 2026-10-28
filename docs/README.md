# 文档索引

> 2026-10-27 按数据服务单写者复核：分类不变，过时结论已清理。
> `CLAUDE.md` 只保留高频硬契约与本文的精简版。

## 怎么读

- **刚接手**：`architecture/` → `platforms/platform-notes.md` → `ops/smoke-check.md`
- **改代码前**：先看 `ops/smoke-check.md` 的「改了什么 → 跑什么」
- **平台行为存疑**：`platforms/platform-notes.md` 是总表，专项细节看同目录的 youtube / twitch / xhs-signature / login
- **浏览器抓取 / 风控**：`risk/crawler-risk-control.md`

## 架构与契约

| 文档 | 内容 |
| --- | --- |
| `architecture/host-abi.md` | ★ 全局 `appHost` 门面：注入方式、必填/可选能力、`storage` 四态、`batch`/`setSchema` |
| `architecture/data-and-storage.md` | 数据契约（XML 唯一通道 / id 唯一性 / 分页 / 正文补全 / 种子）+ SQLite 选型与迁移 |
| `architecture/crawler-topology.md` | 抓取浏览器归谁/用什么载体（服务 spawn sidecar）+ 移动端为何不能复用 CDP |
| `architecture/system/README.md` | ★ 全仓系统架构文档集：系统总览、包职责与依赖、跨包契约、核心流程、扩展指南、风险与演进 |
| `architecture/system/00-overview.md` – `05-risks.md` | 系统六篇正文（00 总览 → 05 风险与演进），逐篇索引见 `system/README.md` |
| `architecture/system/06-data-service.md` | ★ 数据服务架构与落地（阶段 0–2 已完成）：单写者边界、HTTP/WS 协议、事件/存储、客户端改造、打包 |

## 平台

| 文档 | 内容 |
| --- | --- |
| `platforms/platform-notes.md` | ★ 各平台实测行为与坑：bili / 斗鱼虎牙抖音 / YouTube / 小红书 / Twitch / 时间戳 / Apple 播客 / cookie 登录 |
| `platforms/channels.md` | 渠道与能力总表：已实现的渠道扩展（YouTube 栏目、播放列表、B站合集/收藏夹、分区目录）、未做的缺口、已证伪的路线 |
| `platforms/youtube.md` | YouTube 直链提取（InnerTube / VISIONOS / poToken / DASH 自拼）；client 链与 poToken 结论的唯一权威 |
| `platforms/twitch.md` | Twitch 渠道（公开 GQL + PlaybackAccessToken + usher HLS） |
| `platforms/xhs-signature.md` | 小红书为何不自己实现 x-s 签名：461 根因、签名频率证据、不重启的决定与触发条件 |
| `platforms/login.md` | 平台扫码登录调研（bili/weibo/xhs；weibo/xhs 走 CDP）+ 保活设计（仅 bili 可自动续期；保活未实现） |
| `platforms/domestic-feeds.md` | 国内 RSS/Atom 原生 feed 清单与可用性（2026-08 快照；渠道可用性以 `channels.md` 为准） |

## UI

| 文档 | 内容 |
| --- | --- |
| `ui/ui-conventions.md` | ★ 样式组织、浮层、滚动与虚拟化、交互守卫、卡片分流、发现页、图片防盗链、调试工具 |
| `ui/heliu-redesign-plan.md` | 桌面端「合流」改版计划：原型差距矩阵、目标 IA 与路由、M0–M7 分期、风险登记与决策记录（实施中，分支 `feat/heliu-redesign`） |
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
| `risk/crawler-risk-control.md` | ★ L0–L3 等级与配额、governor、CDP 闸门与 lane、被动采集、窗口模式（浏览器载体归 `crawler-topology.md`） |

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
| `audit/refactor-candidates.md` | 重构候选分档（A 建议做 / B 改到再动 / C 明确不改 / D 已核实） |
| `audit/doc-backlog-2026-10-27.md` | docs 遗留问题全量核对快照（120 条：open/stale/fixed/decision + 下一批建议） |
| `audit/pagination-dedupe-audit-2026-10-27.md` | 渠道翻页/去重全量审计快照（55 渠道 + core 语义；行动项 19 + 合理取舍 26，逐条反驳验证） |

> 2026-10-21 的文档重组与合并/删除记录见当次 git 提交；本索引只列现存文档。
