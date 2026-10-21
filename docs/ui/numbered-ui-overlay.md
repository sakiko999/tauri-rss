# Numbered UI Overlay（可交互元素编号覆盖层）

> 状态：**已实现**（2026-10-18，dev-only）。入口 `apps/desktop/src/dev/ui-overlay/`，
> 由 `main.tsx` 的 DEV 分支动态 import；生产构建不包含任何代码/样式。
> 目标：人工反馈「点 12 号」+ AI 辅助调试（复制结构化元素清单）。
>
> 标记对象分两类：**组件显式声明的区块**（`data-ui-overlay-block`）+ 自动扫描的
> 可交互控件。区块标签为绿色软底，**整个区块另有绿色描边边界框**；控件标签为琥珀色。
> 工具栏可切「仅区块」。

## 一、两个关键语义（先答最常见的疑问）

### 1. `400` 是**同屏标签数**上限，不是编号上限

- 候选 = **显式声明的区块** + **当前挂载且在视口内**的可交互控件。虚拟列表
  （Virtuoso / masonic）滚出视口的条目根本不在 DOM 里，不会占用编号。
- 超过 400 个候选时：全部候选仍按视觉顺序分配编号，但**只渲染 400 个标签**；
  **区块优先保留**，再用控件补足 —— 否则一屏控件很多时，重要的结构区块会被挤掉。
  工具栏显示 `400 +N`，`__uiOverlay.json()` 的 `count` / `blocks` / `overflow` 会说明。
- **已显示的编号不会因为新元素出现而重排**；400 之外的编号只是暂时没有标签。
- 编号空间可以超过 400（例如滚动一个长 feed 后看到 543 号），这是稳定性的代价，
  不是 bug。工具栏显示的是「当前可见数」，不是最大编号。

### 2. 同一元素/条目的编号在本路由会话内固定

- 稳定键优先级：
  1. `data-ui-overlay-key`（显式逃生口；区块用 `overlayBlock(kind, key)` 传）
  2. `data-row` / `data-item` / `data-id` / `data-key` 等业务 data 契约
  3. **React fiber 上的业务对象 id**：`item.subscriptionId:id`、`sub.id`、`group.id` 等
  4. 唯一 `id`
  5. **区块身份**：`data-ui-overlay-block` + 标题（列表型）或结构指纹（容器型）
  6. 列表项（卡片/列表行/队列行/短视频）的标题文本
  7. 结构回退：祖先 landmark + tag/稳定 class/同级序号（不含会变的 aria-label）
- 条目根节点只用 `业务 id + 区域`，**不含同级序号** —— 虚拟列表滚动、DOM 节点
  重建后滚回来仍是同一个 n。条目内的按钮用相对结构指纹区分。
- 隐藏/显示覆盖层**不重置**编号；路由变化（pathname + search）会重置（不同页面的
  「12 号」才有意义）；`__uiOverlay.reset()` 可手动重置。
- 编号可能不连续（1、2、4、7…）：因为编号一旦分配就不回收给其它 key。JSON 里按
  视觉顺序排列，附带 `n`；`list()` 额外带 `key` 和 `stable`。
- 结构回退（`stable: false`）在 DOM 结构变化时可能换号；有业务 id / fiber item 的
  元素不受影响。信息卡会标出「结构回退」。

## 二、使用方式

```bash
bun run tauri          # 启动桌面 dev 实例
# Ctrl+Shift+U 开关覆盖层
```

- 工具栏（右上，标题栏下方）：当前数量、`+N` 溢出、复制清单、复制 JSON、
  **仅区块**、重置编号、关闭、额外选择器输入。
- 标签颜色：**绿色软底 = 组件声明的区块**，**琥珀色 = 可交互控件**。
- 区块边界：每个区块有一个**绿色描边框**（1px 实线 + 1px 软光晕）包住整个区域，
  随滚动/动画实时重定位；只做视觉提示，`pointer-events:none`，不挡目标点击。
- 悬停编号 → 高亮目标；点击编号 → 信息卡（名称 / 类型 / role / id/class / 选择器 /
  位置 / 组件名 / 编号是否稳定 / 稳定键），可复制单条信息、单条 JSON、打印 DOM、滚动定位。
- 默认只观察，不拦截目标元素的真实点击；编号放在目标外侧/角落。

### 区块主动声明（推荐）

组件在「重要区块」的根元素上展开 `overlayBlock()`：

```tsx
import { overlayBlock } from "../../lib/uiOverlay.ts"

<section {...overlayBlock("settings-card", "setting:playback")}>
<article {...overlayBlock("reader-body")}>
```

