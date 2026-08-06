# Tauri Playground

Tauri 2 monorepo — RSS Reader，桌面 + 移动双端。

## 目录结构

```
apps/
  src-tauri/     ★ 唯一 Rust crate（tauri-app），桌面/移动共享 commands/plugins
  desktop/       前端（React 19 + Vite，产物 → dist/desktop）。已接入 crawler/core/appHost
  mobile/        前端（React 19 + Vite，产物 → dist/mobile）。⚠️ 仍是 Tauri 模板，
                 尚未接入 crawler/core/appHost —— 是后续工作，勿把它当实现参考
packages/
  xml/           ★ @tauri-playground/xml — RSS 2.0 + tpl: 扩展的编解码（fast-xml-parser v5
                   XMLBuilder 编码 / parseFeed 解码）。唯一持有 fast-xml-parser
  host/          ★ @tauri-playground/host — 宿主后端 + 全局 appHost 门面
                   （node/ 真实网络+内存存储给 example；browser/ 浏览器 fetch+localStorage
                   给纯前端调试；tauri/ Rust http_get+localStorage 给生产）
  crawler/       ★ @tauri-playground/crawler — 订阅源抓取层（producer 的重构替代）。
                   一切皆 RssChannel：channel 描述参数 → getSource(info) → source.fetch()
                   直出 RSS 2.0 + tpl: XML 字符串。XML 即天然类型，不导出数据模型类型
  core/          @tauri-playground/core — 订阅维护者。基于 crawler 输出维护订阅列表 + 分组
                   + 刷新编排 + 持久化。自解析 XML 建 MediaItem（不依赖 crawler 类型）
  ui/            @tauri-playground/ui   — UI 组件库（当前仅按 kind 分发的媒体渲染器）
```

依赖链：`xml ← crawler ← core ← ui ← desktop`；`host` 被 crawler/core/desktop 共用。
读取端（crawler/core）直接访问 `globalThis.appHost.*`，不各自包装。

## 宿主注入：全局 appHost 门面

宿主能力（http / js 签名执行 / storage / now / log）经**全局 `globalThis.appHost`** 注入：

- **正常流程**：应用启动时 `injectTauriHost()`（desktop 在 `main.tsx`）。
- **example / 测试**：`injectNodeHost()`（Node fetch + 内存存储）。
- **纯前端调试**：`injectBrowserHost()`（浏览器 fetch，CORS 受限）。

门面在 `@tauri-playground/host`（`packages/host/src/runtime.ts`）——import host 包即初始化；
字段是 getter，未注入时访问 `http/js/storage` 抛清晰错误，`now/log` 兜底。类型声明在
根 `global.d.ts`（`var appHost: AppHost`），被 `tsconfig.app.json` 的 `files` 引用，
所有 `extends ../../tsconfig.app.json` 的包自动可见。

## 关键命令

```bash
bun run dev                    # Vite dev（纯前端）
bun run tauri                  # Vite dev + Tauri dev 并行（完整应用热重载）
bun run tauri:build            # 前端构建 + release 构建
bun run scripts/tauri.ts help  # 查看全部用法

# crawler example（注入 Node host，真实抓取）
bun run packages/crawler/src/example/list_channels.ts     # 打印全部 channel（47 个）
bun run packages/crawler/src/example/list_sources.ts      # 每个 channel 实例化 source
bun run packages/crawler/src/example/sample_sources.ts live:   # 抽样 fetch，filter=live: 只看直播

# core example（基于 crawler 输出的 channel 批量订阅 + 刷新）
bun run packages/core/src/example/data-layer.ts
```

前端产物输出到根 `dist/<platform>/`（Vite `outDir`），tauri.conf `frontendDist` 指向 `../../dist/<platform>`。

## ⚠️ 环境要求：MSVC linker（重要）

**必须从 "x64 Native Tools Command Prompt for VS 2022" 启动 VSCode / 终端**，否则 Rust 链接会失败。

### 坑：Git Bash 的 `link` 抢 MSVC

Git Bash 自带 `/usr/bin/link`（GNU 链接器），如果它在 PATH 里排在 MSVC 前面，cargo 链接时用它，会报：

```
/usr/bin/link: extra operand '...cgu.0.rcgu.o'
```

**解决**：确保 MSVC 的 `bin\Hostx64\x64` 在 PATH 最前（Native Tools 启动即自动前置）。

> 本机实际版本：`/c/Program Files (x86)/Microsoft Visual Studio/18/BuildTools/VC/Tools/MSVC/14.51.36231/bin/Hostx64/x64`。
> **Bash 工具调用间 env 不持久**——每次 cargo 命令前都要内联 `export PATH`（写在同一条命令里）。

> 之前 `.cargo/config.toml` 硬编码过 linker 路径，已删除（硬编码 MSVC 版本号，VS 更新后必坏）。**不要在 cargo config 里写死 linker**，保持 PATH 方案。

