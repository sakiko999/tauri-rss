# xhs 签名调研：461 根因与升级参照（2026-08-14）

> 状态：**已定：不重启签名方案**（2026-10-22 起 xhs 全渠道要求登录，explore/user
> 都走登录态浏览器，平台自己签名）。本文只记录 461 根因、签名频率证据与不重启的理由；
> 移植细节仅在触发条件满足时参考。

## 背景

- `xhs:explore` 翻页（Pageable）：SSR `/explore` 的 feed **无游标**（实测
  nextCursor/cursor/ssrRenderExtra 全空），滚动加载的请求由**页面自己**发
  `POST /api/sns/web/v1/homefeed`（平台签名）；我们只读滚动后的页面 state 增量，
  不自行构造签名请求。
- 既有签名实现：`packages/xhshow/`（**已从主分支移除**——主分支
  `resolve/src/platform/xhs/client.ts` 的 `signApiHeaders` 已降级为直接抛错；签名库在
  `feat/xhs-rustpython` 分支，主分支不维护，移植计划见文件末）。
- 结论：explore 翻页与 `xhs:user` 都改走登录态浏览器滚动（平台自己发请求并签名）；
  下面保留签名链路分析，只为回答「为什么不自己实现」。

## 排障过程（2026-08-14）

现象：homefeed 请求返回 `HTTP 461 | body: {"code":0,"success":true,"data":{},"msg":""}`。

| 试验 | 结果 | 结论 |
|---|---|---|
| 无签名 + Cookie | **406** `{"code":-1}` | IP/网络通，「无签名」被识别（预期） |
| TS fork 签名（homefeed） | **461** | 签名带了但不被接受 |
| TS fork 签名（user_posted） | **461** | 同上（共用签名链路） |
| explore SSR 匿名 | **正常**（31-33 feeds） | SSR 无需签名，通道 OK |
| node fetch 直连（绕过 host） | **461** | 与 host 后端无关 |
| 更新 cookie 后重试 | 仍 **461** | 与 cookie 会话无关 |
| 补 x-mns/xy-direction/Sec-Fetch-* 头 | 仍 **461** | 不是缺 header，是 x-s 本体 |
| **Python xhshow 0.2.0 签名（homefeed）** | **200** `code:0` + items + cursor_score | **有效参照** |

## 根因

小红书 **2026-07 底升级了签名算法**（cv-cat/Spider_XHS 26/07/25「更新全部算法」：
b1 会话级抖动、x-rap-param、X-S-Common 空 b1 阶段等）。我们的 `xhshow-js`
fork（2026-03 上游同步，`X3_PREFIX = "mns0301_"`）与上游 xhshow-js 仓库
（最新 2026-03-11）**算法同源、同样过时** —— 同步上游无意义。
有效的是 **Python 版 xhshow 0.2.0**（`pip install xhshow`，Cloxl 维护，全新架构）。

## 有效参照：Python xhshow 0.2.0

实测 `sign_headers_post` 返回 headers：

```
x-s, x-s-common, x-t, x-b3-traceid, x-xray-traceid, x-mns, xy-direction
```

- homefeed 请求只需 **XYS_ 签名**（无需 XYW_、x-rap-param）。
- 响应结构：`data.items[].note_card`（**下划线命名**：display_title/interact_info/
  nick_name，非 SSR 的驼峰 noteCard）+ `data.cursor_score` + `data.has_more`。
- 验证脚本范式（本机 Python 3.14）：
  ```bash
  pip install xhshow
  python - <<'EOF'
  from xhshow import Xhshow
  c = Xhshow()
  h = c.sign_headers_post(uri="/api/sns/web/v1/homefeed", payload={...}, cookies=cookie)
  h["Content-Type"]="application/json;charset=utf-8"; h["Cookie"]=cookie
  # urllib/requests POST edith.xiaohongshu.com/api/sns/web/v1/homefeed → 200
  EOF
  ```

## 算法差异（0.2.0 vs 已删除的旧 TS fork）

（对照对象已不在主分支，仅在触发重启时作移植参考。）

源码在 `python -c "import xhshow,os;print(os.path.dirname(xhshow.__file__))"` 下：

- **POST 时 `m_value = md5(uri)`**（GET 才用 d_value）；旧 fork 的
  `buildPayloadArray(d_value, a1, appId, stringParam, ts)` 无 m_value 概念。
- **sign_state/session** 参与 `build_payload_array`（SessionManager/SignState）。
- `x-s-common` / `xy-direction`（utils/sharding.py MurmurHash3）算法更新。
- **`sign_xyw`（XYW_ 前缀，AES-128-CBC）**：注释明说「user_posted、otherinfo 等
  数据接口会拒绝 XYS_（HTTP 406），需 XYW_」——`xhs:user` 复活必须它。
- 核心文件：config(164) + core/crypto(162) + core/crc32_encrypt(125) +
  core/common_sign(49) + utils/sharding(59) + utils/bit_ops(82) + utils/encoder(110)
  + client 的 sign_xs 部分。