- `kind` = 区块类型（短标签，进 JSON 的 `blockName`）。
- `key` = 可选稳定键；**重复区块**（卡片/列表项）建议传业务 id，单例可省略。
  标题含动态计数时（如 `播放队列 3`）用 `SideCard` 的 `blockKey` 传固定键。
- 只在 DEV 输出属性；生产环境 `overlayBlock()` 返回 `{}`，DOM 不带 `data-*`。
- 首批已声明：app 外壳（titlebar / rail / main）、阅读三栏、媒体网格/直播轨、
  卡片/列表行、热搜、设置卡、发现页面板、播放页、短视频、Modal、命令面板、
  Toast、空态。
- 控件仍会自动扫描；只想看区块时点工具栏「仅区块」。

公共 API（仅 DEV 存在）：

```ts
window.__uiOverlay = {
  show(), hide(), toggle(), isOn(),
  list(): PublicEntry[],          // 当前视口元素（不显示标签也能取）
  json(pretty?: boolean): string, // 结构化 JSON 字符串
  copy(mode?: "json" | "text"): Promise<void>,
  reveal(n): void,                // 滚动到元素并闪一下，不点击
  setExtraSelector(sel: string): void,
  setHotkey(spec: string): void,  // 如 "Ctrl+Alt+U"
  setBlocksOnly(on: boolean): void, // 只显示区块标签
  reset(): void,
  stats(): OverlayStats,
}
```

AI 用法（`ui-probe` 会原样打印字符串）：

```bash
bun scripts/ui-probe.ts eval "__uiOverlay.json()"
bun scripts/ui-probe.ts eval "__uiOverlay.stats()"
bun scripts/ui-probe.ts eval "__uiOverlay.list().length"
```

JSON 形态（字段精简，**不包含任何输入值**）：

```json
{"url":"/v/tab%3Aall","viewport":[1440,900],"count":42,"blocks":8,"mode":"all","overflow":0,"items":[
  {"n":3,"block":true,"blockName":"grid-head","tag":"div","role":null,"name":"全部 240 条",
   "sel":".grid-head","rect":[267,52,900,28],"stable":true},
  {"n":12,"tag":"button","role":null,"name":"刷新全部","id":"","cls":"icon-btn",
   "sel":"button.icon-btn[aria-label=\"刷新全部\"]","rect":[1234,8,34,34],
   "comp":"TitleBar","stable":true}
]}
```

`block: true` / `blockName` 只在显式声明的区块上出现；控件不带。`stable: false`
只在结构回退时出现；`comp` 是 React dev fiber 的组件名（尽力而为）。

## 三、实现结构

```
apps/desktop/src/dev/ui-overlay/
  index.ts     安装/卸载、快捷键、观察器、window.__uiOverlay
  scan.ts      候选选择器（控件 + 区块）、可见性/遮挡、React onClick 兜底
  key.ts       稳定键（fiber 业务 id / data-* / 区块 / 标题 / 结构回退）+ 名称/选择器
  registry.ts  编号分配（纯逻辑）：同 key 固定、reset
  labels.ts    标签选择（纯逻辑）：仅区块 / 区块优先 / 400 上限
  layout.ts    标签定位/碰撞/clamp（纯逻辑）
  format.ts    文本清单 / 精简 JSON（纯逻辑）
  clipboard.ts Clipboard API + textarea 回退
  render.ts    根节点/标签/区块边界框/高亮/信息卡/工具栏/注入 CSS
  overlay.check.ts 纯逻辑自检
apps/desktop/src/lib/uiOverlay.ts  overlayBlock() 区块声明 helper（DEV 才输出属性）
apps/desktop/src/main.tsx          DEV 分支动态 import
```

候选来源：

- **显式声明的区块**：`[data-ui-overlay-block]`（由 `overlayBlock()` 写入）。
- 原生 `button/a/input/textarea/select/summary`、ARIA role、`tabindex>=0`、`contenteditable`
- React `__reactProps$` 上的 `onClick/onPointerDown/onMouseDown/onTouchStart/onKeyDown`
  兜底（如 `Cards.tsx` 的 card-play 内层 span：只有 role="presentation" + inline style）
- 自定义选择器（工具栏）

过滤：overlay 自身 / `data-ui-overlay-ignore` / `inert` / 祖先
`display:none|visibility:hidden|opacity:0` / 视口外 / 被遮罩或无关元素盖住
（`elementsFromPoint`，自动跳过自己的标签）。`disabled` / `pointer-events:none`
只排除控件，不排除区块（区块本身可以不可交互）。

## 四、刷新与边界

- 根节点挂 `document.body`，`position:fixed; z-index:2147483000`（高于启动骨架 999 /
  toast 60）；**不复用 `#overlay-root`**（其 z-index 50 的 stacking context 会限制）。
