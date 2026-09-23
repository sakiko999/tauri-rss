# xhs 签名调研：461 根因与升级参照（2026-08-14）

> 状态：**已调研，暂缓实现**。xhs:explore 翻页（homefeed API）与 xhs:user
> （user_posted API）依赖的 x-s 签名算法已过时，服务器拒绝（HTTP 461）。
> 本文件记录根因、有效参照（Python xhshow 0.2.0）与未来移植范围。

## 背景

- `xhs:explore` 翻页（Pageable）：SSR `/explore` 的 feed **无游标**（实测
  nextCursor/cursor/ssrRenderExtra 全空），滚动加载只能走
  `POST /api/sns/web/v1/homefeed`（cursor_score 游标，需 x-s 签名 + 登录 cookie）。
- 既有签名实现：`packages/xhshow/`（xhshow-js 的 MIT fork，mns0301 硬编码）。
- 目标：落地 explore 翻页；顺带 `xhs:user`（user_posted）也依赖同签名链路。

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

## 算法差异（0.2.0 vs 我们 fork）

源码在 `python -c "import xhshow,os;print(os.path.dirname(xhshow.__file__))"` 下：

- **POST 时 `m_value = md5(uri)`**（GET 才用 d_value）；我们 fork 的
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
   encoder，约 **600-900 行 TS**。替换 `vendor/xhshow.js` 的 signXS 路径，
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

**维护决策（记录，暂缓执行）**：倾向**放弃 xhs 签名 API 维护，xhs 降级为「SSR 匿名刷新」**：
1. `xhs:explore` 保持 SSR 匿名快照 + 刷新语义（与 weibo 同定位），**不做翻页**。
2. `xhs:user` 长期不可用（需签名 + b1 指纹，纯算法无解）。
3. explore 的 Pageable / homefeed / POST 签名代码**已回滚清理**（2026-08-14 /simplify）。
4. 若将来需要 xhs 深度数据，走**浏览器注入签名**（Playwright/WebView 取签名喂给 appHost）——另一个量级的架构投入，非当前目标。

## 现状代码（2026-08-14 /simplify 已回滚）

按「降级 SSR 匿名刷新」决策，xhs 分页代码已全部回滚：
- `explore.ts` 恢复纯 SSR fetch（非 Pageable）；
- `client.ts` 恢复纯 GET `signApiHeaders`，删除 `homefeed`/`homefeedBody`/`HomefeedPage`；
- `host.ts` 删除 `httpPostJson`。

若未来要移植新版 XYS_ 签名（让 homefeed 生效），按本文档「排障对照表 + 算法差异」
重新接入即可；响应结构 `data.items[].note_card`（下划线命名）+ `cursor_score` +
`has_more` 已记录，不需重新抓包。

## 运行时方案对比（原 sidecar-eval 文档结论，2026-09 并入）

签名若要跑，有几种载体。**结论：服务进程直接跑 CPython**（`desktop-crawler-service.md`
「签名恢复路径」）——原文档首推的 RustPython 嵌入，其**前提是移动端兼容**，而桌面
服务化决策后该前提消解；移动端本就不做 xhs（channel 环境标记裁掉）。

| 方案 | 生产可用 | 体积/开销 | 维护成本 | 备注 |
|---|---|---|---|---|
| **服务进程 CPython** ⭐ | ✅ | 随服务 | 低（跟上游 pip） | 桌面服务化的自然选择 |
| RustPython 嵌入 | ✅ 全平台 | 16MB 进程内 | 低 | 前提（移动端）已消解 |
| sidecar（PyInstaller） | ✅ 桌面 | 13-25MB + spawn | 低 | 需每平台打包链 + 进程管理 |
| wasm（pyodide） | ❌ | 10-15MB + 2-5s | 低 | 成本无优势 |
| 转译器（py2many） | ❌ | 几十 KB | 低 | 转换率不足，修复 > 手写 |
| TS 移植（抄 Python 0.2.0） | ✅ 全平台 | 几十 KB | **高**（1-3 月逆向一次） | 无运行时依赖 |

