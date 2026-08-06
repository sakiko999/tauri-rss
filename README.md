# Tauri Playground

Tauri 2 monorepo —— RSS Reader，桌面 + 移动双端。

## 包结构

```
apps/
  src-tauri/     ★ 唯一 Rust crate（tauri-app），桌面/移动共享 commands/plugins
  desktop/       前端（React 19 + Vite，产物 → dist/desktop）。已接入 crawler/core/appHost
  mobile/        前端（React 19 + Vite，产物 → dist/mobile）。⚠️ 未接入架构，仍是 Tauri 模板
packages/
  xml/           RSS 2.0 + `tpl:` 扩展编解码（fast-xml-parser v5）
  host/          宿主后端 + 全局 appHost 门面（node / browser / tauri 三环境）
  crawler/       订阅源抓取层 —— 一切皆 RssChannel：channel → source → RSS XML
  core/          订阅维护者 —— 订阅列表/分组/刷新编排/持久化（基于 crawler 输出）
  ui/            UI 组件库（按 kind 分发的媒体渲染器）
```

依赖链：`xml ← crawler ← core ← ui ← desktop`；`host` 共用。

## 核心思路

- **crawler 的公共契约只有「渠道 → 参数 → XML」**：`channel.getSource(info).fetch()` 直出
  RSS 2.0 + `tpl:` 扩展 XML。XML 就是天然类型，下游自己解析，不依赖 crawler 的数据模型。
- **宿主能力全局注入**：`globalThis.appHost` 门面（http / js 签名执行 / storage / now / log）。
  生产走 `injectTauriHost()`，example/测试走 `injectNodeHost()`，纯前端调试走 `injectBrowserHost()`。
- **core 自建渲染模型**：`deserializeFeed(xml)` → 判别联合 `MediaItem`（article/social/video/audio/live），
  `ui` 按 kind 分发渲染器。

## 快速开始

```bash
bun install
bun run dev                    # Vite dev（纯前端）
bun run tauri                  # Vite dev + Tauri dev 并行
bun run tauri:build            # 前端构建 + release 构建

# crawler example（真实抓取，注入 Node host）
bun run packages/crawler/src/example/list_channels.ts
bun run packages/crawler/src/example/sample_sources.ts live:

# core example（从 channel 批量订阅 + 刷新）
bun run packages/core/src/example/data-layer.ts
```

> ⚠️ Rust 侧要求从 "x64 Native Tools Command Prompt for VS 2022" 启动终端（MSVC linker），详见 CLAUDE.md。

## 参考项目（`tmp/`，gitignore）

| 项目 | 用途 |
|---|---|
| `tmp/RSSHub` | 路由静态摘录数据源目录（`scripts/rsshub-catalog.ts` 抄 handler） |
| `tmp/MediaCrawler` | 微博/小红书等反爬平台爬虫对照（确认为什么搞不定） |
| `tmp/dart_simple_live` | 直播流获取参考（虎牙/斗鱼/bilibili/抖音） |
| `tmp/producer` | 旧订阅生产者源码（已无代码引用，保留实现范式参考） |

## 下一步 Todo

Demo 必选（按建议顺序）：
- **1 媒体播放闭环**：`packages/ui/src/renderers/` 补真实播放 —— 先 Audio（已通）+ Live（playUrls 现成），
  再 Video（懒解析）；按 `technical-plan.md` 的 VideoPlayer/hls.js 方案（video/audio/live 共用），
  懒解析走 `RssVideoSource.resolvePlay` / `RssLiveSource.resolveLivePlay`
- **2 订阅管理 UI**：`TEST_SUBSCRIPTIONS` 硬编码 → 用 `RssChannel.sourceInfoTpl` 自动生成增删订阅表单
- **3 packages/ui 接入 tailwind**：renderer 从内联 style 迁到 Tailwind 4（@theme 令牌在
  `packages/ui/src/styles/theme.css`），desktop 已接好 `@tailwindcss/vite`
- **4 阅读体验**：文章详情 / HTML 渲染 / 图片加载

Demo 之后：react-query + 无限滚动、三模式 UI（三分栏/瀑布流/短视频）、mobile 接入、离线缓存 + SQLite。

完整清单见 CLAUDE.md「下一步 Todo」。

## 更多文档

- `docs/technical-plan.md` — 整体技术方案（UI 三模式 / 数据流边界 / Tauri 插件调研）
- `docs/domestic-feed-availability.md` — 国内平台 feed 可用性梳理
- `docs/rsshub-catalog.md` — RSSHub 路由静态摘录
- `CLAUDE.md` — 项目约定与工程环境细节
