# CLI 计划 —— apps/cli 调试工具(2026-08-27 调研定稿,**2026-08-28 落地 M1+M2**)

> 定位:**调试优先**,不是终端版 RSS 阅读器。它是 crawler/resolve/core 的正式观测面——
> 把散装 example(list_channels/sample_sources/resolve/test-danmaku/verify-*)统一收编
> 成命令,以 ad-hoc 直跑取代「开 tauri dev + desktop UI 复现」的调试循环。
> 附带红利:三大探针立起后,**清退大部分数据路径 debug log**(见 §7)。
>
> ✅ **落地状态(2026-08-28)**:八命令(channels/fetch/item/play/dm/align/env/refresh)
> 全部可用(`bun run rss <cmd>`),bili video/live、douyu、youtube 实测通过。落地时的
> 两个实现修正:① file-repo 不需要——core 三 repo 本就只认 `StorageBackend` 抽象,
> CLI 只写了一个 file storage backend(apps/cli/.data/storage.json);② bili cookie
> 不用 hack import——`DEFAULT_SETTINGS` 已内嵌,CLI 从 file settings 读(改 storage.json
> 的 settings 键即换真实 cookie)。log shim:CLI 无 localStorage,垫了一个默认
> `log="0"` 的 shim(`RSS_LOG=1` 放开),数据路径 info/debug 不淹没探针输出。
> 待办:M3 `--log` 域开关、M4 §7 log 清退。

## 一、范围与非目标

**一期渠道**(纯 HTTP/算法,零浏览器):`rss:*` 直链、`bili:*`(popular/weekly/ranking/
square/user_video/dynamic/live)、`youtube`/`youtube:live`、`live:{douyu,huya,douyin,bili}`(+hot)。

- ⛔ **浏览器模拟渠道暂不考虑**:`weibo:user`、`xhs:*` 及扫码登录(`login`)整条线
  (依赖 appHost.browser = Edge spawn + CDP)。将来解锁时只需补一个 Bun 版 browser
  backend(spawn Edge + CDP 走 ws 包),门面接口已留好(`appHost.browser` 可选、未注入
  自动降级),CLI 其余部分零改动。
- ⛔ **不做播放**:只到"解析出 stream 清单"为止;hls.js/flv.js/dashjs 不进 CLI。
  验证直链用 `--open` 丢给系统播放器。
- bili 登录档位不受影响:走 `core/bilibili-cookie.ts` 静态 cookie 合并(data-layer
  `sourceInfoFor` 自动注入),与浏览器无关。

## 二、技术选型:Bun + cac,零构建

| 方案 | 结论 |
|---|---|
| **Bun + cac 参数式** | **选定**。与仓库一致(TS 直跑免构建,改完即跑,比 tauri dev 循环快一个量级);playwright 兼容坑随之消失 |
| Bun + Ink(TUI) | 渐进增强备选(单命令内嵌 ink render),不互斥;阅读器诉求弱化后暂无必要 |
| Node + tsx + commander | 不选:仓库其余全 bun,徒增分裂 |
| Rust clap | 排除:重写整个数据层 |

目录:

```
apps/cli/
  package.json     # @tauri-playground/cli;deps: core, host, log + cac + picocolors + qrcode
  tsconfig.json    # 不 extends tsconfig.app.json(DOM/vite 环境);面向 bun/node:
                   #   types: ["@types/bun"], moduleResolution bundler, allowImportingTsExtensions
  src/
    main.ts            # cac 入口 + 命令注册(根 scripts 加 rss:* 快捷)
    host/node-host.ts  # injectNodeHost 变体:http=fetch / js=new Function / ws=ws包
                       #   [纪律]ws 必须绑 nodeWsBackend(ws 包),不透传 Bun 原生 WebSocket(§三)
                       #   [新增]storage=file 实现替换内存版
    store/file-repo.ts # 三 repo 的 file-JSON 实现(按接口写,细节不外渗——§六)
    commands/*.ts      # 命令实现(§四)
    ui/render.ts       # 表格输出(picocolors 即够)
    ui/qr.ts           # 暂缓(登录延后)
```

## 三、Rust 绑定能力的对应(appHost 门面已解决)

desktop 前端 grep `@tauri-apps` 零命中——所有 Rust 能力只经门面暴露,且 node 后端
已被 crawler/core example 长期验证。逐项对应:

