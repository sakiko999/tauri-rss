/**
 * Tauri Playground 统一脚本 — functional core / imperative shell。
 *
 * 函数式组织（不依赖数据管道，依赖「纯函数核心 + I/O 隔离」思想）：
 *   - 纯函数核心（无副作用、可单测）：parseArgs 参数解析 → planFor 命令即数据
 *     （返回声明式执行计划，只描述「做什么」，不做任何 I/O）
 *   - I/O shell（副作用隔离）：execute 解释执行计划（runOnce / spawnParallel）
 *   - main 组合：parse → validate → plan → execute
 *
 * 收益：决策逻辑（参数校验/命令路由/平台分支）可脱离进程单独验证；
 *       spawn/taskkill/exit 等副作用集中在 shell 层，不散落。
 *
 * Usage:
 *   bun run dev [desktop|mobile]           — 只启动 Vite dev server
 *   bun run build [desktop|mobile]         — 只构建前端
 *   bun run tauri [desktop|mobile]         — Vite dev + Tauri dev 并行（热重载）
 *   bun run tauri [desktop|mobile] build   — 前端构建 + Tauri release 构建
 */
import { $ } from "bun";
import { spawn, execSync } from "child_process";

type Platform = "desktop" | "mobile";

/** 单条命令的声明式描述（数据，未执行）。 */
interface CmdSpec {
  label: string;
  cmd: string;
  args: string[];
  cwd: string;
}

/** 执行单元：单条前台命令，或一组并行长驻进程。 */
type Execution =
  | { kind: "once"; spec: CmdSpec }
  | { kind: "parallel"; specs: CmdSpec[] };

const PLATFORMS = ["desktop", "mobile"] as const;
const ROOT = import.meta.dir + "/..";
const APP = (p: Platform) => `${ROOT}/apps/${p}`;
const SRC_TAURI = `${ROOT}/apps/src-tauri`;
/** 移动端 dev/build 走独立 tauri.conf.mobile.json。 */
const TAURI_CFG = (p: Platform) => (p === "mobile" ? ["--config", `${SRC_TAURI}/tauri.conf.mobile.json`] : []);

const HELP = `
RSS Reader 调试脚本
用法:
  bun run dev [desktop|mobile]           只启动 Vite dev server（纯前端调试）
  bun run build [desktop|mobile]         只构建前端产物
  bun run tauri [desktop|mobile]         Vite dev + Tauri dev 并行（完整应用，热重载）
  bun run tauri [desktop|mobile] build   前端构建 + Tauri release 构建

平台默认 desktop；移动端需先配置好 Android/iOS 工具链。
`;

// ── 纯函数核心：参数 → 执行计划（无 I/O）────────────────────

/** 命令描述工厂（纯数据）。 */
const viteDev = (p: Platform): CmdSpec => ({ label: `Vite dev (${p})`, cmd: "bun", args: ["run", "dev"], cwd: APP(p) });
const viteBuild = (p: Platform): CmdSpec => ({ label: `前端构建 (${p})`, cmd: "bun", args: ["run", "build"], cwd: APP(p) });
const tauriDev = (p: Platform): CmdSpec => ({ label: `Tauri dev (${p})`, cmd: "bunx", args: ["tauri", "dev", ...TAURI_CFG(p)], cwd: SRC_TAURI });
const tauriBuild = (p: Platform): CmdSpec => ({ label: `Tauri build (${p})`, cmd: "bunx", args: ["tauri", "build", ...TAURI_CFG(p)], cwd: SRC_TAURI });

/** 解析 argv → 命令意图。纯函数。 */
function parseArgs(argv: string[]): { command?: string; platform?: string; flag?: string } {
  return { command: argv[2], platform: argv[3], flag: argv[4] };
}

/** 是否请求帮助。纯函数。 */
function wantsHelp(a: { command?: string; platform?: string }): boolean {
  return (
    a.command === "help" || a.command === "--help" || a.command === "-h" ||
    a.platform === "--help" || a.platform === "-h"
  );
}

/** 命令意图 → 执行计划。纯函数（只描述，不执行）。 */
function planFor(command: string, platform: Platform, flag?: string): Execution[] {
  switch (command) {
    case "dev":
      return [{ kind: "once", spec: viteDev(platform) }];
    case "build":
      return [{ kind: "once", spec: viteBuild(platform) }];
    case "tauri":
      return flag === "build"
        ? [
            { kind: "once", spec: viteBuild(platform) },
            { kind: "once", spec: tauriBuild(platform) },
          ]
        : [{ kind: "parallel", specs: [viteDev(platform), tauriDev(platform)] }];
    default:
      throw new Error(`未知命令，可用: dev | build | tauri`);
  }
}

// ── I/O shell：解释执行计划（副作用集中在此）────────────────

/** 单条前台命令：bun $ 的 .cwd() 局部定位，不污染全局 cwd。 */
async function runOnce(spec: CmdSpec): Promise<void> {
  console.log(`▶ ${spec.label}`);
  await $`${spec.cmd} ${spec.args}`.cwd(spec.cwd);
}

/**
 * 并行启动多个长驻进程，任一退出即整体退出。
 * ⚠️ Windows 子树清理:shell:true 时 child.kill() 只杀 cmd 壳,其下 bun→node 链
 * (Vite 实际运行时)会残留,占 1420 端口 / 锁二进制 → 用 taskkill /T 连子树强杀。
 */
function spawnParallel(specs: CmdSpec[]): void {
  const procs = specs.map((s) => {
    console.log(`▶ ${s.label}`);
    return spawn(s.cmd, s.args, { cwd: s.cwd, stdio: "inherit", shell: process.platform === "win32" });
  });

  const killTree = (p: ReturnType<typeof spawn>) => {
    if (!p.pid || p.killed) return;
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /F /T /PID ${p.pid}`, { stdio: "ignore" });
        return;
      } catch {
        /* taskkill 失败(进程已退) → fallthrough 到普通 kill。 */
      }
    }
    p.kill();
  };

  let done = false;
  const onExit = (code: number | null) => {
    if (done) return;
    done = true;
    console.log(`\n⏹ 进程退出 (${code ?? "signal"})，终止其余进程`);
    procs.forEach(killTree);
    process.exit(code ?? 0);
  };

  procs.forEach((p) => {
    p.on("close", (c) => onExit(c ?? 0));
    p.on("error", (e) => {
      console.error(`\n❌ ${e.message}`);
      onExit(1);
    });
  });
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      procs.forEach(killTree);
      process.exit(0);
    });
  }
}

/** 顺序解释执行计划：once 前台等完成；parallel 阻塞到进程组退出。 */
async function execute(plan: Execution[]): Promise<void> {
  for (const step of plan) {
    if (step.kind === "once") await runOnce(step.spec);
    else spawnParallel(step.specs); // parallel 靠进程事件整体退出，不等返回
  }
}

// ── main：parse → validate → plan → execute ────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (wantsHelp(args)) {
    console.log(HELP);
    return;
  }
  const platform = (args.platform ?? "desktop") as Platform;
  if (!PLATFORMS.includes(platform)) {
    console.error(`❌ 未知平台: "${args.platform}"，可用: ${PLATFORMS.join(", ")}`);
    console.log(HELP);
    process.exit(1);
  }
  const plan = planFor(args.command ?? "", platform, args.flag);
  await execute(plan);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