- 标签 `position:fixed` + `translate3d`，只改 overlay，不给目标元素加 class/outline。
- 刷新：scroll(capture) / resize / MutationObserver(120ms) / ResizeObserver /
  pointerover(180ms) / focusin / fullscreenchange；开着时约 12fps 重定位
  （覆盖 modal 入场动画、View Transition 等不触发 scroll 的场景）。
- Fullscreen API：`fullscreenchange` 时把根节点临时挂进 `document.fullscreenElement`
  （播放器全屏仍可见）。
- 边界：Shadow DOM / iframe / canvas 不自动识别（当前应用没有 iframe；弹幕 canvas
  非交互）；虚拟列表只编号已挂载项；`reveal` 只能定位当前 DOM 里的元素。

## 五、生产隔离

- `main.tsx` 的 `if (import.meta.env.DEV)` 在 build 时静态替换，动态 chunk 不产出。
- 样式由 dev 模块运行时注入 `<style>`，不进 `src/styles/`。
- `overlayBlock()` 在非 DEV 下返回 `{}` → 生产 DOM 不出现 `data-ui-overlay-block`。
- 已验证 `dist/desktop` 中 `__uiOverlay` / `ui-dev-overlay` / `uio-label` /
  `data-ui-overlay-block` / `overlayBlock` **0 命中**。
- `scripts/ui-probe.ts` / `ui-design-audit.ts` 已跳过 `[data-dev-overlay]`，审计不会被
  标签干扰。

## 六、自检与实测

```bash
bun apps/desktop/src/dev/ui-overlay/overlay.check.ts   # 快捷键/编号/定位/标签选择断言
./node_modules/.bin/tsc -p apps/desktop --noEmit
bun run build:desktop
```

2026-10-18 用临时 React harness（已删除）实测：

| 场景 | 结果 |
| --- | --- |
| 初始页面 | 43 个候选 / 43 个标签 |
| 30 张卡片 + 虚拟行全量 DOM 重建 | 43 个 key 的编号 **0 变化** |
| 隐藏 → 显示 | 编号 **0 变化**，根节点仍只有 1 个 |
| 虚拟列表滚到 800px 再滚回 | 原来条目的编号全部复用（6/9/13…） |
| 500 个可见小按钮 | `candidates=501`、`labels=400`、`overflow=101`、标签编号唯一 |
| 真实点击（overlay 开启） | 目标点击正常触发，无信息卡误弹 |
| Ctrl+Shift+U 合成事件 | 关 → 开，单根节点 |
| 信息卡 / Esc | 打开字段完整；Esc 只关闭信息卡 |
| JSON | 合法、按视觉顺序、无 `value` 字段 |

2026-10-18 区块 harness（临时文件已删除）：

| 场景 | 结果 |
| --- | --- |
| 6 个显式区块（其中 1 个在视口外）+ 3 个按钮 | `candidates=8`、`blocks=5`、`labels=8`；视口外区块正确排除 |
| 「仅区块」模式 | `labels=5`、`blockLabels=5`，控件标签全部隐藏 |
| React root 全量重挂载 | 区块编号 `1,2,3,5,7` **0 变化**（靠 `data-ui-overlay-key`） |
| 标签样式 | 区块 18px 绿色软底、控件 16px 琥珀色 |
| 区块边界框 | 5 个可见区块各 1 个框；`box rect` 与目标 `getBoundingClientRect()` 逐像素一致 |
| 仅区块模式 | 5 个标签 + 5 个边界框，控件无框 |
| 信息卡 | `#1` 显示「类型：区块 (harness-header)」，控件显示「可交互控件」 |
| JSON | 顶层含 `blocks=5` / `mode`，条目含 `block:true` / `blockName` |

## 七、已知上限与后续

- 编号跨路由会重置；如需跨页面固定，需要把业务 id 提升为全局 key（当前不做）。
- 纯结构回退的元素在 DOM 顺序变化时可能换号（`stable: false` 已标出）。
- React fiber 是 dev-only 内部字段；读取失败会自动回退到 data-*/标题/结构键。
- 400 之外的可见元素有编号但无标签，滚动/过滤后可显示；如需更高上限，改
  `index.ts` 的 `MAX_LABELS`（注意 400 是性能护栏）。超限时**区块优先**。
- 区块覆盖范围 = 组件实际声明过的根元素。新组件要出现在清单里，加一行
  `{...overlayBlock("kind", "key")}`；未声明的容器不会自动成为区块（控件仍自动扫描）。
- 未做「点击编号直接触发目标」的主动模式（默认只观察/定位）。
