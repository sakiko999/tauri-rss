import { resolveLog } from "./resolve.ts"
import { selectLog } from "./select.ts"
import { engineLog } from "./engine.ts"
import { playLog } from "./play.ts"
import { loaderLog } from "./loader.ts"

/**
 * 统一 log 对象 —— 5 域方法平铺,调用形式 `log.resolveStart()` 等(贴近旧 utils/log.ts)。
 * 各域事件方法名全局唯一(spread 无覆盖冲突);自由方法 log/debug/info/warn/error
 * 各域同名,spread 后取 loader 域的实现(动态读 registry,通用无差别)。
 */
export const log = { ...resolveLog, ...selectLog, ...engineLog, ...playLog, ...loaderLog }
