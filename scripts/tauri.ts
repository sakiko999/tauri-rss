/**
 * Tauri Playground 统一脚本
 * Usage:
 *   bun run dev [desktop|mobile]           — 只启动 Vite dev server
 *   bun run build [desktop|mobile]         — 只构建前端
 *   bun run tauri [desktop|mobile]         — Vite dev server + Tauri dev（并行，热重载）
 *   bun run tauri [desktop|mobile] build   — 前端构建 + Tauri release 构建
 */

import { $ } from "bun";
import { spawn, execSync } from "child_process";

const [, , command, platform = "desktop", flag] = process.argv;

const HELP = `
RSS Reader 调试脚本
用法:
  bun run dev [desktop|mobile]           只启动 Vite dev server（纯前端调试）
  bun run build [desktop|mobile]         只构建前端产物
  bun run tauri [desktop|mobile]         Vite dev + Tauri dev 并行（完整应用，热重载）
  bun run tauri [desktop|mobile] build   前端构建 + Tauri release 构建

平台默认 desktop；移动端需先配置好 Android/iOS 工具链。
`;

const PLATFORMS = ["desktop", "mobile"] as const;
if (
  command === "help" || command === "--help" || command === "-h" ||
  platform === "--help" || platform === "-h"
) {
  console.log(HELP);
  process.exit(0);
}

if (!PLATFORMS.includes(platform as any)) {
  console.error(`❌ 未知平台: "${platform}"，可用: ${PLATFORMS.join(", ")}`);
  console.log(HELP);
  process.exit(1);
}

const ROOT = import.meta.dir + "/..";
const APP_DIR = `${ROOT}/apps/${platform}`;
const SRC_TAURI = `${ROOT}/apps/src-tauri`;

/**
 * 并行启动多个长驻进程（如 Vite dev server + Tauri dev）。
 * 任一进程退出即整体退出，信号转发给子进程。
 *
 * 清理细节(Windows):`shell: true` 时子进程是 cmd 壳,`child.kill()` 只杀壳,
 * 其下 bun → node 链(Vite 实际运行时)不会被带走 → 残留进程占 1420 端口、
 * 锁二进制。因此 Windows 上用 `taskkill /T` 连子树强杀。
 */
function spawnParallel(cmds: { cmd: string; args: string[]; cwd: string; label: string }[]) {
  const children = cmds.map(({ cmd, args, cwd, label }) => {
    console.log(`▶ ${label}`);
    return spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  });

  /** 杀一个子进程树:Windows 用 taskkill /T /F,其余平台走普通 kill。 */
  function killTree(c: ReturnType<typeof spawn>): void {
    if (c.killed || !c.pid) return;
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /F /T /PID ${c.pid}`, { stdio: "ignore" });
        return;
      } catch {
        // taskkill 失败(进程已退)则 fallthrough 到普通 kill。
      }
    }
    c.kill();
  }

  let exited = false;
  function onExit(code: number | null) {
    if (exited) return;
    exited = true;
    console.log(`\n⏹ 进程退出 (${code ?? "signal"})，终止其余进程`);
    children.forEach(killTree);
    process.exit(code ?? 0);
  }

  children.forEach((c) => {
    c.on("close", (code) => onExit(code ?? 0));
    c.on("error", (err) => {
      console.error(`\n❌ ${err.message}`);
      onExit(1);
    });
  });

  // 转发 Ctrl+C / SIGTERM
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      children.forEach(killTree);
      process.exit(0);
    });
  }
}

async function main() {
  switch (command) {
    case "dev":
      console.log(`▶ Vite dev (${platform})`);
      cd(APP_DIR);
      await $`bun run dev`;
      break;

    case "build":
      console.log(`▶ 前端构建 (${platform})`);
      cd(APP_DIR);
      await $`bun run build`;
      break;

    case "tauri": {
      const tauriCmd = flag === "build" ? "build" : "dev";
      const config = platform === "mobile"
        ? ["--config", `${SRC_TAURI}/tauri.conf.mobile.json`]
        : [];

      if (tauriCmd === "dev") {
        // dev 模式：并行启动 Vite dev server + Tauri dev（Tauri 会等待 devUrl 就绪）
        spawnParallel([
          {
            cmd: "bun",
            args: ["run", "dev"],
            cwd: APP_DIR,
            label: `Vite dev (${platform})`,
          },
          {
            cmd: "bunx",
            args: ["tauri", "dev", ...config],
            cwd: SRC_TAURI,
            label: `Tauri dev (${platform})`,
          },
        ]);
      } else {
        // build 模式：先构建前端，再 Tauri release 构建
        console.log(`▶ 前端构建 (${platform})`);
        cd(APP_DIR);
        await $`bun run build`;

        console.log(`▶ Tauri build (${platform})`);
        cd(SRC_TAURI);
        await $`bunx tauri build ${config}`;
      }
      break;
    }

    default:
      console.error("❌ 未知命令，可用: dev | build | tauri");
      process.exit(1);
  }
}

function cd(dir: string) {
  process.chdir(dir);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
