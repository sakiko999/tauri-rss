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

## 又两项(用户截图反馈)

1. **折叠栏图标错开一条竖线** —— 滚动容器的 10px 滚动条吃掉右侧 → 行只有 **38px**,
   而 `.rail-head` / `.rail-foot` 没有滚动条、内容是 **48px** → 图标中心落在 26.9px,
   比侧栏中心(32px)偏左 5px。上方那排工具图标与下面所有导航图标**错开**。
   修:折叠态隐藏滚动容器的滚动条(`scrollbar-width: none` + `::-webkit-scrollbar`
   `display:none`)。隐藏后三处内容盒都是 48px,20 个图标 delta 全在 −0.3px(四舍五入误差)。
   顺带:64px 栏里一根 10px 滚动条吃掉 16% 宽度,平台惯例也不显示(VS Code / Discord 同理)。

2. **骨架屏淡出时侧栏宽度跳变** —— `#boot-skeleton` 的 CSS 在 index.html 里**静态内联**,
   看不到 `styles.css` 的 `@media (max-width:1080px) { --rail: 64px }`,所以窄窗下骨架
   是 268px 而真实侧栏 64px(实测视口 1000px 时差 **204px**)。修:给 `.bs-rail` 补上
   同一个断点,**两处宽度与断点值必须同步**。实测 1440/1100/1081/1080/1000/820 六档全对齐
   (含 1080 这个边界)。

## 再三处(用户截图反馈)

1. **App 骨架(`.boot-overlay`)没让开侧栏,且卡片是透明的** —— 两个 bug 叠在一起:
   - `left: 0; right: 0` 让它横跨**整窗**。静态骨架的 `.bs-grid` 在 x=268(已让开侧栏),
     而 overlay 的在同一时刻落在 x=0 / 宽 1152(整窗)→ 交接那几帧几何不一致。
     改成 `left: var(--rail)`(`--rail` 在 `:root`,窄窗断点自动跟着变)。
   - `.bs-*` 调色板变量原本挂在 `.boot-skeleton` 上,而 overlay **不是它的后代**
     → `var(--bs-muted)` 取不到 → `linear-gradient(90deg, , , )` 整条声明失效
     → 卡片透明。用户看到的是**一片空白的正文区**(而不是骨架)。
     改成挂到 `:root` / `[data-theme="light"]` / `html:not([data-theme])`。
   - 顺带:`GridSkeleton` 之前只渲染 `.bs-grid`,而静态骨架是「标题条 + 网格」——
     少了标题条卡片整体上移 ~44px。补上,两边结构对齐。

2. **焦点环被遮住(用户标注的红框)** —— 全局 `:focus-visible` 是
   `outline: 2px; outline-offset: 2px`(画在元素**外边沿**)。而分组行里
   caret 与标题之间 gap 是 0、`.group-head` 紧挨 `.group-children` —— 实测环的**右沿**
   被相邻的 `.nav-row-inner` 盖住、**下沿**被下一行盖住。
   修:侧栏内所有行/按钮 `outline-offset: -2px`,把环画进自己的盒子,谁也盖不到
   (行内本来就有 padding,内收不会压到图标或文字)。
   实测 Tab 到 caret / 分组标题 / 方向键到成员行,三处环都完整闭合。

## 又三处(「侧栏宽度还是会变」的问题追到底)

用**注入 rAF 记录器**抓每一帧(而不是轮询采样,那样会漏掉中间帧),才看清真相:

1. **`box-sizing` 在第一帧还是 content-box** —— Tailwind 4 的 preflight 里有
   `*{box-sizing:border-box}`,但它要等 CSS bundle 到位才生效。之前骨架按浏览器默认的
   content-box 算:`.bs-rail` 的 `width:268px` **再加上** `.bs-sec` 的左右 padding(各 16px)
   → 第一帧 **301px**,CSS 一到变 268px。这正是「从一个较大的侧栏 → 实际宽度」。
   修:骨架的内联 `<style>` 里先补同一条 `box-sizing`。
