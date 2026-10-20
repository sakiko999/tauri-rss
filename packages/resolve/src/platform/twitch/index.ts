/**
 * twitch 平台门面 —— 聚合该平台能力(匿名 GraphQL 元数据 + 直播 HLS 解析)。
 * import 统一从 `../../platform/twitch` 进,不直连内部文件。
 */
export * from "./client.ts"
export * from "./live.ts"
