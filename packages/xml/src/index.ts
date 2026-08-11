/**
 * @tauri-playground/xml — RSS 2.0 + `tpl:` 扩展的编解码层。
 *
 * crawler/core 共用:
 *   - types:      Item 协议(判别联合,贴近 XML 形态)
 *   - serialize:  Item[] → RSS 2.0 XML(XMLBuilder 编解码)
 *   - xml-parser: XML → ParsedFeed/ParsedItem(通用解析,含 Atom)
 *
 * 编解码都走 fast-xml-parser,不手写字符串拼接。deserialize(tpl: 逆解析
 * 成 core 的 MediaItem)属 core 层,不在此包。
 */
export type {
  Kind,
  Author,
  StreamingFormat,
  Stream,
  AttachmentKind,
  Attachment,
  Base,
  Article,
  Social,
  SocialImage,
  Video,
  Audio,
  LiveStatus,
  LivePlatformId,
  Live,
  Item,
} from "./types.ts"
export { serializeFeed } from "./serialize.ts"
export type { SerializeOptions } from "./serialize.ts"
export { parseFeed } from "./xml-parser.ts"
export type { ParsedFeed, ParsedItem } from "./xml-parser.ts"