2. **骨架卡片数不一致** —— 静态骨架 8 张、`GridSkeleton` 12 张 → 交接时卡片数量跳变。
   统一成 12(两处各写了注释互相指向)。
3. **`boot-overlay` 闪了一下(两次翻转)** —— `ready: true` 原本在 init 的**同步部分**落地,
   而那一刻 `loading` 还是 false(首轮 `refreshAll` 的 `loading:true` 要等一个 await 才设)
   → `showSkeleton` 判成 false → overlay **卸掉又装回来**。
   逐帧量到相位是 static → overlay → static → overlay → static。
   修:`ready` 挪到 init **最末尾**(首轮刷新跑完),全程只翻转一次。

修完逐帧复验(1440 与 1000 两档):侧栏宽度全程**唯一**(268 / 64)、卡片数恒定 12、
相位序列 `static → overlay → static(淡出) → real` 只一次交接。

## 折叠栏(64px)的可用性(用户反馈「操作体验很奇怪」)

实测发现折叠态里**成员行是空白行**:行内唯一的图元是 `.sub-dot`(6px 圆点),
而它在折叠态被 `display:none` → 44 行里有一批没有任何可见内容;
唯一看得见的反而是 `.sub-more` 那个「更多」方块 —— 实测它正好落在 47px 行的**正中**,
点下去只弹菜单、**永远不导航**,完全错位。

三处修:

1. **补 kind 图标** —— `SubRow` 加一个 `<Icon className="sub-icon">`(图标取
   `KIND_META[channelKind].icon`,与内容类型 tab 同源)。宽栏 `display:none`(视觉不变,
   那儿由 `.sub-dot` 承担 kind 标识),折叠态才显示。44 行 → **0 空白行**。
2. **隐藏「更多」入口** —— `.rail-collapsed` 与 `@media(max-width:1080px)` 两组
   `display:none`(它的菜单在 64px 里放不下)。折叠态回归「纯导航」。
3. **窄窗分支补齐两条** —— 与 `.rail-collapsed` 组**逐项同步**:
   - 隐藏滚动条(否则图标偏左 5px,上下错开一条竖线)
   - `gap: 0`(少了它,宽度为 0 的 `.sub-slot` 仍算一个 flex item,
     12px gap 把图标挤得偏左 **6px**,实测 delta −6.3)
   还补了 `.group-head-plain` 的居中和 `justify-content`。

修完三态实测:手动折叠 / 窄窗(≤1080px) 都是 `blankRows=0`、图标 delta 唯一 `-0.3`
(四舍五入误差);宽栏 `sub-icon:none` / `sub-dot:block` / `sub-more:grid`——视觉零变化。
点成员行正中 → **导航**(不再弹菜单)。

## 折叠态没有状态反馈(用户:「分组图标无法进入激活状态,快捷键也无效」)

实测下来是**同一个根因的两面**:折叠态下只剩图标,而图标默认是 `--text-dim`(灰),
且 `.nav-caret-btn`(展开箭头)在这一档被 `display:none`(与参考实现 `new_desktop` 一致)。

- **「激活」**:`.nav-row[aria-current="page"] svg { color: var(--text) }` 这条对普通行有效,
  但分组行的 `aria-current` 挂在 `.nav-row-inner` 上 → `.nav-row[aria-current]` **匹配不到**
  → 实测选中分组的 `folderColor` 一直是 `oklch(0.52 …)`(灰)。
- **「快捷键无效」**:方向键其实是有效的(实测 `ArrowRight` 把 `data-row-expanded`
  从 false 翻成 true);但**展开后看不出任何变化** —— 箭头被隐藏、成员行也只是多出来,
  64px 栏里几乎注意不到。所以用户读到的是「按键没反应」。

修:折叠态下让图标同时承担两种状态表达 ——

