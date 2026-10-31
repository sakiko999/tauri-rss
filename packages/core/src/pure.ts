/**
 * @amoeba/core/pure —— 无副作用、不拉 crawler/resolve 实现的纯函数与常量。
 *
 * ⚠️ 为什么单独一个入口：根入口 `@amoeba/core` 会求值 data-layer（静态 import
 * crawler/resolve/xml，连带抖音 msdk 签名脚本）。apps 里**任何一处值导入**根入口，
 * 打包器就得把这些全拉进首屏包（2026-11-01 实测：desktop 主包 3.34MB 中约 680KB）。
 * 远端客户端（desktop）只值导入本入口；类型照常从根入口 `import type`。
 * 守卫：`apps/desktop/src/lib/core-imports.check.ts`。
 *
 * 本文件只许 re-export 零依赖模块、`@amoeba/platform`、`@amoeba/resolve/errors`。
 */

export { contentTtlMs, cookieFieldFor, cookieFieldForPlatform } from "./settings-policy.ts"
export { ERROR_KIND_LABEL, ResolveError, errorKindOf, type ErrorKind } from "@amoeba/resolve/errors"
export { positionDecision, type PositionDecision } from "./reading-position.ts"
export { findItem, findRecord, itemRefKey, readingKey } from "./types/reading.ts"
