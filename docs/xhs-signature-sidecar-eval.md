# xhs 签名 sidecar / wasm / RustPython / 转译器 生产可用性评估

> 承接 `docs/xhs-signature-research.md`（461 根因 + 降级决策）。本文件回答：
> 「能否把 Python xhshow 转成可接入本项目的形态（sidecar / wasm / RustPython 嵌入 /
> 自动转译器），生产可用？」——基于**本机实证**（2026-08-14/15）+ Tauri 官方现状。
> 结论：**RustPython 嵌入是最优（免手写 + 全链路实测通 + 移动端可行）；sidecar 桌面可用
> 移动端排除；wasm 不划算；转译器转换率不足。都不解决灰度/b1/过时频率根本问题。**

## 0. 实测前提（2026-08-14）

- TS fork（`packages/xhshow/vendor/xhshow.js`）+ 新 cookie → user_posted **6/6 全 461**。
- **Python xhshow 0.2.0 + 同一 cookie → user_posted 3/3 全 200，code:0，各 32 条**。
- 判定：cookie 有效（web_session 通），是 TS fork 算法本体过时（mns0301 x3 payload 变了）。
- ⚠️ **新观测**：当前灰度下 user_posted 不带 b1 指纹也 200 —— 与调研文档「data APIs
  缺 b1 返回 300011」存在张力，标记为**待观测**（可能 user_posted 非 b1 强依赖，或
  Python 0.2.0 的 x-s-common 生成碰巧被接受）。不影响本评估。

## 1. sidecar 实证（本机 PyInstaller 6.22 + Python 3.14 + xhshow 0.2.0）

最小 CLI（stdin/argv JSON → 签名 headers JSON）打包结果：

| 形态 | 体积 | 单次签名延迟（含进程启动） |
|---|---|---|
| 原生 python（基线） | — | **56ms** |
| PyInstaller **onefile** | **13MB** | 冷 749ms / 热 586-646ms（每次解压到临时目录） |
| PyInstaller **onedir** | **25MB** | **176-224ms**（免解压） |
| **长驻进程**（stdin/stdout 复用） | 25MB | **<10ms**（预估，仅 import 一次） |

- 产物签名正确（`XYS_` mns0301 路径），仅依赖 CPython 运行时 + 标准库
  （hashlib/random/json/urllib），**pycryptodome 未进产物**（签名核心路径不 import）。
- xhshow 是纯 Python 纯算法（手写 AES/CRC32/MD5），上游无 C 扩展强依赖 → 打包天然干净。

## 2. Tauri sidecar 机制与移动端（官方现状）

- Tauri 2 `bundle.externalBin` + `tauri-plugin-shell` `Command::new_sidecar`；
  产物按 target triple 命名（`xhs-sign-x86_64-pc-windows-msvc.exe`），每平台单独打包。
- **移动端官方明确不支持**：tauri issue #9774「sidecars are simply not supported on
  mobile」；业界实践（gptme）在 `tauri.ios/tauri.android.conf.json` 覆写 `externalBin:[]`。
  Android 需 hack（`.so` 命名 + kotlin ProcessBuilder），iOS 基本无解。
- **结论：sidecar 仅桌面（Windows/macOS/Linux）可分发，移动端直接排除。**

## 3. wasm 评估（pyodide / micropython-wasm）

| 路径 | 体积 | 初始化 | 结论 |
|---|---|---|---|
| **pyodide**（完整 CPython→wasm） | 核心 6.4MB / 完整 10-15MB | **2-5s**（首载） | 比 sidecar 更大更慢，webview 里无优势 |
| micropython-wasm | KB 级 | 快 | 标准库不全（hashlib/random 需自补），等于重写 |

- pyodide 纯 Python 慢原生 3-5x（对签名这种小计算无所谓，但启动 2-5s 是硬伤）。
- webview 需跨域隔离（COOP/COEP）头，Tauri webview 配置额外成本。
- **结论：wasm 在生产不划算**——体积/启动都劣于 sidecar，收益为零。

