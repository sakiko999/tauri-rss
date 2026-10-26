/**
 * core 日志域 —— 与其它包统一走 `@amoeba/log`。
 *
 * 此前 core 用 `appHost.log`（宿主 Logger），形成第二套通道：无域、无前缀、
 * `log:<域>` 开关管不到，CLI 下 info 还会写 stdout 污染探针输出。服务进程需要
 * 「全部级别走 stderr」的能力由 `@amoeba/log` 的 sink 提供，不再需要宿主 Logger。
 *
 * 事件只保留排障必须的：失败/降级（refresh/cache/detail/cookie 同步）。
 * 正常刷新/条数/耗时属于数据路径，观测走 CLI 探针（docs/ops/commands.md）。
 */
import { createLogDomain } from "@amoeba/log"

export const coreLog = createLogDomain("core", {
  color: "#94a3b8", // slate-400：中性色，不抢平台域
  ansi: 245,
  events: {
    refreshFailed: {
      level: "error",
      text: (ctx: { subscriptionId: string; error: string }) => `刷新失败 ${ctx.subscriptionId}: ${ctx.error}`,
    },
    cacheWriteFailed: {
      level: "warn",
      text: (ctx: { subscriptionId: string; error: string }) =>
        `内容缓存写入失败 ${ctx.subscriptionId}: ${ctx.error}`,
    },
    detailFailed: {
      level: "warn",
      text: (ctx: { subscriptionId: string; itemId: string; channel: string; error: string }) =>
        `详情补全失败 ${ctx.channel}/${ctx.itemId}: ${ctx.error}`,
    },
    cookieSnapshotSynced: {
      level: "info",
      text: (ctx: { field: string; user_id?: string }) =>
        `浏览器 cookie 快照已同步 ${ctx.field}${ctx.user_id ? ` · user_id=${ctx.user_id}` : ""}`,
    },
    cookieSnapshotFailed: {
      level: "warn",
      text: (ctx: { field: string; error: string }) => `浏览器 cookie 快照同步失败 ${ctx.field}: ${ctx.error}`,
    },
    loadMoreFailed: {
      level: "error",
      text: (ctx: { subscriptionId: string; channel: string; error: string }) =>
        `加载更多失败 ${ctx.channel}/${ctx.subscriptionId}: ${ctx.error}`,
    },
    passiveNoData: {
      level: "warn",
      text: (ctx: { subscriptionId: string; channel: string }) =>
        `被动采集无数据且无缓存可回退 ${ctx.channel}/${ctx.subscriptionId}`,
    },
  },
})
