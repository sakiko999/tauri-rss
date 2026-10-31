# 设计系统落地计划（2026-11-01 起）

> 前提：用户在「组件 / 样式 / UI 设计打扎实」之前不堆新功能。本计划只做结构与收敛，
> 不新增用户可见功能；播放器复刻排在其后（`docs/playback/player-parity-plan.md`）。
> 每步做完停一次：`bun run check` + 对应实机巡检，再进入下一步。

**进度（2026-11-01）**：F1 完成（`radix-ui@1.8.1` 子路径 + 边界守卫 + 封装层，白名单清零）；
F2 完成 AlertDialog / `confirmAction`（7 处 `window.confirm` 全部替换）。其余原语**在有第一个
真实调用方时再加**，不预先造空壳：Slider/Tooltip/ContextMenu/Popover 随播放器 P0a 落地，
ToggleGroup/Tabs 随分段控件收编（F5）落地。
**F3–F5 的排期与完成状态见 `docs/ops/backlog.md` §B。**

## 结论（为什么不用现成组件库）

- 不接 Mantine / Radix Themes 这类**带样式**的组件库：它们的视觉语言与现有 `@theme`
  令牌、密度/动效档位是两套体系，接进来等于放弃现有外观并重做主题（见「Radix Themes」一节）。
- 不复制 shadcn registry：尺寸令牌、`@/` 别名、`tw-animate-css`、`shadcn init` 改写全局
  CSS 都已实测不适配；只参考其 API 形状。
- **行为层统一用 Radix Primitives**，样式仍归本仓：`@theme` 令牌 + 语义类 + `cn`。

## Radix 依赖形态

- 用聚合包 `radix-ui`（精确版本，当前 1.8.1），业务代码只经**子路径**导入
  （`radix-ui/dialog`）；子路径文件只是 re-export，运行时依赖图与独立包一致，且能
  tree-shake。desktop 与 player 声明同一版本，消除现有的 `^2.1.25` / `^2.1.6` 漂移。
- **不用**：ScrollArea（会顶掉 WebView2 fluentOverlay 滚动条）、Toast（现有 Toaster 已对齐
  三档动效）、Form、Progress、Menubar、NavigationMenu、Direction、AccessibleIcon。
- 硬约束：播放器全屏时浮层必须挂进**播放器容器**（默认 Portal 到 body 会看不见）；
  退场动画绑 `data-state=closed` 且只降 `--dur-*`，不能 `animation:none`；`ToggleGroup`
  单选会去掉 `aria-pressed`，受影响 CSS 改 `[data-state=on]`。

## 任务

| ID | 任务 | 范围 | 验收 |
| --- | --- | --- | --- |
| F1 | 依赖与边界 | desktop/player 声明 `radix-ui@1.8.1`；新建 `apps/desktop/src/components/ui/`、`packages/player/src/ui/`；`.oxlintrc.json` 的 `no-restricted-imports` + `check` 脚本（`scripts/radix-boundary.check.ts`，contract 层）；迁移现有 4 个文件（Modal.tsx 拆为 ui/Dialog·Menu·Select·Switch，RailGroupTree 的 Accordion，播放器两个菜单） | `bun run check` 全绿；`bun run lint` 0 error；添加订阅/编辑订阅/侧栏分组/播放器倍速清晰度逐一手测 |
| F2 | 基础原语 | AlertDialog（+ `useConfirm()` 异步替换 7 处 `window.confirm`）、ContextMenu、Popover、Tooltip、Slider、ToggleGroup、Tabs（只用于真有面板处）；每个原语带语义类与 data-motion 退场 | 取消危险操作无副作用；全屏播放器菜单可见；键盘/焦点/Esc 正常 |
| F3 | 重复模式收敛 | 先做高频三类：`ListRow`（12 套行）、`Badge`（约 9 套）、`Progress`（约 8 套）；随后 Skeleton/Avatar/SectionHeader/CardShell | 视觉无回归（截图基线）；CSS 行数下降；新增行样式只改一处 |
| F4 | 守卫与验收工具 | 扩充 `css-classes.check`（Radix 边界、`@theme` 令牌已覆盖）；`scripts/ui-probe` 增加「全屏浮层可见」「模式切换」探针；可选 dev 陈列页（`/dev/ui`，仅 DEV 构建） | 探针能抓到全屏浮层逃逸；ci/本地同一入口 |
| F5 | 文案与语义修正 | 分段控件 tablist/aria-pressed 混用；播放器 chrome 的 `title` → Tooltip（虚拟列表仍用 title）；确认弹窗迁移后的文案 | 读屏语义正确；无重复说明文案 |

顺序：F1 → F2 → F3 → F4 → F5。F1/F2 是播放器 P0 的前置。

## Radix Themes 对照（为什么不用 `@radix-ui/themes`）

- 它是**带样式的成品组件库**（v3.3.0，包内 4.9MB、1500+ 文件），自带 `.rt-*` 类名、
  自己的颜色/字阶/圆角体系，需要引入全局 `styles.css` 并用 `<Theme>` 包根。
- 与现有 `@theme` 单轨令牌、`data-theme`/`data-density`/`data-motion` 是两套主题系统；
  共存只能靠 `@layer` 先后与 `!important` 覆盖，等于维护两套主题。
- 它依赖 `radix-ui@^1.1.3`（比我们的 1.8.1 旧），会引入第二个 Radix 副本。
- 官方也说明：需要大量 `className`/`style` 覆盖时说明「不适合」。
- 需要保留自定义视觉、只借行为时，正确选择是 **Primitives**（本计划），不是 Themes。