## 3b. RustPython 嵌入实证（2026-08-15）

**形态**：RustPython（Rust 实现的 Python 解释器）作为 crate 嵌入 tauri 的 Rust 层，
xhshow 的 `.py` 源码 + 2 个兼容补丁作为资源随应用分发。**进程内运行**（无 spawn 开销、
无进程管理），纯 Rust 可交叉编译到移动端。

**xhshow 的 RustPython 兼容性（已全链路验证）**：
- RustPython 原生支持 `hashlib.md5`/`struct`/`json`/`random`/`math`（纯 Rust 实现）。
- 两处无法加载 C 扩展（pycryptodome/ctypes），各打 ~10 行**等价补丁**（不碰算法逻辑）：
  - `utils/sharding.py`：`ctypes.c_int32` → 纯 Python `_int32`（9 输入 + 5 万随机对等价）
  - `generators/fingerprint.py`：`Crypto.Cipher.ARC4` → 纯 Python RC4（2000 组随机等价）
- **实测链路**：补丁版 xhshow（屏蔽 pycryptodome）→ RustPython 解释器跑签名 →
  真实请求 **200 code:0 notes:32**；原版/补丁版 x-s 逐字节一致。

**体积裁剪阶梯（本机实测）**：

| 方案 | 二进制 | pylib | 合计 |
|---|---|---|---|
| 全量 freeze-stdlib（自包含） | 30MB | 内置 | 30MB |
| 去 ssl + host_env | 17MB | 外带 ~2MB | ~19MB |
| **最小 features（stdlib/importlib/threading）** | **15MB** | 外带裁剪子集 1-2MB | **~16MB** |
| UPX 压缩分发 | 15MB→~6-8MB | — | 安装包层面 |

- **15MB 是解释器硬底**（VM+parser+编译器+Rust 原生模块+unwind 异常传播；去 threading/
  stdio/importlib 均因 VM 依赖或 import 机制失败）。`panic="abort"` 不可行——RustPython
  依赖 unwind 传播 Python 异常。
- 不 freeze 时 encodings 等纯 Python 模块需外部 pylib（`RUSTPYTHONPATH`）；接入时按
  xhshow 依赖裁剪 pylib 子集。
- 依赖版本：**crates.io 0.5.0 有 malachite-bigint 版本冲突编译不过**（作者 issue #3805
  建议 git main）；git main API 不稳（InterpreterBuilder/Scope 重构中）——接入需 pin
  修复后的 tag 或等 crates.io 修复版。

## 3c. Python→Rust 转译器实测（2026-08-15）

候选：py2many（Rust 生产级）/ depyler / rython / p2r / smelt。**实测 py2many 0.9 转
xhshow 核心算法**：

| 文件 | 转出 | 问题 |
|---|---|---|
| `core/crypto.py` | 162 行 | `_` 未推断类型 ×4、`SignState | None` 非法语法、依赖 py2many 私有运行时（pylib/struct/time crate） |
| `core/xyw_crypto.py` | 187 行 | 16 个未推断类型 |
| `utils/bit_ops.py` | 85 行 | rustfmt 跑不过（static/const 缺类型） |
| `core/crc32_encrypt.py` | **0 行** | 完全没转出 |
| `utils/encoder.py` | **0 行** | 完全没转出 |

**结论：转译器不可「开箱即用」**——xhshow 无类型注解 + 强标准库依赖（hashlib/bytes.
fromhex/struct），转译产物类型推断失败、依赖私有运行时、语法降级，**修复产物成本 >
手写**。适合「有完整注解的现代 Python」骨架，不适合逆向签名库。

## 4. 战略障碍（所有运行时方案都不解决）

1. **灰度分发**：mns0101/mns0301 双路径 + x3 payload 本体变化 + 按账号/会话灰度
   ——编译产物只对**当前灰度**有效，与 Python 0.2.0 实机一致，不增强。
