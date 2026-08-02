# Tauri Playground

Tauri 2 monorepo — RSS Reader，桌面 + 移动双端。

## 目录结构

```
apps/
  src-tauri/     ★ 唯一 Rust crate（tauri-app），桌面/移动共享 commands/plugins
  desktop/       前端（React 19 + Vite，产物 → dist/desktop）
  mobile/        前端（React 19 + Vite，产物 → dist/mobile）
packages/
  core/          @tauri-playground/core — 数据层（types / source/rss / live(4平台) /
                                          host / store / repo，经 PlatformHost 注入能力）
  ui/            @tauri-playground/ui   — UI 组件库
scripts/tauri.ts 统一脚本（dev/build/tauri，支持 desktop/mobile）
```

## 关键命令

```bash
bun run dev                  # Vite dev（纯前端）
bun run tauri                # Vite dev + Tauri dev 并行（完整应用热重载）
bun run tauri:build          # 前端构建 + release 构建
bun run scripts/tauri.ts help   # 查看全部用法
cd packages/core && bun test # core 单测（29 个：rss/media/live/types）
cd apps/src-tauri && cargo test --test http_get_network -- --ignored
                            # Rust http_get 网络集成测试（需 MSVC PATH + 先杀 tauri-app.exe）
```

前端产物输出到根 `dist/<platform>/`（Vite `outDir`），tauri.conf `frontendDist` 指向 `../../dist/<platform>`。

## ⚠️ 环境要求：MSVC linker（重要）

**必须从 "x64 Native Tools Command Prompt for VS 2022" 启动 VSCode / 终端**，否则 Rust 链接会失败。

### 坑：Git Bash 的 `link` 抢 MSVC

Git Bash 自带 `/usr/bin/link`（GNU 链接器），如果它在 PATH 里排在 MSVC 前面，cargo 链接时用它，会报：

```
/usr/bin/link: extra operand '...cgu.0.rcgu.o'
```

**解决**：确保 MSVC 的 `bin\Hostx64\x64` 在 PATH 最前（Native Tools 启动即自动前置）。

```bash
# 若从普通 bash 跑，手动前置 MSVC：
export PATH="/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64:$PATH"
```

> 本机实际版本：`/c/Program Files (x86)/Microsoft Visual Studio/18/BuildTools/VC/Tools/MSVC/14.51.36231/bin/Hostx64/x64`。
> **Bash 工具调用间 env 不持久**——每次 cargo 命令前都要内联 `export PATH`（写在同一条命令里）。

> 之前 `.cargo/config.toml` 硬编码过 linker 路径，已删除（硬编码 MSVC 版本号，VS 更新后必坏）。**不要在 cargo config 里写死 linker**，保持 PATH 方案。

### 验证当前环境

```bash
which link   # 应显示 MSVC 路径，而非 /usr/bin/link
```

## Git 提交身份

本机未配置全局 git 身份，直接 `git commit` 会报 `Author identity unknown`。提交时显式内联：

```bash
git -c user.name="zhh" -c user.email="zhonghuaremistinker@gmail.com" commit -m "..."
```

## 其他注意事项

- `bun test` 必须在 `packages/core` 下运行 —— 根目录会扫到 `tmp/`（独立项目）导致误报失败。
- tsc 用根 `./node_modules/.bin/tsc -p <项目>`（core/desktop/tsconfig.node.json 各自校验）；**不要** `npx tsc`（会误装 tsc@2.0.3），**不要**裸 `-p tsconfig.app.json`（扫全仓含 tmp/ 噪音）。
- cargo test/build 前若 tauri-app.exe 仍在运行会锁二进制报 `拒绝访问 (os error 5)`，先 `taskkill //F //IM tauri-app.exe`。
- `scripts/core-smoke.ts` 导入 core 必须走具体模块（`data-layer.ts`/`types/`），不能走 barrel —— barrel re-export 了依赖 DOM lib 的 browser-host，会污染 scripts 的 node tsconfig（tsconfig.node.json `lib: ["ESNext"]`）。
- `tmp/` 是独立的 media-sub 迁移源项目，已 gitignore，不要对它跑任何构建/测试。
- Rust 增量编译偶尔报 `拒绝访问 os error 5`，是无害警告，忽略。
- Tauri dev 的 `devUrl` 是 `http://localhost:1420`，脚本并行启动 Vite dev server + tauri dev。
- `apps/src-tauri/tauri.conf.json` 是桌面配置，`tauri.conf.mobile.json` 是移动端。
