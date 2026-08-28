import { resolveLog } from "./resolve.ts"
import { engineLog } from "./engine.ts"
import { playLog } from "./play.ts"
import { loaderLog } from "./loader.ts"
import { danmakuLog } from "./danmaku.ts"

/**
 * 统一 log 对象 —— 5 域方法平铺,调用形式 `log.resolveFailed()` 等(贴近旧 utils/log.ts)。
 * 各域事件方法名全局唯一(spread 无覆盖冲突);自由方法 log/debug/info/warn/error
 * 各域同名,spread 后取 loader 域的实现(动态读 registry,通用无差别)。
 * (2026-08-28 log 清退:select 域删除——选流/切档纯逻辑,CLI `rss item` 可复现。)
 */
export const log = { ...resolveLog, ...engineLog, ...playLog, ...loaderLog, ...danmakuLog }
