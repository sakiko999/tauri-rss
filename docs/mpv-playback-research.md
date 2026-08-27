# mpv 外部播放器接入调研(2026-08-27)

> 动机:desktop 的 ExpandPlayer 弹窗播放(Webview + hls/flv/dash.js + 宿主隧道)有
> 两类结构性包袱——① 自动播政策/canplay 时序的历史踩坑(见 CLAUDE.md 播放章节);
> ② 分片必须走 base64 隧道,固定开销让 ABR 失真被迫锁最高档。外部 mpv 天然没有这两个
> 问题:**无 CORS/无隧道(header 直接满足 Referer 校验)、无自动播策略、硬解画质更好**。
> 与 cli-plan 的 `rss play --open` 是同一条链路,CLI 可先行验证。

## 一、方案选型

| 方案 | 说明 | 结论 |
|---|---|---|
| A. spawn-only | `Command spawn mpv <url> <args...>`,UI 不管控播放过程 | ✅ **Phase 1 选定**,一次拉起即为完整价值 |
| B. JSON IPC 增强 | `--input-ipc-server`(Windows named pipe)+ observe_property/loadfile | ✅ Phase 2 增强:播放状态回读、eof 事件联动 UI、秒切档 |
| C. libmpv 嵌入 | Rust libmpv crate 渲染到自有窗口 | ❌ 排除:重、窗口生命周期复杂,与「替代弹窗」诉求相反 |

**定位替换而非并存**:设置 `playbackBackend: "embedded" | "mpv"`;选中 mpv 后点击
卡片不再弹出内嵌窗,直接拉起外部 mpv。未检测到 mpv → 自动降级 embedded 并提示安装。

## 二、流格式 → mpv 参数映射(核心表)

项目 Stream 类型(`xml/types.ts`)字段:url/format/headers/quality/rate/dashManifest。
crawler 保证 streams[0] 为最高档,mpv 取第一条即可。

| format | 来源 | mpv 方案 |
|---|---|---|
| `progressive`(mp4/mp3) | youtube 360p 兜底、音频 | 直接传 url |
| `hls` | bili live / youtube live(hlsManifestUrl) | 直接传 url(ffmpeg hls demuxer 原生) |
| http-flv(实际 format 标记) | douyu/huya/douyin live | 直接传 url(ffmpeg 对 HTTP-FLV 原生 demux) |
| `dash`(+`dashManifest` 字符串) | bili video / youtube video **自拼 MPD** | 写临时 `.mpd` 文件后传路径(见下) |

通用参数:

```
--http-header-fields="Header: value"   # 每 header 一条(Stream.headers 透传)
--referrer=<url>                       # 平台 Referer 校验(bili/youtube upos/googlevideo)
--hwdec=auto-safe                      # 硬解
--title=<订阅标题>                      # 窗口标题
--force-media-title=<同上>
```

### DASH 的临时文件方案(关键技术点)

`dashManifest` 是**内存 MPD 字符串**(webview 里喂 blob 给 dash.js),mpv 无法消费。
但本项目自拼 MPD(`resolve/utils/mpd.ts`)的关键性质使其可落盘:

- profile `isoff-on-demand`,分片为 `<BaseURL>` **绝对 CDN 直链** + SegmentBase Range
  —— 本地 .mpd 文件引用远程分片完全合法
- **每档 MPD 已包含 audio AdaptationSet**(MpdAudioRep 与 video Rep 同一 MPD,
  bili/youtube 双轨齐备)→ 无需 `--audio-file=http://...` 外挂合并
- 单 Representation 天然锁档(与现有锁档策略一致,morphic)

做法:`%TEMP%/rss-mpv.mpd` 固定名覆盖写(spawn 数组参数传路径,免 shell 转义问题),
app 退出时清理。**唯一待实测风险**:ffmpeg dash demuxer 对 SegmentBase Range 的兼容性
——B 站官方 MPD 同构、yt-dlp 管线大量使用此形态,预期通过,M0 spike 首验项。

## 三、架构对接

### appHost.player 门面(新,可选门面第三例)

仿 `ws`/`browser` 模式——可选注入、缺失则调用方降级:

```ts
interface PlayerHost {
  launch(req: {
    kind: "url" | "mpd";            // mpd = dashManifest 落盘托管
    url?: string; manifest?: string;
    headers?: Record<string,string>; referrer?: string; title?: string;
  }): Promise<void>
  // Phase 2: control(cmd) / onEvent(cb)  ← JSON IPC
}
```

- **tauri host**:Rust command `mpv_launch` / `mpv_control`;进程退出事件(event emit)
  回传 UI 更新播放态。Windows spawn 必须 `CREATE_NO_WINDOW` 防 conhost 黑窗。
