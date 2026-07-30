/**
 * Tauri Playground 统一脚本
 * Usage:
 *   bun run dev [desktop|mobile]
 *   bun run build [desktop|mobile]
 *   bun run tauri [desktop|mobile] [build]
 */

import { $ } from "bun";

const [, , command, platform = "desktop", flag] = process.argv;

const PLATFORMS = ["desktop", "mobile"] as const;
if (!PLATFORMS.includes(platform as any)) {
  console.error(`❌ 未知平台: "${platform}"，可用: ${PLATFORMS.join(", ")}`);
  process.exit(1);
}

const ROOT = import.meta.dir + "/..";
const APP_DIR = `${ROOT}/apps/${platform}`;
const SRC_TAURI = `${ROOT}/apps/src-tauri`;

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

      console.log(`▶ 前端构建 (${platform})`);
      cd(APP_DIR);
      await $`bun run build`;

      console.log(`▶ Tauri ${tauriCmd} (${platform})`);
      cd(SRC_TAURI);
      await $`bunx tauri ${tauriCmd} ${config}`;
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