| Rust command | CLI(Bun)实现 | 状态 |
|---|---|---|
| `http_get`(reqwest) | fetch(`node-backend.ts`) | ✅ 已验证 |
| `ws_connect`(tungstenite+header) | `ws` 包(`node-ws.ts`) | ✅ test-danmaku 四平台通 |
| js 签名执行(new Function) | Node new Function(`node-js.ts`) | ✅ douyin abogus/webmssdk 通 |
| localStorage | **file-JSON repo(唯一要新写)** | ⬜ 小工作量 |
| browser_ensure/close | — | 已排除 |

两个真实差异面:

1. **TLS/HTTP 指纹不同**(reqwest/rustls ≠ Bun fetch):对主流目标(bili/youtube/四站
   直播)无碍——这就是 example 在跑的路径。遇平台行为不一致时,`rss fetch` 反而是最快的
   隔离工具(区分代码 bug vs 宿主指纹差异)。
2. **bili 直播弹幕不许碰 Bun 原生 WebSocket**:Bun 内置 WS 是浏览器标准 API,不支持
   自定义握手头,而 bili 要在握手里带 Cookie(buvid3/nav mid)。必须经 `appHost.ws`
   注入 `ws` 包 backend——注入层别图省事透传 native WS。

## 四、命令集(以调试为中心)

```bash
rss channels [--kind live]          # 渠道注册表:name/tpl 字段/defaultInfo 快照
rss fetch <key> k=v ...             # ★ 单渠道抓取探针:耗时+条数;--xml 看原始输出;
                                    #   --json 进管道配 jq;失败完整堆栈;--log <域,...> 细粒度日志开关
rss item <url>                      # ★ by-url 一站式:resolveRoute 命中 → streams 全档位表
                                    #   (format/rate/headers)→ danmaku 元信息
rss play <url> [--open]             # 同 item 只看流;--open 丢系统播放器实测直链活性
rss dm <url> [-n 50]                # 弹幕探针:VOD 前 N 条样本 / 直播实时滚动 + 连接帧数统计
rss align                           # 收编 verify-alignment:crawler XML 与 rsshub 同构消费断言
rss env                             # ★ appHost 各门面自检(http/ws/js/storage 可用性+caps)
rss refresh [sub]                   # core createDataLayer 编排冒烟(file settings 存 baseUrl/cookie)
rss hot <词>                        # weibo:hot resolveHotWord 热搜词流(需登录 cookie;纯匿名失败)
rss detail [url|--latest]           # xhs 单条详情补全(匿名 noteDetail,--latest 用当前列表首条)
```

★ = 使用频率最高的三条探针,M1 优先交付。可观测性是一等公民:**每个命令默认给耗时,
`--json` 全线支持**,错误打完整堆栈。

## 五、example → 子命令收编映射

散装 example 已全部收编转正,并已清退(2026-08-31);新增调试能力只写一处(CLI):

| 现有脚本 | 收编为 | 状态 |
|---|---|---|
| crawler `list_channels.ts` | `rss channels` | ✅ 已收编并清退 |
| crawler `sample_sources.ts` | `rss fetch`(加参数传递与计时) | ✅ 已收编并清退 |
| crawler `resolve.ts` | `rss item` / `rss play` | ✅ 已收编并清退 |
| crawler `test-danmaku.ts` | `rss dm`(单 url 版) | ✅ 已收编并清退(批量多平台版不补——fetch+dm 组合即可) |
| crawler `test-multi-room.ts` | (一次性验证) | ✅ 清退(多房间用 `rss fetch --kv roomIds=`) |
| core `verify-alignment.ts` | `rss align` | ✅ 已收编并清退 |
| core `verify-new-channels.ts` | `rss hot`(resolveHotWord 部分) | ✅ 收编;清退 |
| core `data-layer.ts` / `source-groups.ts` / `verify-source.ts` / `can-loadmore-check.ts` | (一次性/架构验证) | ✅ 清退 |
| crawler `browser-sim.ts` | (保留为独立脚本) | ⬅️ **唯一保留**——CLI 排除浏览器模拟渠道。**2026-09-11 起零依赖**:bun 内置 WebSocket 直连 CDP(edge-cdp skill 起的 Windows Edge),不再需 playwright-core/tsx |

## 六、存储:file-JSON 起步,为 SQLite 切换留门

core 数据层认 repo 接口(`subscription/reading/settings-repo` 注入 `createDataLayer`),
换 backend 不动 core 与命令层:

