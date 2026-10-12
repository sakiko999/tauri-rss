# Tauri Playground — RSS Reader

Tauri 2 monorepo 的本地订阅阅读器：把 **RSS / 视频 / 直播 / 社交** 聚到一个桌面工作台。
抓取、播放解析、弹幕、内容缓存全部在本机完成，数据存本地 SQLite，不经中转服务器。

- **桌面** = 订阅工作台（抓取 / 播放 / 管理全功能）
- **移动** = 模板，尚未接入 `appHost` + `core`

## 快速开始

```bash
bun install

bun run dev              # 只起 Vite dev（纯前端，宿主能力缺失）
bun run tauri            # Vite dev + Tauri dev 并行（完整应用，热重载）
bun run tauri:build      # 前端构建 + release 构建
```

> ⚠️ **必须从 "x64 Native Tools Command Prompt for VS 2022" 启动终端**，否则 Rust 链接失败。
> 完整环境要求见 `CLAUDE.md`。

首次运行会写入一批种子订阅（只在空库时写；之后再启动不覆盖用户数据）。

### 调试 CLI

仓库自带一个零构建的调试探针（Bun + cac），收编了全部 example，覆盖抓取 / 解析 / 弹幕 /
热搜 / 登录态自检：

```bash
bun run rss channels                 # 渠道注册表
bun run rss fetch bili:popular       # 单渠道抓取
bun run rss item <url>               # by-url 解析：路由 + 全档位流 + 弹幕元信息
bun run rss play <url> --open        # 解析直链并丢给系统播放器
bun run rss dm <url>                 # 弹幕样本（VOD 分段 / 直播窗口）
bun run rss env --probe              # appHost 门面自检
```

详见 `docs/cli-plan.md`。

## 包结构

```
apps/
  src-tauri/     唯一 Rust crate（tauri-app）—— http/ws 隧道、CDP 浏览器、SQLite、opener
  desktop/       React 19 + Vite + Tailwind 4，产物 → dist/desktop
  mobile/        React 19 + Vite，产物 → dist/mobile。⚠️ 仍是模板
  cli/           ★ 调试探针（Bun + cac，零构建）
packages/
  xml/           RSS 2.0 + tpl: 编解码（fast-xml-parser v5）
  host/          宿主后端 + 全局 appHost 门面（node / browser / tauri 三环境）
  resolve/       平台解析：播放直链 + 弹幕 + 各平台 client
  crawler/       订阅源抓取层，只输出订阅数据（一切皆 RssChannel → RSS XML）
  core/          订阅维护者：订阅/分组/刷新编排/持久化/TTL 缓存
  player/        媒体播放器（video/audio/live 共用，hls/flv/dash）
  ui/            ⚠️ 只剩 MediaImage 与 fmtCount 在被用；旧 renderers 已删
  log/           域注册语义化日志
```

依赖链 `resolve ← crawler ← core`，播放支线 `core ← player`；`log`/`host` 是零依赖叶子。

## 核心契约

- **crawler → 下游只走 XML**：`channel.getSource(info).fetch()` 直出 RSS 2.0 + `tpl:` 扩展。
  下游自己解析，不依赖 crawler 的数据模型。
- **core 是数据权威**：`deserializeFeed(xml)` → 判别联合 `MediaItem`
  （article / social / video / audio / live）。
- **宿主能力全局注入**：`globalThis.appHost`（http / js / storage / ws / browser）。
  未注入时访问抛清晰错误；可选能力缺失时消费侧降级。
- **URL 是视图位置权威**：`/v/:nodeId`、`/play/:itemId`，store 只做镜像。

架构细节与平台坑位见 `CLAUDE.md`。

## 自检

仓库没有测试框架，用最小断言脚本守住高风险路径：

```bash
bun packages/core/src/example/media-store.check.ts      # 查询分支
bun packages/core/src/example/data-layer.check.ts       # 停用订阅不抓取 / reading 回填
bun packages/core/src/example/repo-concurrency.check.ts # 仓储并发写不丢数据
bun packages/host/src/example/host-check.ts             # 宿主门面字段
```

类型检查（**不要**用 `npx tsc`，会误装 tsc 2.x）：

```bash
./node_modules/.bin/tsc -p apps/desktop/tsconfig.json
```

## 更多文档

| 文档 | 内容 |
| --- | --- |
| `docs/platform-login-research.md` | 三平台扫码登录 + 保活 |
| `docs/danmaku-research.md` | 弹幕机制（VOD 分段 / 直播四平台 codec） |
| `docs/youtube-stream-extraction.md` | YouTube 直链（ANDROID_VR / poToken / DASH） |
| `docs/capability-gaps.md` | 各平台能力缺口 |
| `docs/technical-plan.md` | 三模式 UI 与 live 源的产品错位 |
| `docs/cli-plan.md` | 调试探针设计 |

`tmp/` 是 gitignore 的参考项目（RSSHub / MediaCrawler / dart_simple_live 等），**不要对它跑构建**。