2. **过时频率**：1 月~1 季度一改。sidecar 真实收益是把「人工逆向 600-900 行 TS」
   换成「`pip install -U xhshow` + 重新打包」，**依赖 Cloxl 持续维护**。
3. **b1 指纹死结**：若数据 API 后续强 b1（真实浏览器 localStorage），纯算法全无解。

## 5. 结论与推荐

| 方案 | 生产可用 | 桌面 | 移动 | 维护成本 | 备注 |
|---|---|---|---|---|---|
| **RustPython 嵌入** ⭐ | ✅ 全平台 | 16MB | ✅ 纯 Rust | 低（换 .py + 2 补丁） | 免手写、进程内、全链路已证 |
| sidecar（PyInstaller onedir/常驻） | ✅ 桌面可用 | 13-25MB + ~180-750ms | ❌ | 低（跟上游 pip） | 需每平台打包链 + 进程管理 |
| wasm（pyodide） | ❌ | 10-15MB + 2-5s | ⚠️ 理论可但重 | 低 | 成本全无优势 |
| 转译器（py2many 等） | ❌ | 几十 KB | ✅ | 低 | 转换率不足，修复 > 手写 |
| TS 移植（抄 Python 0.2.0） | ✅ 全平台 | 几十 KB | ✅ | 高（1-3 月逆向一次） | 无运行时依赖 |
| 降级 SSR（现状） | ✅ | 0 | ✅ | 无 | explore 匿名可用，user 不可用 |

**推荐**（按场景）：
- **首选：RustPython 嵌入**——唯一「免手写 + 全链路实测通 + 移动端可行」的方案。
  tauri Rust 层加 `rustpython` crate（pin 修复后版本），xhshow `.py` + 2 补丁作资源，
  appHost 加 `python` 门面（Rust 进程内跑，返回签名 headers）。体积 16MB，比 sidecar 优
  且进程内无 spawn 开销。前提：接受「每 1-3 月换 .py + 重打 2 补丁 + 当前灰度有效」。
- **仅桌面、想最快** → sidecar 也行（13-25MB + spawn 延迟），但架构上劣于 RustPython。
- **长期** → 算法灰度/过时是常态，任何方案都是「持续跟进上游」。RustPython 的定位是
  **把 xhs 从「废弃」降级为「低成本可选依赖」**，不是一劳永逸。

## 6. 落地要点（RustPython 首选 / sidecar 备选）

**RustPython 嵌入**：
- `apps/src-tauri` 加 `rustpython` crate 依赖（pin 修复后的 tag，避开 crates.io 0.5.0
  malachite bug 与 git main API 漂移）。
- xhshow `.py` 源码 + 2 处等价补丁（sharding/fingerprint，见 3b）作为资源文件；最小
  features（stdlib/importlib/threading）+ pylib 裁剪子集（encodings + xhshow 依赖模块）。
- Rust 侧暴露 `sign_xhs(uri, method, params, cookie) -> Headers` command，内部跑 Python
  解释器返回签名 headers（不依赖 print/stdio，直接读返回值）。
- crawler `platform/xhs/client.ts` 签名调用点从 JS fork 切到 appHost 门面；移动端
  （纯 Rust）同路径可用。

**sidecar 备选**：
- appHost 门面加 `python.call(code|fn|args)` 对称 js 门面；或 crawler 侧封装
  `xhsSignCli(uri, params, cookie)` → spawn sidecar → 解析 headers。
- 长驻进程模式：Tauri 启动时 spawn 一次，stdin/stdout 逐行 JSON，崩溃自动重启。
- externalBin 需在 `tauri.conf.json` 注册 + capabilities 加 `shell:allow-execute`；
  `tauri.conf.mobile.json` 覆写 `externalBin:[]`（移动端不打包）。

**版本策略（两者一致）**：跟随 xhshow 上游；失效（461）时 `pip install -U xhshow`
+ 重打补丁（sidecar 还须重打包），维护主动权在己方——优于 TS fork 的「等作者更新」。
