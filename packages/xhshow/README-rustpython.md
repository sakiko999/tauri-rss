# xhshow（RustPython 调整版）

> 本目录是 [Cloxl/xhshow](https://github.com/Cloxl/xhshow)（Python 小红书签名库）的
> **fork，针对 RustPython 嵌入调整**。保留上游完整 git 历史；差异仅两处等价补丁
> （见下），不修改算法逻辑。
>
> 背景：`packages/xhshow` 原为 xhshow-js 的 TS fork，2026-07 底小红书升级签名算法后
> 已过时（HTTP 461）。改为 RustPython 跑 Python 上游，跟随 Cloxl 维护。

## RustPython 兼容补丁（2 处，已验证等价）

RustPython 无法加载 C 扩展（pycryptodome）且 ctypes 支持弱，两处打纯 Python 等价补丁：

| 文件 | 原实现 | 补丁 | 等价验证 |
|---|---|---|---|
| `src/xhshow/utils/sharding.py` | `ctypes.c_int32`（32 位乘法） | 纯 Python `_int32`/`_imul` | 9 输入 + 5 万随机对一致 |
| `src/xhshow/generators/fingerprint.py` | `Crypto.Cipher.ARC4`（pycryptodome） | 纯 Python `_rc4_encrypt`（RC4） | 2000 组随机 key/data 一致 |

两者均不改变签名输出（原版/补丁版 x-s 逐字节一致，实测 user_posted 200 notes:32）。

## 运行（RustPython）

```bash
# rustpython 二进制需 freeze-stdlib 或外部 pylib
PYTHONPATH="$PWD/src" rustpython -c "
from xhshow import Xhshow
c = Xhshow()
h = c.sign_headers_get('/api/sns/web/v1/user_posted', cookies={'a1':'...'}, params={'num':'30'})
print(h['x-s'])
"
```

## 与 crawler 对接（TODO）

- crawler `platform/xhs/client.ts` 原 import TS fork `@tauri-playground/xhshow` 已降级
  （xhs:user 签名暂弃，461 本就用不了；explore SSR 保留）。
- 待接入：tauri Rust 层嵌入 rustpython crate（见 `docs/xhs-signature-sidecar-eval.md`
  3b 节），appHost 加 `python` 门面，crawler 签名调用点改为跑本仓库 Python 版。
- 升级：上游更新时 `git pull` 上游 → 重打上述 2 补丁（若上游改动这两处）。

## 上游同步

```bash
git remote -v          # origin 指向 Cloxl/xhshow(或你的 fork)
git fetch upstream && git rebase upstream/master
```
