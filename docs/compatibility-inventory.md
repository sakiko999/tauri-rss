# 兼容补丁清单与浮层视口审计

> 2026-10-19 整理。口径：这里主要是**向后兼容**（新代码继续读旧数据/旧输入）。
> 严格意义的**向前兼容**（旧版本读新版本写的数据）本项目基本没有——KV 是整块 JSON，
> 没有 `schemaVersion`，旧版本遇到新字段只会原样保留、不认识；只有 `MIGRATIONS`
> 属于正向脚手架。
>
> ⚠️ **2026-10-19 同日清理：不再兼容旧持久化数据**。全新安装（库里只有当前代码写的
> 数据、无旧 localStorage/旧缓存 XML）为前提，已删除的条目见「一、附」。

## 一、持久化数据兼容（当前保留）

| 兼容点 | 旧形态 → 现行为 | 位置 |
| --- | --- | --- |
| 单房间 → 多房间 | 旧订阅只有 `info.roomId` → `parseRoomIds` 优先 `roomIds`，为空回退 `roomId`；4 个直播渠道的标题/链接也用 `info.roomIds ?? info.roomId` | `packages/resolve/src/utils/room-ids.ts:11-17`、`channels/{bili,douyu,huya,douyin}/live.ts` |
| 内置 RSS 旧订阅 | 旧订阅只存 channel key、`info.url` 为空 → 用构造期 `defaultUrl` 兜底（`defaultInfo` 一键订阅能力本身也依赖它） | `packages/crawler/src/channels/rss/raw.ts:38-50` |
| 抖音存量渠道 | `live:douyin:user` 不再出现在新建入口，但**仍注册**，旧订阅照常刷新；同时是 Discover 页「用户直播间」能力的判据 | `packages/crawler/src/register.ts:110`、`views/discover/DiscoverPage.tsx:107-110` |
| 旧正文格式 | 无 `tpl:contentFormat` → `content ? "html" : undefined`，RSS 文章本来就可能不写该字段 | `packages/core/src/processing/deserialize.ts:160` |

**不能删的几处**：

- `parseRoomIds` 与 4 个直播渠道的标题回退：**CLI 当前仍以 `{roomId}` 建订阅**
  （`apps/cli/src/info.ts:18,21-23`，`rss refresh` 会落库）。要删先把 CLI 改成
  `roomIds`。
- 内置 RSS 的 `defaultUrl` 兜底：`apps/desktop/src/dev/seed.ts:46-51` 仍以
  `info:{}` 建 `rss:hn`；改成显式写 url 后才可删。
- `live:douyin:user` 的注册：`DiscoverPage.tsx:107` 用它判断是否渲染「用户直播间」
  入口，删掉是功能回退，不是清理旧数据。
- `contentFormat` 推断：属于当前 RSS 文章的常态兜底。

**一、附：2026-10-19 已删除的兼容补丁**（前提：不兼容旧数据）

- reading 裸 id 键：`readingKey` 的 `undefined` 退化、`findRecord` 的裸 id 回退、
  `repo-concurrency.check.ts` 的旧键断言。
- localStorage → SQLite 一次性搬迁（`packages/host/src/tauri/sqlite-storage-backend.ts`）。
- 旧日志开关 `host-log=0` / `player-log=0`（`readSwitch` 的 `legacyKey` 与 7 处配置）。
- 读 `tpl:isUnread` / `tpl:isStarred`（当前 serialize 不写；阅读态由 reading repo 负责）。
- Live 缺 `tpl:platform` / `tpl:roomId` 时从 item URL 推导（`liveFromUrl` 已删）。
- 并入订阅时 `delete info.roomId`（当前 UI 只写 `roomIds`，纯 no-op）。
- 桌面 `valueList` 的 `info.roomId` 回退（`subscriptions.ts` + check）。
- 社交图片 `string | SocialImage` 联合形态（xml types/serialize、`fillImageSizes`、
  CLI detail、roundtrip check）。
- `SocialCard` 读 `item.raw.type` 与 core `MediaItem.raw` 字段。
- `heatOf` 的 `views` / 字符串 `likes`（参考原型遗留）。
- `LocalStorageBackend` 的默认前缀（唯一实例显式传 `browser-rss:`）。
- 订阅 blob 缺 `subscriptions`/`groups` 时补空数组（改为结构非法就走 corrupt 流程）。
- 死兼容代码：`useMediaStream` 的三个判据 re-export、crawler 的 `resolveBiliPlay`
  别名、`findItemUrl` 的 `roomId` 分支、Tauri HTTP 的 `withBody` 断言。
- `apiFetch` 的 `Item[]` 联合：现只接受统一 `FetchResult`（`{items,total?}`）；
  只产数组的渠道经 `apiFetchItems` 适配。

## 二、旧输入 / 旧格式归一化

