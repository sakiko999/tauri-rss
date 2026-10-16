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
const MOBILE_CFG = (p: Platform) => (p === "mobile" ? ["--config", `${SRC_TAURI}/tauri.conf.mobile.json`] : []);
/**
 * dev 额外叠 tauri.conf.dev.json(只开 CDP 调试端口 9222)。
 * ⚠️ 端口**不加进 tauri.conf.json**:那里是 release 构建用的,带上等于给发布版开一个
 * 无鉴权的远程调试口 —— 本机任意进程 attach 后能读改 localStorage 与 SQLite 里的 cookie。
 */
const DEV_CFG = (p: Platform) => [
  ...MOBILE_CFG(p),
  ...(p === "desktop" ? ["--config", `${SRC_TAURI}/tauri.conf.dev.json`] : []),
];

const HELP = `
Amoeba 调试脚本
用法:
  bun run dev [desktop|mobile]             只启动 Vite dev server（纯前端调试）
  bun run build [desktop|mobile]           只构建前端产物
  bun run tauri [desktop|mobile]           Vite dev + Tauri dev 并行（完整应用，热重载）
  bun run tauri [desktop|mobile] --release 同上，但 **Rust 以 release 编译**（见下）
  bun run tauri [desktop|mobile] build     前端构建 + Tauri release 构建

⚠️ --release 的用途：调试「**只在 release 下才走**」的行为。目前唯一的例子是
**隐藏 Edge 窗口**（browser.rs 的 \`hide = !cfg!(debug_assertions)\` 是编译期判据）——
普通 tauri dev 跑 debug profile，那条分支永远不走。--release 保留热重载但按
release 编译，首次会全量编译数分钟。

平台默认 desktop；移动端需先配置好 Android/iOS 工具链。
`;

// ── 纯函数核心：参数 → 执行计划（无 I/O）────────────────────

/** 命令描述工厂（纯数据）。 */
const viteDev = (p: Platform): CmdSpec => ({ label: `Vite dev (${p})`, cmd: "bun", args: ["run", "dev"], cwd: APP(p) });
const viteBuild = (p: Platform): CmdSpec => ({ label: `前端构建 (${p})`, cmd: "bun", args: ["run", "build"], cwd: APP(p) });
/**
 * `--release` → `tauri dev --release`：**Rust 以 release 优化编译**，但仍保留 Vite dev
 * server 与热重载。用来调试「只在 release 下才走」的行为。
 *
 * ⚠️ 关键用例 = **隐藏 Edge 窗口**：`browser.rs` 的 `let hide = !cfg!(debug_assertions)`
 * 是**编译期**判据 —— debug profile 下窗口可见（好观察），release 下 SW_HIDE + 循环隐藏。
 * 想验隐藏路径**必须**跑 release 编译，普通 `tauri dev` 永远看不到那条分支。
 *
 * ⚠️ 与 `tauri build` 的区别：这个**不产出安装包**、不跑 frontendDist（仍走 devUrl）。
 * 首次跑要全量 release 编译（数分钟）；之后增量。
 */
const tauriDev = (p: Platform, release = false): CmdSpec => ({
  label: `Tauri dev (${p}${release ? " --release" : ""})`,
  cmd: "bunx",
  args: ["tauri", "dev", ...DEV_CFG(p), ...(release ? ["--release"] : [])],
  cwd: SRC_TAURI,
});
const tauriBuild = (p: Platform): CmdSpec => ({ label: `Tauri build (${p})`, cmd: "bunx", args: ["tauri", "build", ...MOBILE_CFG(p)], cwd: SRC_TAURI });
/** RSSHub sidecar:desktop 订阅源,`bun run tauri` 时随 Vite+Tauri 一并带起(独立 Node 进程,自起 1200 端口)。 */

/**
 * 解析 argv → 命令意图。纯函数。
 *
 * ⚠️ **flag 不按位置取**：`bun run tauri desktop --release` 里 argv[2]=desktop、
 * argv[3]=--release；而 `bun run tauri --release` 里 argv[2]=`--release`。
 * 按位置硬取会把 `--release` 当成平台名。故先摊平再按语义挑。
 */
function parseArgs(argv: string[]): { command?: string; platform?: Platform; release: boolean; help: boolean } {
  const rest = argv.slice(2)
  const help = rest.some((a) => a === "--help" || a === "-h" || a === "help")
  const release = rest.includes("--release")
  // ⚠️ `command` 要排除 `--help`/`help`，否则 `bun run tauri help` 会被当成未知命令。
  const command = rest.find((a) => !a.startsWith("-") && a !== "help")
  const platform = rest.find((a) => PLATFORMS.includes(a as Platform)) as Platform | undefined
  return { command, platform, release, help }
}

/** 命令意图 → 执行计划。纯函数（只描述，不执行）。 */
function planFor(command: string, platform: Platform, opts: { release: boolean } = { release: false }): Execution[] {
  switch (command) {
    case "dev":
      return [{ kind: "once", spec: viteDev(platform) }];
    case "build":
      return [{ kind: "once", spec: viteBuild(platform) }];
    case "tauri":
      // `--release` → Rust 以 release 编译（调「只在 release 走」的分支，如隐藏 Edge 窗口）。
      return [{ kind: "parallel", specs: [viteDev(platform), tauriDev(platform, opts.release)] }];
    case "build-release":
      return [
        { kind: "once", spec: viteBuild(platform) },
        { kind: "once", spec: tauriBuild(platform) },
      ];
    default:
      throw new Error(`未知命令，可用: dev | build | tauri | build-release`);
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
  if (args.help) {
    console.log(HELP);
    return;
  }
  const platform = args.platform ?? "desktop";
  if (!PLATFORMS.includes(platform)) {
    console.error(`❌ 未知平台: "${platform}"，可用: ${PLATFORMS.join(", ")}`);
    console.log(HELP);
    process.exit(1);
  }
  const plan = planFor(args.command ?? "", platform, { release: args.release });
  await execute(plan);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