```
✅ 已切(2026-08-28):  bun:sqlite (CLI,apps/cli/.data/rss.db)
                        /  tauri-plugin-sql (desktop,appData/rss.db)
共用:  DDL 唯一权威 = core db/schema.ts(两端各跑同一份幂等迁移)
```

- ✅ **已落地**(选型/迁移/验证状态见 `docs/sqlite-storage-research.md`):desktop 用官方
  tauri-plugin-sql(sqlx 底层,**不用其 Rust 侧 migration**——防与 CLI 各写各的 SQL
  漂移),CLI 用内置 `bun:sqlite`;StorageBackend 语义保持(KV string),三 repo 与
  commands 全身而退。desktop 首次访问自动从 localStorage 搬迁 subscriptions/reading/
  settings 三 key 并删 local 防双源漂移。
- WAL:两端各持独立库文件、单进程访问,暂不开;sidecar 互通(同库文件)时再开。

## 七、log 清退联动(CLI 的最大一次性红利)

判据不是"log 写得好不好",而是 **"CLI 能否直接复现"**:

| 类型 | 定义(~占比) | 处置 |
|---|---|---|
| 数据路径 log(~80%) | request/response、抓取、流解析决策、弹幕帧统计、deserialize 中间值——函数进出与数据形态 | **清退**。CLI 探针给出结构化答案,优于把散布各处的 log 自己拼回去 |
| 环境路径 log(~20%) | 仅 Tauri/WebView 存在的行为:base64 分片隧道、hls/flv 锁档带宽失真、canplay 自动播时序、webview 并发 UI 竞态 | **保留**。CLI 无法复现,log 是唯一案发现场 |

具体动作:M1-M2 之后分批执行——

- warn/error 一级不留地保留(永久级别)
- crawler 各 channel 域 + danmaku WS 模板事件几乎全是数据路径 → 大面积清退,仅在
  "请求失败/风控命中"处留一个 warn
- player/host 分拣:`loader/play/engine` 里隧道/canplay 相关留;`select`(选流纯逻辑)
  在 `rss item` 可重演 → 清
- 清完后剩余 log 收敛进更少域(host 一个 + player 一两个),不再每 channel 一个

**防回涨新约定**:任何 bug 先问"CLI 能否复现"。能 → 不许为它加 log,去修 CLI/加探针;
不能 → 才允许埋 log。没有这条,下一次赶工 log 会重新长回来。

⚠️ 顺序不能反:先立三大探针再动 log(旧观测拆掉前新的必须在岗)。
⚠️ CLI 抓不到的两类 bug 留保险:长时间运行的累积性问题(泄漏/竞态)、UI 交互触发的
状态错乱——这几处 log 别删。

## 八、落地顺序

1. ✅ **M1 骨架 + 三大探针**(2026-08-28):package.json/tsconfig/main.ts + `channels` /
   `fetch` / `item` 打通 workspace 引用链(交付即可开始用它替代 example 调试)
2. ✅ **M2 核心闭环**(2026-08-28):`dm` + `align` + `env`;file-JSON settings;
   `refresh` 冒烟(`play --open` 顺带完成,M3 项)
3. ✅ **M2.5 example 清退 + hot 命令**(2026-08-31):删除 crawler/core 全部被收编/
   一次性 example,仅留 `browser-sim.ts`(浏览器模拟,CLI 排除);新增 `rss hot <词>`
   (weibo:hot resolveHotWord,desktop 热搜三栏能力)
4. **M3 打磨**:`--log` 域开关接 `@tauri-playground/log`(现为 RSS_LOG=1 全开)、
   表格渲染打磨
5. **M4 log 清退**:按 §7 分批清退数据路径 log + 精简域(探针已在岗,顺序前提满足)
6. 待办(搁置):Bun 版 browser backend(spawn Edge + CDP over ws 包)→ 解锁 weibo/xhs;
   login 扫码(qr.ts)
5. 待办(搁置):Bun 版 browser backend(spawn Edge + CDP over ws 包)→ 解锁 weibo/xhs;
   login 扫码(qr.ts)

## 九、收益总结

- **迭代速度**:免 vite/tauri 的毫秒级反馈循环,crawler/resolve/core 改动即测
- **回归测试入口**:`fetch`/`item`/`dm` 天然是各平台解析的可脚本化回归(配 --json 出断言)
- **未来 sidecar 地基**(desktop 爬虫服务化,2026-08-25 决策):file-repo + node-host
  基建外套 HTTP 层(hono/fastify)即是 sidecar,CLI 先行是该里程碑的第一块
