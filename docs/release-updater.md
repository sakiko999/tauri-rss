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
- ⚠️ **私钥丢失 = 所有已安装用户永远收不到更新**（公钥无法更换）。备份私钥文件。
- ✅ 已开启 `plugins.updater.requireSignedVersion`：Tauri CLI 2.12+ 会把应用版本写进
  签名的 trusted comment（实测 `.sig` 内含 `version:0.1.0`）。这样即使 `latest.json`
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
git tag v0.2.0
git push origin v0.2.0
```

3. GitHub Actions（`release` workflow）在 `windows-latest` 上：
   `bun install` → 前端构建 → `tauri build`（NSIS + 签名）→ 创建 Release 并上传
   `*-setup.exe`、`*.sig`、`latest.json`。
4. 已安装用户下次启动（或手动「设置 → 关于与更新」）即可检测到新版本。

## 本地验证（打 tag 前）

必须在带 MSVC 的终端（或 `vcvars64.bat`）里执行，并注入私钥：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$HOME\.tauri\amoeba.key"
bun run build:desktop
cd apps/src-tauri
bunx tauri build
```

预期产物(根 `Cargo.toml` 是 workspace,所以 target 在**仓库根**):

```
target/release/bundle/nsis/Amoeba_0.1.0_x64-setup.exe
target/release/bundle/nsis/Amoeba_0.1.0_x64-setup.exe.sig
```

注意：

- 本地验证只证明「能构建 + 能签名」；真正走 `check → 下载 → 安装` 需要至少一个带
  `latest.json` 的 Release。首次发布后，把版本号 +1 再发一版即可端到端验证。
- `tauri.conf.json` 里的 `bundle.targets` 已是 `["nsis"]`，本地不会产出 MSI。
