# 审计发现积压（未修，待处理）

> 来源：2026-10-13 全仓审计 workflow（8 维度 × 对抗验证）。已修的见各 commit；本文件登记**已确认但未修**的发现，避免成果流失。
> 格式：`[严重度] 文件 — 问题 / 建议`。处理后删行或标 ✅。

## 待修（已确认）

- [ ] **[medium] `packages/core/src/processing/deserialize.ts:166`** — `parseImages(raw["tpl:images"])`
      读的节点无生产者：serialize 把 social 图发成 `media:content`(medium=image)，但 deserialize
      先试 `tpl:images`（空）再 `parseImagesFromMedia` 兜底。现能工作（兜底生效），但死分支易误导。
      建议：删 `tpl:images` 分支或让 serialize 也写它（二选一，别两边都不一致）。
- [ ] **[medium] `packages/xml/src/serialize.ts:174`** — round-trip 丢 `Stream.headers`：
      video/audio 的 `stream.headers`（带 referer 的直链）序列化时未写、deserialize 也未读。
      当前不影响（流走 resolver by-url 懒解析，XML 不带 playUrls），但类型 Live 上有
      `playHeaders` 字段是**死协议**——建议删掉该字段（连同 `playUrls`/`playUrlsExpiresAt`）。
- [ ] **[low] `packages/core/src/processing/deserialize.ts:397`** — `rsshubArticleMedia` 对
      enclosure 与 media:content 同一个 URL 会**重复追加**（同一图出现两次）。加去重。
- [ ] **[medium] `apps/desktop/src/store/index.ts` markRead** — 标已读不写 `lastReadAt`
      区分？核对 reading 的语义（消费侧一致性）。
- [ ] **[low] `packages/ui/src/index.ts:16`** — ui 包 re-export 了 16 个 player 符号/类型，
      全仓零消费（desktop 直引 `@tauri-playground/player`）。删这批 re-export。
- [ ] **[low] `packages/ui/src/renderers/atoms/format.ts:7`** — `fmtDuration`/`fmtAudioDuration`
      零消费者，删。
- [ ] **[low] `packages/core/src/xml/deserialize.ts:1`** — `@deprecated` re-export shim
      （`export * from "../processing/deserialize.ts"`）零 importer，删。
- [ ] **[low] `apps/mobile/src/main.ts:6`** — mobile 模板的 greet 逻辑引用不存在的 DOM 节点
      与 Tauri command（index.html 无 #greet-input 等）。接 mobile 时一并重写。
- [ ] **[low] `packages/xml/src/types.ts:141`** — `Live.playUrls`/`playHeaders`/`playUrlsExpiresAt`
      三个字段全仓无读写路径（死协议）。删。
- [ ] **[low] `packages/log/src/core.ts:170`** — `getLogDomain`/`resetLogDomains` 零消费，
      确认后删或补消费者。
- [ ] **[medium] `apps/desktop/src/App.tsx` URL** — `/v/page%3Adiscover` 编码形态：React Router
      能解码，但与 `/v/page:settings` 混用（go 与 viewPath 编码不一致）。核对是否有导航
      比较 `nodeId` 字符串的地方会被编码串骗过。
