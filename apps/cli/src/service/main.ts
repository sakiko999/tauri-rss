#!/usr/bin/env bun
/**
 * 数据服务独立入口（打包用）。
 *
 * 与 `apps/cli/src/main.ts --service` 的区别：这里不加载 cac、命令注册、CLI
 * settings/credentials，只带服务自身依赖。发布时由 `amoeba-runtime` 拉起
 * `dist/service/service.js`，stdout 仍然只输出 `READY <port>`。
 */
import { runServiceFromArgv } from "./server.ts"

process.exit(await runServiceFromArgv())