## 移植范围（未来工作）

1. **最小（落地 explore 翻页）**：新版 XYS_ 签名 —— config + crypto
   （build_payload_array/xor/encode_x3）+ common_sign + sharding + bit_ops +
   encoder，约 **600-900 行 TS**。落地时替换 `packages/resolve/src/platform/xhs/client.ts` 里 `signApiHeaders` 的抛错实现，
   补 x-mns（常量 "unload"）与 xy-direction。**半天-1 天**。
2. **完整（复活 xhs:user）**：+ XYW_（core/xyw_crypto，406 行，需 AES-128-CBC
   依赖）。user_posted 当前 XYS_ 必 406/461。

## 签名升级频率与维护成本（2026-08-14 调研）

**结论：xhs 签名约 1 个月～1 季度一改，且带灰度分发，纯算法维护成本高、难以为继。**

频率证据：
- **月度级**：Cloxl/xhshow（签名库作者）issue 里用户直言「小红书真的是一个月变一次算法」，作者本人回应「没法第一时间跟进」。
- **季度级**：2025-10 爬虫文章总结「x-s 签名算法季度更新、动态 Cookie 10 分钟过期、风控每周都在升级」。
- **cv-cat/Spider_XHS changelog**：25/07 version56 → 26/04/11 签名升级 → 26/04/28 加 search_id/x-rap-param → 26/07/25 更新全部算法。约每 3-4 个月一次大改。
- **本仓库实测**：fork 基于 2026-03 的 mns0301，2026-08-14 即 461 → 约 5 个月失效，属常态非偶然。

灰度分发（Cloxl issue #104，2026-03）：
- 签名路径**按账号/会话灰度**：`_webmsxyw`（纯 JS，mns0101 前缀，XYW_ 输出）vs `seccore_signv2`（WASM，mns0301，XYS_ 输出），且 `x3` payload 本体也会变——**即使移植最新算法也可能只对部分账号/IP 有效**，连 Cloxl 自己都还在观察未完全跟进。
- **b1 指纹死结**：data APIs 因 X-S-Common 缺合法 `b1` 设备指纹返回 `300011`，而 **b1 需真实浏览器在 localStorage 生成**，纯算法方案天生缺一环。

社区动向：MediaCrawler 在 2025-10/11 连续签名失效后**整体转向 Playwright 浏览器自动化**（「无需 JS 逆向，通过 JS 表达式获取签名参数」），放弃纯算法维护——用脚投票。

**维护决策（已定）**：放弃 xhs 签名 API 维护，xhs 走「登录态 SSR + 浏览器滚动」：
1. `xhs:explore` 读登录态页面 SSR（2026-10-22 起要求登录；翻页为滚动驱动、读页面 state 增量），
   **不走我们自己的 homefeed 签名 API**。
2. `xhs:user` 走浏览器滚动翻页（页面自己发 user_posted 并签名），不依赖纯算法签名。
3. homefeed / POST 签名代码已清理（2026-08-14 /simplify）；explore 的 Pageable 由浏览器滚动实现，不依赖签名。
4. 若将来需要 xhs 深度数据，走**浏览器注入签名**（Playwright/WebView 取签名喂给 appHost）——另一个量级的架构投入，非当前目标。

## 现状代码

- `crawler/src/channels/xhs/explore.ts`：登录态浏览器 SSR 读取 + 滚动 `fetchMore`（Pageable）+ `fetchPassive`；无浏览器宿主报「需要浏览器」。
- `client.ts` 的 `signApiHeaders` 保留签名但直接抛错（签名实现不在主分支）；homefeed 相关代码已删。

若未来要移植新版 XYS_ 签名（让 homefeed 生效），按本文档「排障对照表 + 算法差异」
重新接入即可；响应结构 `data.items[].note_card`（下划线命名）+ `cursor_score` +
`has_more` 已记录，不需重新抓包。

## 运行时方案

签名载体结论见 `docs/architecture/crawler-topology.md`「签名恢复路径」（服务进程直接跑 CPython + `pip install xhshow`，失效时 `pip install -U xhshow`）；RustPython/sidecar/wasm 的对比已由此决策吸收。

## 社区结论

2026-09 复查：TS fork 停更 ≠ 纯算法路线夭折，但 Python 上游当时自身失效——加密核心仍
正确，只是 `SIGNATURE_DATA_TEMPLATE` 版本号过旧（`x0="4.3.5"` → `"4.4.3"`、`x4=""`）；
MediaCrawler 已转 Playwright。

结论仍是**维持不重启签名**——重启纯算法的收益仅是 `xhs:user` 分页转 HTTP，代价是背一份
「1 月~1 季一失效、需跟上游」的依赖。触发重启的条件：上游连续 2 个版本稳定，或
`xhs:user` 的浏览器路径被彻底堵死（届时仍有 SSR 名录兜底）。