| 兼容点 | 旧形态 → 现行为 | 位置 |
| --- | --- | --- |
| 抖音输入 | `@抖音号` / `抖音号：x` / 直播间 URL / 裸短号 / `douyin.com/user/<sec_uid>` / `iesdouyin.com/share/user/...` → 去前缀、取末段、主页链接走资料 API 换 web_rid | `resolve/platform/douyin/ids.ts`、`crawler/channels/douyin/live.ts:74-86` |
| B站旧 ID | `av<数字>` URL/ID → 订阅/播放/弹幕统一转 aid | `resolve/resolver/router.ts:29-30`、`platform/bili/client.ts:197,224-227` |
| YouTube 短链 | `youtu.be/<id>` → 与 `watch?v=` 同路由 | `resolve/resolver/router.ts:48` |
| 小红书时间 | 旧秒级时间戳 → 按阈值判别后统一 epoch ms | `resolve/platform/xhs/client.ts:118-126` |
| 小红书 SSR | `new Map([])`、`{_rawValue}`、noteId 在外层/noteCard → 清洗、解包、两处取 | `xhs/client.ts:81-100,184-185` |
| Atom | `<feed><entry>` → 归一成 RSS 字段（id→guid、published→pubDate 等） | `packages/xml/src/xml-parser.ts:78-131` |
| OPML | outline 省 `type`、标题在 `text/title/#text` → 逐级回退 | `packages/xml/src/opml.ts:94-110` |
| 流格式缺失 | 无 `format` → 按 URL 后缀判 HLS/FLV/MP4 | `player/hooks/streamKind.ts:11-40` |
| 二维码载荷 | `data:image/...` 直接显示；纯文本本地编码成二维码 | `apps/desktop/src/components/QrImage.tsx:14-26` |
| cookie 字段前缀 | `douyin:*` 与 `live:douyin*` 都映射到 `douyinCookie` | `AccountPage.tsx:294` |
| 发现页渠道 key | 同时匹配 `<platform>:<cap>` 与 `live:<platform>:<cap>`；搜索先查映射再回退旧命名 | `DiscoverPage.tsx:39-42` |

## 三、向前兼容脚手架

- **DB 迁移数组**：`packages/core/src/db/schema.ts:20-26` 预留有序 `MIGRATIONS`，两端按序执行；目前只有 v1 幂等 DDL，尚未落版本表。
- **settings 预留字段**：`viewMode/startMuted/defaultQuality` 暂时没有消费者，但保留并用默认值 spread 合并，避免以后加字段要迁移。
- **未知枚举值**：`deserialize.ts:336-348` 只放行已知的 `streamingFormat/contentFormat`，未知值返回 `undefined`，不抛错、不透传。
- **日志域重注册**：`log/src/core.ts` 同域二次创建返回同一引用，HMR 不重置开关。

## 四、运行时降级（不是数据兼容）

- 内容缓存：抓取失败或成功 0 条时回退旧 `content:<subId>`，不空窗（`data-layer.ts:268-306`）。
- 旧 API/协议：抖音 enter→reflow→HTML 三级；YouTube VR→WEB、DASH→渐进；B站 DASH→durl、直播 probe 重解；Apple 新版 504 → 继续用旧 iTunes 端点。
- 环境能力：无 `appHost.ws` → 原生 WebSocket；无 `openExternal` → `window.open`；Node 无 `getSetCookie()` → 读 `set-cookie`。

## 五、没做兼容的破坏性变更

- **RSSHub 具名渠道整体删除**：`rsshub:bili:*` / `weibo:*` / `youtube:*` 等旧订阅刷新会失败，只能迁移到对应内置渠道或 `rsshub:feed`。这是目前最大的一处「不兼容」。
- **`live:douyin:anchor` 已删除**：旧订阅如果引用它，刷新会失败。
- `live:douyin:user` 属于半兼容：旧订阅仍能刷新，但不再出现在新建列表，也不会成为 `live:douyin` 的合并目标。

## 六、附：侧栏订阅菜单的视口处理

**现象**：侧栏订阅行尾的「更多」菜单在窗口底部附近会贴边/溢出视口。

**定位**：

- `apps/desktop/src/components/app/RailGroupTree.tsx:338` 的「更多」用的是共享
  `Menu`（`components/Modal.tsx:77`），底层是 Radix `DropdownMenu`，**不是**自造浮层。
- Radix 默认 `avoidCollisions=true`，但 `collisionPadding` 默认是 `0`，所以菜单会
  贴着视口边缘；`.menu` 又只给了 `width:max-content / min-width:200px`，**没有**
  `max-height + overflow`，长菜单只能硬顶。
- 对比：`Select` 的 `.select-pop` 早已用 `max-height: min(320px,
  var(--radix-select-content-available-height))`，`Menu` 漏了同款约束。

**修复**：

- `Modal.tsx` 的 `DropdownMenu.Content` 加 `collisionPadding={10}`；`Select`
  加 `collisionPadding={8}`。
- `70-overlays.css` 的 `.menu` 加
  `max-height: var(--radix-dropdown-menu-content-available-height, 70vh)` +
  `overflow-y: auto`。空间不足时菜单内部滚动，不再顶出视口。
- 没有改 `.menu` 的 `position: fixed`（Radix 的 popper 定位依赖它；历史注释已解释
  写 `relative` 会让菜单钉在视口原点）。

**验证**：`tsc -p apps/desktop --noEmit` + `bun run build:desktop` 通过。真机上还需
在窗口底部/窄高窗口各开一次菜单，确认 flip 方向与内部滚动；若仍贴边，优先量
`getBoundingClientRect()`，不要重写 `position`。

## 七、维护提醒

兼容层散落在各个读取点，因为 KV 存的是整块 JSON、没有 `schemaVersion`。好处是不用
集中迁移；坏处是删掉任何一处都不会报错，只会静默降级——比如旧房间不再抓取、旧订阅
显示 0 房。改这些读取逻辑时，最好把对应的 `.check.ts` 一起跑。
