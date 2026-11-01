# 播放器：B 站网页端对齐计划（P0 起）

> 目标：UI 与交互对齐 B 站网页端播放器（点播为主），**排除**高级弹幕（mode 7/8/9、BAS、
> 代码弹幕）、互动视频、社交与弹幕写操作。工程量与依据见 2026-11-01 调研
> （全量约 130-190 人日；仅「像 B 站」的点播闭环约 72-102 人日）。
> 前置：`docs/ui/design-system-plan.md` 的 F1/F2（浮层原语与边界）。
> 各阶段完成状态见 `docs/ops/backlog.md` §B（本文只保留任务拆解与验收口径）。
>
> **范围裁剪（2026-11-01 定）**：P1 的「CC/AI 字幕」「快捷键全集 + 右键菜单体系」
> 暂不做（右键菜单体系内的**统计信息面板**已提前重做，见下方已落地）。

## 现状（2026-11-01，feat/player-parity 分支后）

已具备：四引擎分发（mp4/HLS/FLV/DASH）、播放/拖拽/缓冲/悬停时间、音量/静音、倍速、
按 resolve 多流切清晰度、全屏、剧场、视频小窗 + 音频迷你条、跨路由不打断、续播、队列
自动下一条、Canvas 弹幕（mode 1-5）、B 站章节、统计信息；直播/点播模式显式分流
（`mode` prop，宿主按条目 kind 给，不等媒体元数据）。

结构性阻碍（剩余）：`PlayableMedia` 8 个 early-return 分支（P0b-2 拆会话/解析/控制器）；
Audio/Video 两套不对称会话；`player/ui` 原语与 token 仅首批（PlayOverlay/
VideoContextMenu/PlayerContainer），设置面板/OSD 等 P1 原语未建。

已解：4Hz 全树重渲（P0b-1，时间进外部 store）；全屏菜单不可见（Radix Portal 进
播放器容器）；播放偏好不持久（P0a-3）；VideoShell 写死控件（P0a-1 插槽）。

## 已落地（feat/player-parity 分支，2026-11-01）

> 视觉口径不靠印象：用干净 Edge 打开真实 B 站播放页（点播 + 直播），抓 computed style
> 与控件几何（`tmp/` 下的探针脚本，2026-11-01）。摘要：控件行 35px、左右 12px、
> 图标命中区 36×22、文字按钮 14px、无分隔线；进度条 4px 恒定、已播 **#00AEEC 蓝**、
> 缓冲白 30%、轨道白 20%、圆角 1.5px;时间 `01:00 / 02:10` 补零；直播已播 `407:26:23`
> 补零 hh:mm:ss、无 LIVE 胶囊；弹幕开关 = 「弹」框 + 开启时**品牌粉对勾**，视频页的
> 发送条在视频下方页面里（不在控件栏）。

- **控件栏对齐**：点播 `左 播放·时间｜右 清晰度(文本)·倍速(恒「倍速」)·音量·弹·宽屏·全屏`；
  直播 `左 播放·音量·已播时长｜右 清晰度·弹·宽屏·全屏`（无倍速/时长）；无分隔线。
- **直播/点播模式分流**：`PlayerControls` `mode: "video" | "live"`（宿主按条目 kind 显式给）。
- **弹幕发送功能删除**（`MediaDanmakuBar` 整行移除）：B 站的发送依赖平台写接口与本项目
  定位不符，放一个不可用输入框只是假象；控件栏保留弹幕开关按钮。
- **theater 收编会话 store**（`useVideoSession.theater`，跨路由/小窗保持）——P0b-3 的一部分。
- **菜单容器化**（P0a-2 的一部分）：Radix 菜单 Portal 进播放器容器，全屏可见（已实机验证）。
- **统计信息重做**（三段式：会话 / 画面 / 音频网络）：引擎档位、流主机、会话时长（从播放
  会话起算）、播放位置、码率/编解码器（dash.js 不上报时从 MPD 摘要兜底）、缓冲健康。
- **`scripts/player-dryrun.ts`**：媒体流稳定性探针（只跑 HTTP 记录，不跑播放器；
  DASH init 段 / HLS 清单+分片 / FLV 直链，TTFB 多轮抖动，`--json` 落盘）。

### P0a/P0b 结构性落地（2026-11-01 同分支追加）

- **P0b-1 媒体状态外置**：`hooks/mediaClock.ts`（外部 store）+ `useMediaTime(clock, selector)`。
  `timeupdate/progress` 只写时钟、不 setState；消费方按**原始值**切片订阅
  （时间文本按秒、进度条 4Hz、live-edge 按差值、弹幕层在订阅回调里推进）。
  VideoShell/PlayerControls 不再随 4Hz 重渲。`VideoPlayState` 只剩冷字段
  （注意：`BufferedRange` 导出已移除，`currentTime/bufferedEnd` 改走 clock）。
- **P0a-3 PlayerPrefs**：`prefs.ts`（localStorage，不进 core schema）——音量/静音/倍速
  跨条目、视频⇄播客保持；只记用户意图（ops 里保存），autoplay 静音降级不写入。
- **P0a-1 插槽 + 组件抽出**：`VideoShell` 增 `slots.{topBar,overlay,controls}`；
  大播放键抽出 `ui/PlayOverlay.tsx`、右键菜单抽出 `ui/VideoContextMenu.tsx`。