**战略障碍（所有运行时方案都不解决）**：
1. **灰度分发**——mns0101/mns0301 双路径 + x3 payload 变化 + 按账号/会话灰度，
   编译产物只对当前灰度有效。
2. **过时频率**——1 月~1 季度一改；运行时方案的收益是把「人工逆向 600-900 行 TS」
   换成「`pip install -U xhshow`」，**依赖上游持续维护**。
3. **b1 指纹死结**——若数据 API 后续强 b1（真实浏览器 localStorage），纯算法全无解。

## 社区现状复核（2026-09-23，因 App Store 出现第三方小红书客户端而复查）

**触发**：App Store 上架 `Rouge - Explore xiaohongshu`（Apple TV，$2.99，2026-08 上架，
1 天内仍在更新到 1.0.8）——功能含瀑布流/搜索/评论/直播，**支持登录与多账号切换**。
说明「第三方客户端」在 2026 年技术上可行（Apple 审核不查 API 合规，不能据此推断
官方态度转变）。

### ⚠️ 对我们旧结论的修正：当初「TS fork 过时」是**跟错了分支**

CLAUDE.md 记「原 TS fork 过时（2026-07 升级签名后 461）」——**属实，但归因不完整**：

| 分支 | 现状（2026-09-23 实测） |
|---|---|
| `renmu123/xhshow-js`（我们跟的 TS 移植） | **5 star，最后推送 2026-03-11** —— 确实停更 |
| `Cloxl/xhshow`（**Python 上游**） | **1080 star**，v0.2.0（2026-06-11）；支持 `x-s`/`x-s-common`/**`x-rap-param`**/`search_id`/`SessionManager` |

**即：TS 移植停滞 ≠ 纯算法路线夭折。** 活跃路线是 Python 上游，成本是「跟 pip 升级」。

### ⚠️ 但纯算法**当前正处失效期**（重要，勿高估）

- `Cloxl/xhshow` 有 **2026-09-13 未修复 issue「20260913 代码失效」**（上游最后提交
  2026-06-11，**已 3 个月无提交**）。
- **失效根因（社区已定位）**：加密核心（a3/payload）**仍正确**，只是
  `SIGNATURE_DATA_TEMPLATE` 版本号过旧——`x0="4.3.5"/x4="object"` 导致服务器对
  **翻页请求（非空 cursor）静默返回空 data**。修正为 `x0="4.4.3"`、`x4=""` 即可
  （无需 x5/x6/x7），首屏与翻页均 `code=0` 正常返回。
- 对照：`MediaCrawler`（65.6k star）**2026-09-19 仍在推送**，其 2025-10/11 后转向
  Playwright 浏览器自动化的策略维持。

### 值得记录的架构参考：`aki66938/XHS_RS_TOOLS`（147 star）

「**浏览器仅作登录/cookie 容器 + 日常请求纯算法**」的落地形态，与
`docs/desktop-crawler-service.md` 的切分结论一致且有生产验证：

1. 访客 Cookie：Docker 化 undetected-chromedriver（**极低频**）
2. 登录：二维码 create/poll/confirm **全走官方 API**（无需浏览器子进程）
3. 日常请求：Python Agent 提供 xhshow 实时签名（纯算法）
4. 会话持久化：cookie 存本地 JSON

（注：该项目自身最后推送 2026-01-26，其 Python Agent 依赖同上 xhshow 上游。）

### 结论：**维持不重启签名方案**

我们已选定「SSR 匿名 + 浏览器登录容器」，`xhs:explore` / 笔记详情匿名可用、
`xhs:user` 走浏览器滚动——**够用**。重启纯算法的收益仅是 `xhs:user` 分页转 HTTP，
代价是背上一份「1 月~1 季一失效、需跟上游」的依赖（且当前上游正失效中）。