- **CLI host**:Bun.spawn(windowsHide) 同参数链路直接实现同一接口——CLI 与 desktop
  共享一套 launch 参数组装函数(放 resolve 包或独立 util,两端 import 同一份)。
- node/browser host 不提供(crawler/core 无感;ui 层判 `appHost.player` 存在与否 +
  settings 开关决定分发)。

### mpv 发现与配置

`settings.mpvPath`(用户显式配置优先)→ PATH 查找 → 常见安装目录探测 → 都无则降级。
设置面板加 backend 开关与路径配置(desktop 现有 radix 体系沿用)。

### desktop 数据流改动

MediaList 卡片点击处(store.playback 之前)插一个分流:

```
resolvePlay() ──► playbackBackend === "mpv" && appHost.player
                    ├─ yes → player.launch(streams[0] 映射)  (不弹窗)
                    └─ no  → ExpandPlayer 弹窗(现行为不变)
```

## 四、弹幕与自定义控件:mpv 侧支持深度

### 4.1 弹幕 —— DanmakuStream 的第三个渲染器

`DanmakuStream = (onItems)=>()=>void` 是平台无关的纯数据流,对接 mpv 只是消费端
多一种 renderer,协议层零改动:

| 渲染器 | 场景 | 形态 | 成本 |
|---|---|---|---|
| DOM Layer(现状) | desktop 弹窗 | CSS transition | 已有 |
| 终端打印 | CLI `rss dm` | console | 零成本 |
| ASS 字幕轨 | mpv **VOD** | bili protobuf 解析已有 → 转 .ass → `--sub-files`;轨道防重叠借现成算法(danmaku2ass 类),libass 渲染质量高于 DOM | **低** —— 本期可带 |
| **TS over JSON IPC** | mpv **直播** | DanmakuStream 订阅 → IPC `osd-overlay`(format="ass",libass 渲染,mpv ≥ 0.36)add/update/remove 动态增删移动;轨道防重叠算法写在 TS 侧,**零内嵌脚本、纯 TypeScript** | **中** —— 全程 TS |

mpv 扩展路径备忘(为什么不用内嵌脚本):内置 **Lua**(一等)+ **JS/Duktape** 两套脚本
引擎(API 基本镜像,但 Duktape = ES5.1+部分 ES6,无 async/npm/node 标准库);对控制类
需求**JSON IPC 就是任意语言的完整通道**(command / observe_property 事件推送 /
osd-overlay),内嵌脚本仅用于捡现成社区件(thumbfast/uosc 均为 lua,放 app 专属
config-dir scripts 即用)。直播弹幕经 IPC 的往返延迟 ms 级,30fps 推送毫无压力。

⚠️ mpv 直播弹幕是这条路径唯一劣于 Webview 的点(Webview 直播弹幕现成)。
播放器快捷键/倍速同理留在 mpv 内。

### 4.2 控件 —— 三层能力与集成策略

1. **原生强于现有 MediaChrome**:OSC 悬停控制栏、`input.conf` 完整键位体系、
   `uosc` 社区皮肤(现代控制栏 + 章节/音轨菜单)、`thumbfast` 进度条缩略图预览
2. **亮眼集成点**:crawler `streams[]` → uosc 下拉档位菜单,点击 IPC `loadfile`
   **无缝切档且保持进度**(Webview 方案做不到这么干净)
3. **app 内接管(明确不做)**:MediaChrome 控件虽可写第二 adapter
   (`useVideoElement`→`useMpvIpc`)驱动 mpv 属性,但 mpv 窗口聚焦时 app 键盘本就
   无效——不做一套永远输给专业播放器的二等 UI。**分工:app 管「启动前选档 +
   列表联动」,播放中操作全归 mpv**

诚实边界:不能嵌入 app 弹窗(libmpv 已排除),系统级独立窗口,与 app 的视觉
连续性弱于 Webview。

### 4.3 配置隔离纪律(重要)

一律 `--config-dir=<appData>/mpv-config/` 启动:自带 mpv.conf/input.conf(+将来 lua),
**零污染用户已有 mpv 全局配置**;也保证集成体验不随用户个性配置漂移。spawn-only
阶段就要带此参数(锁死基线行为),M1 交付内含一份精选默认配置。

### 4.4 画质增强:GLSL 滤镜(顺手可得)与插帧(透传)

**GLSL hook 滤镜 —— 参数级工作量**:

- `--glsl-shaders-append=<file>` 每 shader 一条;社区现成品直接用(Anime4K 动漫
  超分/FSRCNNX 实拍超分/SSIM downscaler/KrigBilateral 等,单文件数百 KB)