| 状态 | group-icon | 颜色 |
| --- | --- | --- |
| 折叠 + 未选中 | `folder` | `--text-dim` `0.52` |
| 展开 + 未选中 | `folderOpen` | `--text-muted` `0.48` |
| 选中 | 随展开态 | `--text` `0.22` |

图标在 `folder` / `folderOpen` 之间切换(见 Rail.tsx):**这是折叠态唯一的展开指示**。
宽栏里 caret 已经在转,图标再变会喧宾夺主,所以两者都只在 `:is(.rail-collapsed, @media ≤1080px)`
里启用。实测三态颜色**互不相同**,折叠态与窄窗**逐项对齐**,宽栏 `caret: grid` 且图标保持
`0.52`(视觉零变化)。

## 分组行没有 hover 反馈(用户:「鼠标放在图标上,分组图标不会进入激活状态」)

又是一处**原设计如此、但只在宽栏被 caret 掩盖**的问题:

```
.group-head:hover { background: transparent }        ← 覆盖掉了通用的 .nav-row:hover
.nav-row-inner:hover { color: var(--text) }          ← 只改文字色,**不给背景**
```

注释写着「整行 hover 只在 .nav-row-inner 上」,可 `.nav-row-inner` 根本没有 hover 背景,
只有 caret 按钮自己有。宽栏里指针很容易落在 caret 上、看着像有反馈;**折叠态 caret 被
`display:none`,只剩一个图标,悬停完全没反应**(实测 `rgba(0,0,0,0)` 一直不变)。

修:删掉那条覆盖,走 `.nav-row:hover` 的统一规则 —— 实测 `rgba(0,0,0,0)` → `oklch(0.955)`,
折叠/宽栏两态都生效。不需要 `:has()`:悬停分组行时指针必然落在它的子元素上,
浏览器会把祖先也判为 `:hover`(实测 `matchesHover: true`)。

顺带统一:`group-head[data-active="true"]` 不再清背景(之前折叠/窄窗里清掉了)。
实测**其它选中行**(内容类型 tab)静态底色就是 `--surface-3` 且悬停不变 —— 分组行现在
与它完全一致(折叠/宽栏两态都是 `0.935` 静态、悬停不变)。

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
- 折叠栏图标:20 个图标中心与侧栏中心的最大偏差 **0.3px**(四舍五入误差)
- 骨架宽度:1440 / 1100 / **1081 / 1080** / 1000 / 820 六档,`.bs-rail` 与真实 `.rail` 逐一相等
- 骨架几何交接:1440 与 1000 两档,overlay 与静态骨架的 `.bs-grid` **逐一相等**
  (`[268,1172]` / `[64,936]`),卡片渐变长度 91(有效声明,不再是透明)
- 焦点环:Tab 到 caret / 分组标题、方向键到成员行,三处环 3x 放大截图均完整闭合
- **逐帧**(rAF 记录器,1440 与 1000 两档):侧栏宽度全程唯一、卡片数恒定 12、
  相位只 `static → overlay → static(淡出) → real` 一次交接
- 折叠栏可用性:手动折叠 / 窄窗两态 `blankRows=0`、图标 delta 唯一 `-0.3`;
  宽栏 `sub-icon:none` / `sub-dot:block` / `sub-more:grid`(视觉零变化);
  点成员行正中 → 导航而非弹菜单
- 折叠态状态表达:三态图标色互异(`0.52` / `0.48` / `0.22`),折叠态与窄窗逐项对齐;
  宽栏 `caret: grid` 且图标保持 `0.52`
- 分组行 hover:未选中 `rgba(0,0,0,0)` → `oklch(0.955)`(折叠/宽栏两态);选中行
  `0.935` 静态、悬停不变 —— 与**其它选中行**逐一相同

## 明确不做

ARIA tree 语义(`role=tree`/`aria-level`)· typeahead · 拖拽重排 · 多选 · 虚拟化 ·
roving tabindex · 未分组区折叠 · 把整个侧栏做成一棵树 · `openGroups` 迁 `string[]` ·
`j`/`k` 在树内让位