## Git 提交身份

本机未配置全局 git 身份，直接 `git commit` 会报 `Author identity unknown`。提交时显式内联：

```bash
git -c user.name="zhh" -c user.email="zhonghuaremistinker@gmail.com" commit -m "..."
```

## 其他注意事项

- tsc 用根 `./node_modules/.bin/tsc -p <项目>`（各包/desktop/scripts 各自校验）；**不要** `npx tsc`
  （会误装 tsc@2.0.3），**不要**裸 `-p tsconfig.app.json`（扫全仓含 tmp/ 噪音）。
- cargo test/build 前若 tauri-app.exe 仍在运行会锁二进制报 `拒绝访问 (os error 5)`，先 `taskkill //F //IM tauri-app.exe`。
- `tmp/` 是 gitignore 的迁移源 / 参考项目，**不要对它跑任何构建/测试**：
  - `RSSHub` — 路由静态摘录数据源目录（`scripts/rsshub-catalog.ts` 抄它的 handler）
  - `MediaCrawler` — 微博/小红书等反爬平台爬虫对照（确认为什么这些平台搞不定）
  - `dart_simple_live` — 直播流获取参考（虎牙/斗鱼/bilibili/抖音，Dart 实现，
    与 crawler 直播 channel 同源平台）
  - `producer` — 旧订阅生产者源码（无代码引用，保留参考：source/bilibili、douyin abogus、
    douyu cryptojs、huya、rss 的实现范式）
- Rust 增量编译偶尔报 `拒绝访问 os error 5`，是无害警告，忽略。
- Tauri dev 的 `devUrl` 是 `http://localhost:1420`，脚本并行启动 Vite dev server + tauri dev。
- `apps/src-tauri/tauri.conf.json` 是桌面配置，`tauri.conf.mobile.json` 是移动端。

## 测试数据源（RSSHub 摘录 + bilibili 复刻）

- `tmp/RSSHub` 是 RSSHub 的 git clone（已 gitignore）。`docs/rsshub-catalog.*` 由
  `bun run scripts/rsshub-catalog.ts` 静态摘录生成——只把 RSSHub 当**数据源目录**抄，
  **不跑它的运行时**（`@/` alias、config、cache、registry 太重，与不部署的诉求冲突）。
- RSSHub 里**绝大多数 handler 是定制 scraper，无现成原生 feed URL**；只有少量真·原生
  feed 直传（catalog 已高亮）。判断源可用性先 `curl` 实测（检查 200 + `<rss`/`<feed` 头，
  注意新浪科技带 `xml-stylesheet` 会误判 HTML，实为真 RSS）。
- **bilibili wbi 签名零登录可复刻**（关键发现）：`GET /x/web-interface/nav` 未登录
  （`code:-101`）仍返回 `data.wbi_img`，无需 cookie/puppeteer，纯
  `MD5(排序参数&wts&mixinKey)`。范式见 `packages/crawler/src/channels/bili/`
  （wbi 签名在 client.ts，channel 在 channels.ts/live.ts）。换位表 `MIXIN_KEY_ENC_TAB` 与 live 层同源。
- 内置 RSS 直链清单在 `packages/crawler/src/channels/rss/builtin.ts`（36 条，按 kind 标注）。
  desktop 测试订阅在 `apps/desktop/src/subscriptions.ts`（5 个，覆盖 article/video/audio/live）。
  可用性结论见 `docs/domestic-feed-availability.md`。新源先 curl 验证再并入。
- 热门平台判定：YouTube 走官方 RSS 可直接用；bilibili 走 API 可复刻；微博/X/小红书
  是硬反爬（puppeteer+登录+代理），个人不部署 RSSHub 碰不了。

## 下一步 Todo（待办）

- **正常渲染 video / audio / live**：`packages/ui/src/renderers/` 目前是验证型——
  - `VideoRenderer`：播放直链需懒解析（deadline 签名），当前只显示「▶ 播放」链接，未接真实 `<video>`
  - `AudioRenderer`：播客 mp3 无签名，已用 `<audio controls>`，可正常播
  - `LiveRenderer`：playUrls 带 expiry 签名，当前只显示状态 + 链接，未接真实播放
  - 目标：按 `technical-plan.md` 的 VideoPlayer/hls.js 方案接真实播放（video/audio/live 共用），
    懒解析走 crawler 的 `RssVideoSource.resolvePlay` / `RssLiveSource.resolveLivePlay`
- **packages/ui 接入 tailwind**：目前 renderer 全是内联 `style={styles}` CSSProperties；
  desktop 已接 `@tailwindcss/vite`（v4 CSS-first），ui 包本身没有 tailwind 依赖。
  计划：给 ui 包加 tailwind（@theme 设计令牌在 `packages/ui/src/styles/theme.css`，见
  `technical-plan.md` 的 Tailwind 4 接入节——`@source` 显式扫包源码、styles.css 引入 theme.css）。