- 运行时热切换:`no-osd change-list glsl-shaders set "..."`(M2 IPC 上做快捷菜单)
- app 分发 .glsl 进自有 config-dir,与隔离纪律契合;低配 GPU 重 shader 会卡,
  设置 UI 按档位(Anime4K 轻/中/重 mode)给性能提示

**插帧 —— 两条真实路线,均为透传不自研**:

- ⚠️ `--interpolation` 不是补帧(仅 display-sync 呈现时序平滑,输出帧数不变),
  一行参数可开,勿当卖点
- 传统:SVP4(付费)/免费手配 **VapourSynth + MVTools2**(MVFlowFPS);要求 mpv
  构建带 vapoursynth(shinchiro Windows 构建默认带)+ 系统运行时;CPU 占用高
- AI:**RIFE via vs-mlrt**(ONNX/TensorRT/NCNN-Vulkan),同上依赖 + GPU 推理;
  画质天花板,动漫尤其好
- 共同姿势:**检测到本地环境才暴露开关**(底层即拼 `--vf=vapoursynth...`),
  不打包分发 license/运行时

对应 settings 字段:M2 设置面板一并做 —— `mpvFilters.glslShaders: string[]`
(UI 化滤镜开关) + **`mpvExtraArgs: string[]` 逃生舱**(任意高级参数,VF 链/
GLSL/一切长尾能力的兜底,避免为每种玩法建 UI)。

## 五、风险与 M0 spike 清单

| # | 待验证 | 方法 |
|---|---|---|
| 1 | **ffmpeg dash demuxer 吃自拼 SegmentBase MPD**(DASH 方案的成败项) | 手工:crawler 导出一份 bili MPD 落盘 → `mpv xx.mpd --referrer=https://www.bilibili.com` 实测 |
| 2 | 四平台直播 + youtube live 直链直连可行性(headers/referrer 组合) | CLI `rss item` 拿真实 stream → 拼 mpv 命令行逐平台跑 |
| 3 | douyin flv 短时效地址:拉起即播没问题;长时间暂停后 token 过期表现 | 人工观察;若坏,IPC 阶段做 reloadfile 重解析 |
| 4 | HEVC/HDR 源(bili 部分 UP 主)webview 播不了、mpv 解得动 → 正向收益验证 | 抽一个已知 HEVC 视频试播 |
| 5 | Windows spawn 黑窗 / 进程孤儿(app 关了 mpv 还活着) | CREATE_NO_WINDOW + Tauri 退出钩子 kill;验证 |
| 6 | VOD 弹幕转 ASS 试产(转档 → `--sub-files` 实播观感/轨道防重叠效果) | 取已解析 bili 弹幕样本手动转 ass 试播 |
| 7 | `--config-dir` 隔离生效(input.conf 键位基线不受用户全局配置干扰) | 自建空 config 目录跑,对照用户已装 mpv 环境 |
| 8 | **`osd-overlay`(format=ass)经 IPC 注入/移动/移除**(直播弹幕纯 TS 方案的成败项;要求 mpv ≥ 0.36) | 小脚本连 named pipe 发 JSON 命令实测动态 overlay |
| 9 | GLSL hook 滤镜加载(Anime4K mode 试播动画源;确认 `vo=gpu-next` 后端兼容) | drop shader 进 config-dir + `--glsl-shaders-append` 实播 |

其余:进程生命周期与 UI 状态同步(依赖 Phase 2 IPC);quality 切换在 spawn-only 阶段
退化为「重新 launch 新档」(接受,或 Phase 2 用 `loadfile` 无缝切)。

## 六、落地顺序

- **M0(CLI 内 spike)**:手工/半自动验证 §五 全部 7 项 —— 决定 DASH 与弹幕方案去留,
  ~小时级
- **M1**:appHost.player 门面 + tauri `mpv_launch` + settings 开关/fallback +
  desktop 卡片分流(spawn-only);交付内含 app 专属 `--config-dir` 默认
  mpv.conf/input.conf
- **M2**:JSON IPC(named pipe):observe pause/time-pos/eof、`loadfile` 切档(保进度)、
  进度回读驱动 UI;VOD 弹幕 ASS 轨接通(bili 视频);设置面板加
  `mpvFilters.glslShaders`(滤镜开关)+ `mpvExtraArgs`(逃生舱,插帧等透传)
- **M3(可选/远期)**:直播弹幕 TS over IPC(`osd-overlay`,§4.1,零内嵌脚本);
  `streams[]`→uosc 档位菜单;评估捆绑 uosc/thumbfast(固定版本随 app 分发);
  settings 加 mpv 版本探测(osd-overlay 要求 ≥ 0.36)

建议:默认 backend 保持 `embedded`,mpv 作为显式增强开关;M2 IPC 稳定运行一段时间后,
再评估是否翻转默认值。
