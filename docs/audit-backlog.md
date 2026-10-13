# 审计发现积压（未修，待处理）

> 来源：2026-10-13 全仓审计 workflow（8 维度 + 流程追踪 × 对抗验证）。已修的见各 commit；
> 本文件登记**已确认但未修**的发现，避免成果流失。格式：`[严重度] 文件 — 问题 / 建议`。

## 已修（本轮，供对照）

序列化边界丢字段 / RSS+OPML 转义 / Select 空值哨兵 / loadMore 分页窗口 / bili av 号 /
bili:live 作者名 / bili 视频时长 / 退订竞态+墓碑泄漏 / 停用订阅游标残留 / loadMore 无视停用 /
douyu 搜索人气丢单位 / douyu 搜主播假 0 / 全文搜索 / 阅读进度 / 续播 / 表格分隔线 /
player 圆角方角 / 弹幕前跳洪水 / attemptPlay 未处理 rejection / 弹幕同毫秒去重 /
ws reader 死循环+连接泄漏(rust) / ws 事件早于 resolve(host) / abortPending 全局误杀 /
Atom 多 link / rsshubArticleMedia 重复 / 死协议字段与死代码清理。

## 待修（已确认）

- [ ] **[medium] `packages/resolve/src/browser/cdp.ts:23` `withBrowserLock` 无队列取消** ——
      per-sub 超时 abortPending 后,排队等锁的浏览器操作不会被取消,之后仍会运行并重连
      CDP。要真正取消需给锁加取消上下文(改动较大,且 abort 本身是「不再等待」语义),
      故暂缓。影响:多浏览器订阅同时超时会有 CDP 关闭→重开的抖动(非正确性错误)。

- [x] **[medium] `deserialize.ts` `tpl:images` 死分支** — 无生产者（serialize 发 `media:content`），
      已删该分支，social 图统一走 `parseImagesFromMedia`。（2026-10-13）
- [x] **[medium] `Live.playUrls`/`playHeaders`/`playUrlsExpiresAt`** — 已删（types.ts 留警告注释）。
- [x] **[medium] `App.tsx` URL 编码** — 核实无 bug：React Router 解码 params，loader（router.tsx:58）
      与 store 均用解码值，无字符串比较被编码串骗过。
- [ ] **[medium] `apps/desktop/src/store/index.ts` markRead** — 标已读不写 `lastReadAt`
      区分？核对 reading 的语义（消费侧一致性）。
- [ ] **[low] `packages/ui/src/index.ts:16`** — ui 包 re-export 了 16 个 player 符号/类型，
      全仓零消费（desktop 直引 `@tauri-playground/player`）。删这批 re-export。
- [ ] **[low] `apps/mobile/src/main.ts:6`** — mobile 模板的 greet 逻辑引用不存在的 DOM 节点
      与 Tauri command（index.html 无 #greet-input 等）。接 mobile 时一并重写。
- [ ] **[low] `packages/log/src/core.ts:170`** — `getLogDomain`/`resetLogDomains` 零消费
      （仅 index.ts re-export）。公开 API 供调试用，低优先；确认后删或补消费者。
- [ ] **[low] `rsshubArticleMedia` 重复追加** — enclosure 与 media:content 同 URL 会重复。
      核对是否仍存在（rsshub 源已少用）。

## 在本会话修（供对照）

通用 RSS 文章正文按需补全（新功能）+ 持久缓存；社交弹窗控件条/HTML 渲染；`looksLikeHtml`
共享探测；`tpl:fetchedAt`/`authorAvatar`/`authorHandle` 契约缺口；弹幕冷启动开头丢失；
阅读进度恢复随补全重跑；切条目进度串写；extract `<figure>` 保留 / fallback 段落 / 误删守卫；
`serialize-contract.check` + `body-cache.check` + `extract.check` 三个新守卫。
