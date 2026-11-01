# 播放器：B 站网页端对齐计划（P0 起）

> 目标：UI 与交互对齐 B 站网页端播放器（点播为主），**排除**高级弹幕（mode 7/8/9、BAS、
> 代码弹幕）、互动视频、社交与弹幕写操作。工程量与依据见 2026-11-01 调研
> （全量约 130-190 人日；仅「像 B 站」的点播闭环约 72-102 人日）。
> 前置：`docs/ui/design-system-plan.md` 的 F1/F2（浮层原语与边界）。
> 各阶段完成状态见 `docs/ops/backlog.md` §B（本文只保留已完成阶段结论与未完成任务拆解/验收口径）。
>
> **范围裁剪（2026-11-01 定）**：P1 的「CC/AI 字幕」「快捷键全集 + 右键菜单体系」
> 暂不做（右键菜单体系内的**统计信息面板**已提前重做，见下方已落地）。

## 现状（2026-11-01，已合入 master）

已具备：四引擎分发（mp4/HLS/FLV/DASH）、播放/拖拽/缓冲/悬停时间、音量/静音、倍速、
按 resolve 多流切清晰度、全屏、剧场、视频小窗 + 音频迷你条、跨路由不打断、续播、队列
自动下一条、Canvas 弹幕（mode 1-5）、B 站章节、统计信息；直播/点播模式显式分流
（`mode` prop，宿主按条目 kind 给，不等媒体元数据）。

结构性阻碍（剩余）：`PlayableMedia` 8 个 early-return 分支（P0b-2 拆会话/解析/控制器）；
Audio/Video 两套不对称会话；`player/ui` 原语与 token 仅首批（PlayOverlay/
VideoContextMenu/PlayerContainer），设置面板/OSD 等 P1 原语未建。

## 已落地（P0a + P0b-1，2026-11-01，已合入 master）

- **P0a-1 / P0a-2 / P0a-3**：`VideoShell` 增 `slots.{topBar,overlay,controls}`；
  `ui/PlayOverlay.tsx` / `ui/VideoContextMenu.tsx` / `ui/PlayerContainer.tsx`（Provider +
  非 React 路径的 `getPlayerContainer/setPlayerContainer`）落地，菜单 Portal 进播放器容器、
  全屏可见；`prefs.ts`（localStorage，不进 core schema）存音量/静音/倍速，只记用户操作。
  约定与踩坑见 `docs/playback/playback.md`。
- **P0a-4 WebView2 能力 spike（实测 WebView2 Edg/156，dev 实例内 eval）**：画中画 PiP、
  MediaSession、Fullscreen API 可用；H.264/AAC 为主路径；HEVC（依赖系统扩展）/AV1/VP9
  的 `canPlayType=probably` 只代表容器/编解码字符串被识别，**不等于硬解码**，实际可播性以
  `ui-play-check` 真播矩阵为准。
- **P0b-1 媒体状态外置**：`hooks/mediaClock.ts`（外部 store）+ `useMediaTime(clock, selector)`。
  `timeupdate/progress` 只写时钟、不 setState；消费方按**原始值**切片订阅（时间文本按秒、
  进度条 4Hz、live-edge 按差值、弹幕层在订阅回调里推进）。VideoShell/PlayerControls 不再
  随 4Hz 重渲。`VideoPlayState` 只剩冷字段（注意：`BufferedRange` 导出已移除，
  `currentTime/bufferedEnd` 改走 clock）。
- **P0b-3（部分）**：Esc 先关浮层（统计/右键菜单）；theater 已收编会话 store
  （`useVideoSession.theater`，跨路由/小窗保持）。
  ⚠️ **全屏退出是 Chromium 的 UA 级手势，`preventDefault()` 拦不住**——全屏下按 Esc
  会同时关浮层并退出全屏（真正拦住需要 Keyboard Lock API，未接入）。
- **视觉口径实测（2026-11-01）**：用干净 Edge 打开真实 B 站播放页（点播 + 直播），抓
  computed style 与控件几何。摘要：控件行 35px、左右 12px、图标命中区 36×22、文字按钮
  14px、无分隔线；进度条 4px 恒定、已播 **#00AEEC 蓝**、缓冲白 30%、轨道白 20%、圆角
  1.5px；时间 `01:00 / 02:10` 补零；直播已播 `407:26:23` 补零 hh:mm:ss、无 LIVE 胶囊；
  弹幕开关 = 「弹」框 + 开启时**品牌粉对勾**；二级弹窗 hover 触发（离开 150ms 收起）、
  `rgba(20,20,20,.9)` + 2px 圆角、条目 36px、选中 #00AEEC，以触发按钮为轴居中、底边距
  9px；倍速 `2.0x`、清晰度 169px 左对齐；控件图标统一 22px 渲染框、glyph ~17-18px。
  几何已落进 `PlayerControls` 实现，本文不再维护逐项清单。