**触发重启的条件**（满足其一再评估）：
- 上游恢复维护且连续 2 个版本稳定；
- 或 `xhs:user` 的浏览器路径被风控彻底堵死（届时至少还有 SSR 兜底的名录）。

## 附：Rouge(App Store 第三方客户端)逆向可行性评估（2026-09-23）

**背景**：App Store 出现 `Rouge - Explore xiaohongshu`（Apple TV，$2.99，2026-08-18
上架，仍在更新），含瀑布流/笔记+评论/视频页签/个人主页/多账号切换/访客模式。
开发者（V2EX `mdah233`）**自述**：①风控是真问题「开发过程中确实遇到…现在也在全力
解决」；②「接口变化频率不是很高」；③直播「暂时还不支持」；④海外 IP 扫码登录需在
App 设置里切地区。**全程未披露技术实现**（评论区问「怎么稳定抓取的」「官方提供接口
吗」「版权问题」均未回应）。

### 结论：**不建议逆向**（可发现性低 + 无法解决根本问题）

| 路径 | 可行性 | 说明 |
|---|---|---|
| 抓 App 流量 | ⚠️ 部分可行 | tvOS **不需越狱**即可装 CA + 手动代理（Apple Configurator 生成 `.mobileconfig` 导入；或 `设置→隐私→Share Analytics` 按遥控器触发隐藏 Profiles 菜单）。**但小红书 App 大概率做了证书固定**，pinning 下 mitmproxy 无法解密，需改包→又回到解密二进制 |
| 解密二进制 | ❌ 机型受限 | palera1n 支持 tvOS 15~26.x，**但仅 A8~A11**：Apple TV HD(A8) ✅、**ATV 4K 1st gen(A10X) ✅ 但需 GoldenEye+DCSD 两根特殊线**（~$25，AliExpress 到货 ~1 月）、**ATV 4K 2nd/3rd gen(A12/A15) ❌ checkm8 不覆盖** |
| 逆向所得 | — | 核心只是**签名算法**（`x-s`/`x-s-common`/`x-mini-*`）——**社区已开源**（见上文 xhshow）；Rouge 的真正价值在 tvOS 的 UI 适配（瀑布流/遥控器交互/视频页签），**与我们无关** |

**两个否定理由**：①可发现性低（要的部分社区已有，它独有的我们不缺）；
②**它自己也没解决风控**——逆向一个仍在挣扎的实现只会继承同样的困境。

### ⭐ 更有价值的发现：该领域已出现商业化的「常驻服务 + 账号池」形态

`Rnote API`（`rnote.dev` / `RedNote/Xiaohongshu-API`）——**22+ 端点**覆盖笔记/评论/
用户/搜索/商品/话题，**签名由服务端处理**（`x-mini-sig`/`x-mini-gid`/`x-mini-mua`/
`xy-common-params`/`xy-platform-info`，**APP 端**算法），并提供：

- **智能账号池**：多账号轮换、风控自动冷却、登录过期自动切设备、异常账号隔离
- **按次计费**（仅 HTTP 2xx 扣费）；**也卖服务端源码**（一次性买断，可私有化部署，
  含「请求签名 + 设备注册 + **验证码自动识别** + 注册登录/发布/评论私信/账号批量管理」）

**对我们的意义**：这印证了 `docs/desktop-crawler-service.md` 的切分方向（常驻服务 +
纯 HTTP 业务请求），但也暴露其**完整形态比我们设想的更重**——除签名外还需
**账号池 + 验证码识别**才能长期稳定。我们当前「SSR 匿名 + 浏览器仅作登录容器」
是**刻意选择更轻的路径**，代价是 `xhs:user` 分页受限。

⚠️ 同时注意：这类服务是**商业第三方**，接入等于把数据链路交给外部（与「本地抓取」
的产品定位冲突）；其自述的稳定性亦无从核实。
