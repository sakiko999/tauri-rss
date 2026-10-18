# 兼容补丁清单与浮层视口审计

> 2026-10-19 整理。口径：这里主要是**向后兼容**（新代码继续读旧数据/旧输入）。
> 严格意义的**向前兼容**（旧版本读新版本写的数据）本项目基本没有——KV 是整块 JSON，
> 没有 `schemaVersion`，旧版本遇到新字段只会原样保留、不认识；只有 `MIGRATIONS`
> 属于正向脚手架。

## 一、持久化数据兼容（高风险，删了会静默丢状态）

| 兼容点 | 旧形态 → 现行为 | 位置 |
| --- | --- | --- |
| reading 裸 id 键 | 2026-10-15 前按 `itemId` 存 → 先查 `subscriptionId\u0000itemId`，未命中回退裸 id；**命中后不删旧键**（同一旧记录可能被多个订阅共享） | `packages/core/src/types/reading.ts:34-53`、`repo/reading-repo.ts:95` |
| 单房间 → 多房间 | 旧订阅只有 `info.roomId` → `parseRoomIds` 优先 `roomIds`，为空回退 `roomId` | `packages/resolve/src/utils/room-ids.ts:11-17` |
| 同上（桌面侧） | `valueList` 做同样的回退，否则旧订阅显示「0 房」、合并时把原房间挤掉 | `apps/desktop/src/lib/subscriptions.ts:35-44` |
| 同上（写回） | 并入新房间时把 legacy 值拼进 `roomIds`，再删掉旧 `roomId`，避免两个键长期并存 | `AddSubscriptionDialog.tsx:303-305,355-358` |
| localStorage → SQLite | 旧 `tauri-rss:{subscriptions,reading,settings}` → SQLite 该 key 为空时一次性搬入；先写成功再删 local，避免双源皆失 | `packages/host/src/tauri/sqlite-storage-backend.ts:34,59-71` |
| 内置 RSS 旧订阅 | 旧订阅只存 channel key、`info.url` 为空 → 用构造期 `defaultUrl` 兜底；这是常态路径，不是异常 | `packages/crawler/src/channels/rss/raw.ts:38-50` |
| 抖音存量渠道 | `live:douyin:user` 不再出现在新建入口，但**仍注册**，旧订阅照常刷新 | `packages/crawler/src/register.ts:110`、`AddSubscriptionDialog.tsx:94-96` |
| 旧缓存 XML 缺字段 | 无 `tpl:platform` / `tpl:roomId` → 从 item URL 推导（B站/斗鱼/虎牙/抖音） | `packages/core/src/processing/deserialize.ts:220-221,431-446` |
| 旧正文格式 | 无 `tpl:contentFormat` → `content ? "html" : undefined`，不把旧缓存正文降级成纯文本 | `deserialize.ts:160` |
| 社交图片旧形态 | `images: string[]` → 归一成 `{url}` 再序列化；对象形态保留宽高 | `packages/xml/src/types.ts:102`、`serialize.ts:166-174` |
| 日志旧开关 | 旧 `host-log=0` / `player-log=0` 仍生效 | `packages/log/src/env.ts:17-22`、`packages/host/src/log.ts:37` |

**不能删的几处**：

- reading 回退命中后**不能删旧键**。
- `parseRoomIds`、桌面 `valueList`、并入写回三处必须同时保留；只删写回会在合并时丢原房间。
- localStorage 搬迁是一次性的；删掉这段代码 = 放弃所有仍从旧版本升级的用户。
- `live:douyin:user` 的注册不能随 UI 隐藏一起删。

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
| fetch 返回形状 | `Item[]` 与 `{items,total}` 都接受 | `crawler/channels/factory.ts:33-36` |
| 流格式缺失 | 无 `format` → 按 URL 后缀判 HLS/FLV/MP4 | `player/hooks/streamKind.ts:11-40` |
| 二维码载荷 | `data:image/...` 直接显示；纯文本本地编码成二维码 | `apps/desktop/src/components/QrImage.tsx:14-26` |
| cookie 字段前缀 | `douyin:*` 与 `live:douyin*` 都映射到 `douyinCookie` | `AccountPage.tsx:294` |
| 发现页渠道 key | 同时匹配 `<platform>:<cap>` 与 `live:<platform>:<cap>`；搜索先查映射再回退旧命名 | `DiscoverPage.tsx:39-42` |
| 旧 import 路径 | `isHlsStream` / `resolveBiliPlay` 等仍 re-export，旧调用方不破 | `player/hooks/useMediaStream.ts:21-25` 等 |

## 三、向前兼容脚手架

- **DB 迁移数组**：`packages/core/src/db/schema.ts:20-26` 预留有序 `MIGRATIONS`，两端按序执行；目前只有 v1 幂等 DDL，尚未落版本表。
- **settings 预留字段**：`viewMode/startMuted/defaultQuality` 暂时没有消费者，但保留并用默认值 spread 合并，避免以后加字段要迁移。
- **未知枚举值**：`deserialize.ts:336-348` 只放行已知的 `streamingFormat/contentFormat`，未知值返回 `undefined`，不抛错、不透传。
- **日志域重注册**：`log/src/core.ts:141-153` 同域二次创建返回同一引用，HMR 不重置开关。

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
集中迁移；坏处是删掉任何一处都不会报错，只会静默降级——比如旧已读消失、旧房间不再
抓取、旧订阅显示 0 房。改这些读取逻辑时，最好把对应的 `.check.ts` 一起跑。