- **P0a-2 浮层容器收口**：`ui/PlayerContainer.tsx`（Provider + `usePlayerContainer` +
  非 React 路径的 `getPlayerContainer/setPlayerContainer`）；清晰度/倍速菜单未显式
  传 `container` 时自动挂播放器容器。
- **P0b-3（部分）**：Esc 分层——第一下只关浮层（统计/右键菜单，preventDefault
  防退全屏），第二下才由浏览器退全屏；theater 已在会话 store。
- **P0a-4 WebView2 能力 spike（实测 WebView2 Edg/156，dev 实例内 eval）**：

  | 能力 | 结果 | 结论 |
  | --- | --- | --- |
  | 画中画 PiP | `pictureInPictureEnabled=true`，`requestPictureInPicture` 存在 | P3 可做 |
  | MediaSession | `navigator.mediaSession` + `MediaMetadata` 可用 | 系统媒体键/锁屏信息可做 |
  | 全屏 API | `document.fullscreenEnabled` + 元素 requestFullscreen | 现方案成立 |
  | H.264 / AAC | canPlayType=probably，MSE 支持 | 主路径 |
  | HEVC (hvc1/hev1) | probably，MSE 支持 | 依赖系统 HEVC 扩展；需真机播放矩阵确认 |
  | AV1 | probably，MSE 支持 | 可用；机型解码能力不一 |
  | VP9 | probably | 可用 |

  ⚠️ `canPlayType` 的 "probably" 只代表容器/编解码字符串被识别，**不等于硬件解码**；
  实际可播性以 `ui-play-check` 真播矩阵为准。

## 框架评估：保持 React（2026-11-01）

问：player 包要不要改 Web Components（兼容性）或 SolidJS（性能）？**结论：都不换。**

| 动机 | 事实 | 判断 |
| --- | --- | --- |
| Web Components 换兼容性 | 唯一宿主是桌面 WebView2（Chromium Evergreen）；mobile 已冻结；不存在「多框架宿主复用」场景 | 兼容性无收益——要兼容的环境不存在 |
| Solid 换性能 | 已知瓶颈是**状态架构**（`useVideoElement` 把 4Hz 进度塞 state → 全树重渲），不是 vdom 本身；P0b-1 外置状态 + 各自订阅后重渲面只剩低频控件 | 换框架不解决根因，P0b-1 在 React 内解决且风险小得多 |
| 互操作成本 | player 被 desktop React 树直接消费（session host portal、Radix 菜单、Tailwind 类）；Solid 嵌 React 需互操作层 + 双运行时；Web Components 丢 TS props 类型（attribute 序列化） | 成本确定性发生，收益不发生 |
| 工具链 | 全仓 tsc project / oxlint / fmt / check 均按 React+TSX 组织 | 单框架仓纪律（CLAUDE.md 目录结构条） |

若 P0b-1 落地后弹幕/进度仍有帧预算缺口：优先局部手段（弹幕已是 Canvas；进度条
rAF 直写 DOM），仍不换框架。三引擎懒加载（P3 的 1.55MB 首屏问题）收益远大于框架差。

## 阶段与任务

### P0a 播放器地基（先做，约 6-9 人日）

| ID | 任务 | 验收 |
| --- | --- | --- |
| P0a-1 | `VideoShell` 增加插槽（controls/topBar/overlays），`PlayerControls` 改声明式槽位；大播放键/右键/统计抽成独立组件 | 现有控件与视觉零回归；新增控件只改一处 |
| P0a-2 | `player/ui` 原语 + `getPlayerContainer()`（播放页/小窗/全屏容器）；`PlayerToast` | 全屏下倍速/清晰度/右键菜单与提示可见；host 搬移后仍有效 |
| P0a-3 | `PlayerPrefs`（全局 volume/muted/rate + 按平台 quality；弹幕/字幕样式留 P1） | 换条目不重置音量/倍速；不动 core AppSettings schema |
| P0a-4 | WebView2 能力 spike：画中画、MediaSession/系统媒体键、HEVC/AV1 解码、Fullscreen API 与 Tauri 窗口全屏 | 结论写回本文档；不支持项明确降级，不假装支持 |

### P0b 会话与时间源（约 9-13 人日）

| ID | 任务 | 验收 |
| --- | --- | --- |
| P0b-1 | 媒体状态外置（`useSyncExternalStore` + selector）：进度条/弹幕/波形各自 rAF 订阅，控件树只订阅低频状态 | 播放中控件树不再 4Hz 重渲；弹幕/续播/切档无回归 |
| P0b-2 | `PlayableMedia` 拆 `usePlaybackResolution` / `usePlaybackSession` / `PlayerProvider` + 统一 `MediaController` | 播放/暂停/seek/静音/ended/进度契约不变；音频视频共用 |
| P0b-3 | 播放模式状态机 `normal / wide / web / full / mini`（收编 PlayerPage 的 theater local state） | 模式互斥；Esc 先关浮层再退模式；全屏与小窗不再互相强退 |

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
（弹幕+字幕+预览同开）、三引擎懒加载（dash/hls/flv 目前静态进首屏 ≈1.55MB）。

## 每个阶段结束都要做

`bun run check`（含 `--layer service`）+ `bun scripts/ui-play-check.ts`（真播）+ 全屏/小窗/
路由切换手测；纯函数（档位键、时间输入、弹幕过滤、prefs 迁移）加 `.check.ts` 并登记。