- 弹幕发送功能删除（依赖平台写接口，与项目定位不符），控件栏保留弹幕开关；统计信息
  重做为三段式（会话 / 画面 / 音频），引擎拿不到的字段整行不渲染（约定见
  `docs/playback/playback.md`）。验证工具：`scripts/player-dryrun.ts`（媒体流稳定性探针）、
  `scripts/ui-play-check.ts`（真播矩阵）。

## 框架评估：保持 React（2026-11-01）

问：player 包要不要改 Web Components（兼容性）或 SolidJS（性能）？**结论：都不换。**

| 动机 | 事实 | 判断 |
| --- | --- | --- |
| Web Components 换兼容性 | 唯一宿主是桌面 WebView2（Chromium Evergreen）；mobile 已冻结；不存在「多框架宿主复用」场景 | 兼容性无收益——要兼容的环境不存在 |
| Solid 换性能 | 已知瓶颈是**状态架构**（`useVideoElement` 把 4Hz 进度塞 state → 全树重渲），不是 vdom 本身；P0b-1 外置状态 + 各自订阅后重渲面只剩低频控件 | 换框架不解决根因，P0b-1 在 React 内解决且风险小得多 |
| 互操作成本 | player 被 desktop React 树直接消费（session host portal、Radix 菜单、Tailwind 类）；Solid 嵌 React 需互操作层 + 双运行时；Web Components 丢 TS props 类型（attribute 序列化） | 成本确定性发生，收益不发生 |
| 工具链 | 全仓 tsc project / oxlint / fmt / check 均按 React+TSX 组织 | 单框架仓纪律（CLAUDE.md 目录结构条） |

P0b-1 已落地；若弹幕/进度仍有帧预算缺口：优先局部手段（弹幕已是 Canvas；进度条
rAF 直写 DOM），仍不换框架。三引擎已改为动态 import（不再进首屏），剩余 P3 只做
矩阵回归与性能预算。

## 阶段与任务

> P0a 已完成（见上）；P0b-1 已完成。下表只留未完成项，状态以 `docs/ops/backlog.md` §B 为准。

### P0b 会话与时间源（剩余；原估算 9-13 人日含已完成部分）

| ID | 任务 | 验收 |
| --- | --- | --- |
| P0b-2 | `PlayableMedia` 拆 `usePlaybackResolution` / `usePlaybackSession` / `PlayerProvider` + 统一 `MediaController` | 播放/暂停/seek/静音/ended/进度契约不变；音频视频共用 |
| P0b-3 | 播放模式状态机 `normal / wide / web / full / mini`（theater 已收编会话 store；剩余统一枚举与互斥） | 模式互斥；Esc 先关浮层（全屏退出是 UA 手势，不承诺拦截）；全屏与小窗不再互相强退 |

### P1 核心交互（约 43-62 人日；已裁剪见文首）

控件栏补齐（时间输入、上一/下一、设置齿轮、字幕、PiP 占位）→ 进度条章节分段与悬停
缩略图 → 设置面板（播放方式/比例/镜像/关灯）→ 弹幕引擎参数化 + 设置/过滤/列表/发送框
→ ~~CC/AI 字幕~~ · ~~快捷键全集 + 右键菜单 + OSD~~（裁剪；统计信息面板已提前重做）
→ MediaSession → 片尾面板与倒计时 → 续播提示。

### P2 数据型（约 27-40 人日）

`ResolvePlayback` 增加可序列化 sidecar（`playerInfo`：subtitles/preview/pages/related/
online/audioTracks/encoding）；分 P 走「`resolvePlay` 可选 page + 续播键带 page」（不改 XML
契约）；清晰度复合档位 / ABR（需先解决隧道带宽估算）/ VIP 标记；高能进度条；在线人数。
写操作（弹幕发送、进度上报）单开 RPC，凭证只在服务进程。

### P3/P4

PiP、截图、音效、历史弹幕、webmask（可选）；四引擎 × 平台 × 模式矩阵回归、性能预算
（弹幕+字幕+预览同开）；引擎已动态 import，不再计入首屏体积。

## 每个阶段结束都要做

`bun run check`（含 `--layer service`）+ `bun scripts/ui-play-check.ts`（真播）+ 全屏/小窗/
路由切换手测；纯函数（档位键、时间输入、弹幕过滤、prefs 迁移）加 `.check.ts` 并登记。
