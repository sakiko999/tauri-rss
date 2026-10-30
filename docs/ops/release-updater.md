# 发布与自动更新

## 分发形态

Windows 只发 **NSIS 安装包**（`bundle.targets: ["nsis"]`）：

- 产物 `Amoeba_<version>_x64-setup.exe`，**按当前用户安装**到 `%LOCALAPPDATA%\Amoeba`，
  不需要管理员权限（NSIS 默认 `installMode: currentUser`）。
- **不是 MSIX**：Tauri 2 没有 MSIX bundle target。
- **不是 portable**：Tauri 不提供便携包目标；`target/release/amoeba.exe` 虽然能单独运行，
  但没有安装记录，`tauri-plugin-updater` 无法替换/升级它。
- **不要同时发布 MSI**：MSI 是 per-machine 安装，和 NSIS 是两条安装记录；
  `latest.json` 只能指向一种安装器，混发会让更新链断掉或重复安装。

## 组件

| 位置 | 作用 |
| --- | --- |
| `apps/src-tauri/tauri.conf.json` → `plugins.updater` | 公钥、更新源、Windows 安装模式（`passive`） |
| `apps/src-tauri/Cargo.toml` | `tauri-plugin-updater` / `tauri-plugin-process`（仅桌面三平台） |
| `apps/src-tauri/src/plugins/mod.rs` | `#[cfg(desktop)]` 注册两个插件 |
| `packages/host/src/tauri/updater-backend.ts` | appHost 的 `updater` 能力（check/download/relaunch） |
| `apps/desktop/src/lib/update.ts` | 启动静默检查 + 结果缓存 |
| `apps/desktop/src/views/manage/settings/About.tsx` | 「设置 → 关于与更新」手动检查与进度 |
| `.github/workflows/release.yml` | 打 tag 自动构建、签名、发布 Release + latest.json |

更新源固定为：

```
https://github.com/sakiko999/tauri-rss/releases/latest/download/latest.json
```

`latest.json` 由 tauri-action 生成，包含版本、下载 URL 与 `.sig` 内容。客户端下载安装包后
由 Rust 侧用配置里的公钥校验签名，校验失败不会安装。

## 签名密钥

- 私钥：`~/.tauri/amoeba.key`（**不入库**）；公钥：`~/.tauri/amoeba.key.pub`，
  内容写在 `tauri.conf.json` 的 `plugins.updater.pubkey`。
- CI 使用仓库 secret `TAURI_SIGNING_PRIVATE_KEY`（当前私钥无密码）。
- 2026-10-26：公钥**已轮换**（旧 `55477786…` → 新 `397EFB52…`），`tauri.conf.json` 与
  GitHub secret 已同步；本机新增 `.sig` 验证通过。⚠️ 轮换前发布的安装包无法用新签名升级。
- ⚠️ **私钥丢失 = 所有已安装用户永远收不到更新**；换公钥同样等于旧安装包全部弃更
  （2026-10-26 就这么轮换过一次）。备份私钥文件。
- ✅ 已开启 `plugins.updater.requireSignedVersion`：Tauri CLI 2.12+ 会把应用版本写进
  签名的 trusted comment（实测 `.sig` 内含 `version:<当前应用版本>`）。这样即使 `latest.json`
  被篡改、把 version 写成新高版本并指向旧的合法签名包，也会因签名版本不符被拒。
  ⚠️ 若把 CLI 降级到 2.12 以下，必须同时关掉它，否则更新会以 `MissingSignedVersion` 失败。
- 生成（已有则跳过）：

```powershell
bunx tauri signer generate --ci -w "$HOME\.tauri\amoeba.key"
```

- 更新 secret：

```powershell
Get-Content -Raw "$HOME\.tauri\amoeba.key" | gh secret set TAURI_SIGNING_PRIVATE_KEY
```

## 发版步骤

1. 同步改版本号（前两处必须一致，决定产物与 `latest.json`）：
   - `apps/src-tauri/tauri.conf.json` → `version`
   - `apps/src-tauri/Cargo.toml` → `[package] version`
   - 其余 workspace 包（根 / desktop / mobile / cli）的 `version` 建议一并同步，
     但不影响发布产物。CI 会断言 tag 必须等于 `v<tauri.conf version>`。
2. 提交后打 tag 并推送：

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

3. GitHub Actions（`release` workflow）在 `windows-latest` 上：
   `bun install` → **`bun run tauri:build`**（内含前端构建 + service:build + runtime/browser
   的 release 构建 + `tauri build --config tauri.conf.release.json`）→ 创建 Release 并上传
   `*-setup.exe`、`*.sig`、`latest.json`。
   ⚠️ CI 不跑 `bun run tauri:build` 本身，而是逐步复刻它：`build:desktop` → `service:build`
   → `cargo build --release -p amoeba-runtime -p amoeba-browser` → tauri-action 带
   `--config tauri.conf.release.json`（三件资源靠这个 overlay 的 `bundle.resources` 进包）。
   改其中任一环节必须两处同步，否则打出来的包缺资源、装完起不来（v0.7.0 事故）。
4. 已安装用户下次启动（或手动「设置 → 关于与更新」）即可检测到新版本。

## 待补：发布门禁（2026-10-26 事故后记）

v0.7.0 发了一个启动即「应用数据初始化失败」的包：CI 既没构建服务三件，也没叠加
`tauri.conf.release.json`（`bundle.resources` 只写在那里）。已修 release.yml（见
`0ecb1a2`），但**还没有自动门禁**，靠人记得。补齐项（处理 CI 时一并做）：

1. 构建后断言安装包内容含 `service/service.js`、`amoeba-runtime.exe`、`amoeba-browser.exe`
   （`7z l *-setup.exe` 三条 grep，缺一即 fail）。
2. 断言 `tauri build` 真的加载了 release 配置（漏 `--config` 时 resources 静默为空，
   与 0.7.0 同症状）。
3. 打 tag 前的本地验收清单加一条：「解包安装包确认三件」，不再只看体积。

## 本地验证（打 tag 前）

VSCode 的 **「Tauri Release (true production)」** 调试入口只做 `vite build`（PROD）+
`tauri build --no-bundle` 后直接运行 `target/release/amoeba.exe`（不启动 dev server、
不开 9222、用生产库 `rss.db`、无测试种子；release 无调试符号，断点不可用）。
它只验证运行时行为，**不产出安装包/签名**；要验证发布产物仍按下面的命令。

必须在带 MSVC 的终端（或 `vcvars64.bat`）里执行，并注入私钥：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$HOME\.tauri\amoeba.key"
bun run tauri:build   # = vite build + service:build + cargo build --release runtime/browser + tauri build --config tauri.conf.release.json
```

预期产物(根 `Cargo.toml` 是 workspace,所以 target 在**仓库根**):

```
target/release/bundle/nsis/Amoeba_0.7.0_x64-setup.exe
target/release/bundle/nsis/Amoeba_0.7.0_x64-setup.exe.sig
```

注意：

- 本地验证只证明「能构建 + 能签名」；真正走 `check → 下载 → 安装` 需要至少一个带
  `latest.json` 的 Release。首次发布后，把版本号 +1 再发一版即可端到端验证。
- `tauri.conf.json` 里的 `bundle.targets` 已是 `["nsis"]`，本地不会产出 MSI。
