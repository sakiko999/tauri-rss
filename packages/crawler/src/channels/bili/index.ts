/**
 * bilibili channel 统一入口 —— channel 实现类从 index 导出(register.ts 消费)。
 * 平台 client/签名/弹幕在 `platform/bili/`,不从这里 re-export(各 channel 直连平台门面)。
 */
export * from "./channels.ts"
export * from "./live.ts"
export * from "./dynamic.ts"
export * from "./hot.ts"
