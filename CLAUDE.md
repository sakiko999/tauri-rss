# Tauri Playground

Tauri 2 monorepo — RSS Reader，桌面 + 移动双端。

## 目录结构

```
apps/
  src-tauri/     ★ 唯一 Rust crate（tauri-app），桌面/移动共享 commands/plugins
  desktop/       前端（React 19 + Vite，产物 → dist/desktop）
  mobile/        前端（React 19 + Vite，产物 → dist/mobile）
packages/
  core/          @tauri-playground/core — 数据层（types/parser/store/queries）
  ui/            @tauri-playground/ui   — UI 组件库
scripts/tauri.ts 统一脚本（dev/build/tauri，支持 desktop/mobile）
```

## 关键命令

```bash
bun run dev                  # Vite dev（纯前端）
bun run tauri                # Vite dev + Tauri dev 并行（完整应用热重载）
bun run tauri:build          # 前端构建 + release 构建
bun run scripts/tauri.ts help   # 查看全部用法
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

> 之前 `.cargo/config.toml` 硬编码过 linker 路径，已删除（硬编码 MSVC 版本号，VS 更新后必坏）。**不要在 cargo config 里写死 linker**，保持 PATH 方案。

### 验证当前环境

```bash
which link   # 应显示 MSVC 路径，而非 /usr/bin/link
```

## 其他注意事项

- Rust 增量编译偶尔报 `拒绝访问 os error 5`，是无害警告，忽略。
- Tauri dev 的 `devUrl` 是 `http://localhost:1420`，脚本并行启动 Vite dev server + tauri dev。
- `apps/src-tauri/tauri.conf.json` 是桌面配置，`tauri.conf.mobile.json` 是移动端。
