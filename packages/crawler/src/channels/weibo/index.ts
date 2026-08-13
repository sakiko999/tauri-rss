/**
 * weibo channel 统一入口 —— 目录内公开 API 全从 index 导出。
 * (client.ts 是公共 HTTP + mblog 归一,user.ts/hot.ts 是 channel 实现。)
 */
export * from "./user.ts"
export * from "./hot.ts"
