# 侧栏订阅树：为什么用 Radix Accordion（选型 + 踩坑）

> 实现早已完成（`apps/desktop/src/components/app/RailGroupTree.tsx` + `lib/rail-nav.ts`）。
> 本文件只留**决策理由与踩过的坑**——修的过程在 git log，不在此复述。

## 一、为什么是 Accordion，不是树组件

问过「能不能用现成的树组件」，量过体积后否掉了：

| 候选 | JS 产物 | 依赖 | 结论 |
| --- | --- | --- | --- |
| `@radix-ui/react-accordion` | **12.6KB** | 全是 radix 内部包，已随现有 dialog/select 装上 | ✅ 采用 |
| `@headless-tree/react` + `core` | 102KB | 0 | 零依赖、能力最强，但要引入 dataLoader 抽象 |
| `react-accessible-treeview` | 29KB | 0 | 自带选中/展开语义，要绕 |
| `rc-tree`（antd Tree 底层） | 359KB | 5 | 与 antd 绑得紧 |
| `react-arborist` | 447KB | 3 + 强制 peer `react-dnd` | 主打拖拽+虚拟化，都不需要 |
| `react-aria-components` | 6.9MB | 8 | 过量 |
| `@mui/x-tree-view` | 1MB | 6 | 自带 MUI 主题系统，与 oklch 令牌打架 |

**决定性的一条：所有树组件都把「选中」和「展开」当正交 action**（headless-tree 的
`selectionFeature`、react-accessible-treeview 的 `onSelect`/`onExpand` 都是分开的），
而本仓的交互是「**点行只跳转、caret 才展开**」。要用树组件就得靠「自定义点击行为」的逃生舱
去绕，绕完拿到一个几百 KB 的状态机，而 DOM 与样式仍是自己写 —— 净收益为零。

Accordion 的语义正好对上：纯展开/折叠，不假装管选中，`Trigger asChild` 到 caret 即可。

## 二、落地要点（约束，改了会坏）

- **`Trigger` 只套 caret 按钮**，绝不铺到整行或标题 —— 标题也是 `<button>`（不能嵌套），
  而「点行只跳转」靠的就是整行里只有 caret 一个能 toggle 的东西。
- **`openGroups` 不改成 `string[]`**：它缺省语义是「未记录 = 展开」，数组表达不了。受控 `value`
  由 `groupIds.filter(id => openGroups[id] ?? true)` 派生，`onValueChange` 里 diff 出**变化的
  那一个**再调现有的 `toggleGroup`（幂等）—— store 一行没动。
- **不做 roving tabindex**：这一段只有十几行，把行按钮移出 Tab 序之后，键盘用户就只能靠方向键
  走到行尾的「更多」菜单，是**退化**。方向键是叠加的增强，Tab 序原样保留。
- **按键策略抽成纯函数** `apps/desktop/src/lib/rail-nav.ts`（无 React/DOM），配
  `rail-nav.check.ts` 断言。DOM 查找与 `focus()` 留在组件里，由 CDP 覆盖。

## 三、三个坑（静默失败，值得记住）

1. **`defaultPrevented` 是唯一正确的协作机制** —— `lib/shortcuts.ts` 在 window 上吃裸 ↑↓/j/k
   切文章，靠 `defaultPrevented` 让内层先处理。Radix Accordion 内部也挂了同款方向键（只在它的
   Trigger 之间循环），`composeEventHandlers` 是「先外部 handler、再查 `defaultPrevented`」——
   所以在 `Accordion.Root` 的 `onKeyDown` 上消费并 `preventDefault()`，radix 那套自动跳过，
   不会两套同时动焦点。**没消费就绝不 preventDefault**，否则会吃掉全局快捷键。

2. **`←` 回父行的 DOM 结构有两条路** —— 真分组的成员在 `Item > Header + Content(.group-children)`
   里，`.group-children` 的 `previousElementSibling` 是 **null**（它在 Content 里是独子），必须
   向上 `closest('[data-row]')`；而未分组的成员在 `.group-head-plain[data-row] + .group-children`
   里，标题是**兄弟**。只按兄弟找 → 真分组成员上按 ← 原地不动。

3. **`.group-block` 的兄弟选择器会静默失效** —— 原来是 `.group-block + div / div + .group-block`
   靠相邻兄弟给分组区留白，`Accordion.Root` 插进中间后兄弟关系不复存在。改成按**类名**给边距，
   不依赖 DOM 位置。

## 四、明确不做

ARIA tree 语义（`role=tree`/`aria-level`）· typeahead · 拖拽重排 · 多选 · 虚拟化 ·
roving tabindex · 未分组区折叠 · 把整个侧栏做成一棵树 · `openGroups` 迁 `string[]` ·
`j`/`k` 在树内让位
