# 侧栏订阅树:Radix Accordion + 方向键导航

## 为什么做

`apps/desktop/src/components/Rail.tsx` 的分组树原本是手写的:展开态放 zustand 的
`openGroups`,caret 与标题是两个独立按钮,箭头旋转靠手动把 `data-open` 透传给
`<Icon>`,`aria-label` 还要写 `open ? "折叠分组" : "展开分组"` 的三元。而且**没有任何
行间键盘导航** —— 穿过侧栏只能一次次按 Tab。

改后:展开语义交给 Radix(`aria-expanded` / `data-state` / 折叠时 `hidden` 并卸载内容),
方向键成为行间导航。

## 选型:为什么是 Accordion,不是树组件

问过「能不能用现成的树组件(antd Tree 或类似的轻量件)」,量过体积后否掉了:

| 候选 | JS 产物 | 依赖 | 结论 |
| --- | --- | --- | --- |
| `@radix-ui/react-accordion` | **12.6KB** | 全是 radix 内部包,已随现有 dialog/select 装上 | ✅ 采用 |
| `@headless-tree/react` + `core` | 102KB | 0 | 零依赖、能力最强,但要引入 dataLoader 抽象 |
| `react-accessible-treeview` | 29KB | 0 | 自带选中/展开语义,要绕 |
| `rc-tree`(antd Tree 底层) | 359KB | 5 | 与 antd 绑得紧 |
| `react-arborist` | 447KB | 3 + 强制 peer `react-dnd` | 主打拖拽+虚拟化,都不需要 |
| `react-aria-components` | 6.9MB | 8 | 过量 |
| `@mui/x-tree-view` | 1MB | 6 | 自带 MUI 主题系统,与 oklch 令牌打架 |

**决定性的一条:所有树组件都把「选中」和「展开」当正交 action**(headless-tree 的
`selectionFeature`、react-accessible-treeview 的 `onSelect`/`onExpand` 都是分开的),
而本仓的交互是「点行**只跳转**、caret 才展开」。要用树组件就得靠「自定义点击行为」
的逃生舱去绕,绕完拿到一个几百 KB 的状态机,而 DOM 与样式仍是自己写 —— 净收益为零。

Accordion 的语义正好对上:纯展开/折叠,不假装管选中,`Trigger asChild` 到 caret 即可。

## 落地要点

- **`Trigger` 只套 caret 按钮**,绝不铺到整行或标题 —— 标题也是 `<button>`(不能嵌套),
  而「点行只跳转」靠的就是整行里只有 caret 一个能 toggle 的东西。
- **`openGroups` 不改成 `string[]`**:它缺省语义是「未记录 = 展开」,数组表达不了。
  受控 `value` 由 `groupIds.filter(id => openGroups[id] ?? true)` 派生,`onValueChange`
  里 diff 出**变化的那一个**再调现有的 `toggleGroup`(幂等)—— store 一行没动。
- **不做 roving tabindex**:这一段只有十几行,把行按钮移出 Tab 序之后,键盘用户就只能
  靠方向键走到行尾的「更多」菜单,是**退化**。方向键是叠加的增强,Tab 序原样保留。
- **按键策略抽成纯函数** `apps/desktop/src/lib/rail-nav.ts`(无 React/DOM),
  配 `rail-nav.check.ts` 断言。DOM 查找与 `focus()` 留在组件里,由 CDP 覆盖。

## 踩到的三个坑(都已修)

1. **`defaultPrevented` 是唯一正确的协作机制** ——
   `lib/shortcuts.ts:52` 在 window 上吃裸 ↑↓/j/k 切文章,靠 `defaultPrevented` 让内层先处理。
   Radix Accordion 内部也挂了同款方向键(只在它的 Trigger 之间循环),
   `composeEventHandlers` 是「先外部 handler、再查 `defaultPrevented`」——
   所以在 `Accordion.Root` 的 `onKeyDown` 上消费并 `preventDefault()`,radix 那套自动跳过,
   不会两套同时动焦点。**没消费就绝不 preventDefault**,否则会吃掉全局快捷键。

2. **`←` 回父行的 DOM 结构有两条路** —— 真分组的成员在
   `Item > Header + Content(.group-children)` 里,`.group-children` 的
   `previousElementSibling` 是 **null**(它在 Content 里是独子),必须向上 `closest('[data-row]')`;
   而未分组的成员在 `.group-head-plain[data-row] + .group-children` 里,标题是**兄弟**。
   只按兄弟找 → 真分组成员上按 ← 原地不动(实测复现过)。

3. **`.group-block` 的兄弟选择器会静默失效** —— 原来是
   `.group-block + div / div + .group-block` 靠相邻兄弟给分组区留白,`Accordion.Root`
   插进中间后兄弟关系不复存在。改成按**类名**给边距,不依赖 DOM 位置。

## 后续两项改进(用户反馈)

1. **分组行也能是激活态** —— 原来只有 `.nav-row[aria-current="page"]`(背景 + 强调条),
   而分组行的 `aria-current` 挂在 `.nav-row-inner` 上,那条规则**根本匹配不到**
   → 选中分组只有文字变亮,看不出被选中。改成 `.group-head[data-active="true"]`
   (与 `.sub-row-wrap[data-active]` 同一套约定)给**整行**上背景 + 自己的 `::before` 强调条。
   窄栏(64px / ≤1080px)下退回透明 + 隐藏强调条 —— 只剩图标时整行铺色会变成一块色板。
2. **名字强制单行** —— `.nav-label` 有 `flex: 1; min-width: 0` 但**没有截断**,长订阅名
   (`YouTube · 3Blue1Brown` 这种)会换行把行高从 32px 撑到两倍。加
   `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`。
   实测:塞一个 380px 宽的名字,`clientWidth 147` → 画出省略号、**行高恒 32px**。
   附带好处:窄栏把标签挤到几像素时,`nowrap` 让它退化成「…」而不是**逐字竖排**。

## 验证(实测结果)

- `./node_modules/.bin/tsc -p apps/desktop` → 0 错
- `bun apps/desktop/src/lib/rail-nav.check.ts` → 全过(含「Enter/Space/j/k 一律不被本层接管」的契约断言)
- CDP 逐项:焦点在树行时 ↑↓ **只**在行间移动且 `location.pathname` / `selectedArticleId` 不变;
  焦点移出树后再按 ↑↓ **仍**能切文章(反证:不是把全局键关掉了)
- `→` 折叠态只展开、展开态进首个成员;`←` 回父行且父行保持展开
- caret 点击 → `aria-expanded` 翻转且**不**跳转;点标题 → 跳转且展开态不变
- 折叠栏(64px)与窄窗(1024px)下方向键均可用
- `ui-probe` `issueCount 0`;`ui-console` 无 React / hook 告警
- `ui-design-audit`:`contrastIssues 0`、`smallTargets` **6 → 1**(比改前更好)
- 分组激活态:整行 `bg` 实测 = `--surface-3`、强调条 3px、`.nav-row-inner` 字重 560;切走后全部复原
- 长名字截断:塞 380px 名字 → 省略号 + 行高仍 32px;全侧栏 `.nav-label` 无一行换行

## 明确不做

ARIA tree 语义(`role=tree`/`aria-level`)· typeahead · 拖拽重排 · 多选 · 虚拟化 ·
roving tabindex · 未分组区折叠 · 把整个侧栏做成一棵树 · `openGroups` 迁 `string[]` ·
`j`/`k` 在树内让位
