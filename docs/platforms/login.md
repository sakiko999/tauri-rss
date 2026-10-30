# 平台扫码登录 + 保活调研（bili / weibo / xhs / douyin）

> 2026-08 调研。目标：应用内扫码登录获取**完整认证信息** + **定期保活**，
> 替代「浏览器手抄 cookie 串」的临时方案。参考 `tmp/dart_simple_live` 的 B 站
> 登录模块；weibo/xhs/douyin 接口为网络调研，实现细节以代码为准。
> ⚠️ **落地状态（2026-10-27）**：四个平台**扫码登录均已实现**（`resolve/platform/{bili,weibo,xhs,douyin}/login.ts`，
> 经 channel 级 `Loginable` 暴露；桌面 `dl.scanLogin`、CLI `rss login`）；**保活调度全未做**——
> 本文 §4 是唯一的设计依据。

## 结论速览

| 平台 | 扫码登录 | 签名要求 | 拿到的认证信息 | 可自动保活 |
|---|---|---|---|---|
| bili | ✅ 纯 HTTP，无签名 | 无 | SESSDATA / bili_jct / DedeUserID / **refresh_token**（响应体；当前只在登录返回值里，未落库） | ⚠️ 可实现但未做：bili_ticket 惰性续 + refresh_token 续 SESSDATA |
| weibo | ✅ 走 CDP（passport 登录页自带二维码，轮询 `SUB` cookie） | 无 | SUB / SUBP / SSOLoginState / SCF / ALF | ⚠️ SUB ~1 年，无刷新接口，到期重登 |
| xhs | ✅ 走 CDP（首页点「登录」读弹窗二维码，轮询 `user_id`/页面登录位） | 无（浏览器路径绕开） | web_session / a1 / gid / webId（**1 年有效**） | ⚠️ 1 年有效，无刷新接口，到期重登；⚠️ **web_session 游客也会下发，不能当登录判据**（2026-10-19 实测/社区复核） |
| douyin | ✅ 纯 HTTP 优先（sso 通行证），被 TLS 风控拦时回退 CDP | 无 | sessionid / ttwid 等（`sessionid` 为登录判据） | — 未调研 |

四平台扫码登录全部可行；**只有 bili 支持真·自动续期**（但**尚未实现**），weibo/xhs 是
「长效 cookie + 到期重登」模式（1 年/1 年，低频维护，可接受）；douyin 保活未调研。

---

## 1. bilibili

### 扫码登录流程（dart_simple_live `qr_login_controller.dart` 完整参考）

```
1. GET https://passport.bilibili.com/x/passport-login/web/qrcode/generate
   → { data: { url, qrcode_key } }         # url 是二维码内容(含 qrcode_key)

2. 轮询(每 2s) GET https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=...
   data.code:
     0    → 登录成功! 从响应 Set-Cookie 头收集全套 cookie
             (SESSDATA / bili_jct / DedeUserID / DedeUserID__ckMd5 / sid)
     86038 → 二维码过期(重开)
     86090 → 已扫描,待手机确认

3. 验证 GET https://api.bilibili.com/x/member/web/account  (带 cookie)
   code==0 → 拿 uid/uname,登录态确认
```

**⚠️ dart 遗漏的关键点**：登录成功时 poll 响应体 `data` 里还有 **`refresh_token`**
（dart 只收集了 Set-Cookie，没存它）。refresh_token 是 SESSDATA 续期凭证——
**应用内实现必须额外捕获并持久化**，否则 SESSDATA 180 天到期只能重登。

### 保活

- **bili_ticket（3 天 JWT）自动续**：纯 HTTP、匿名、固定密钥，见下。
- **SESSDATA（180 天）续期**：用 refresh_token 调
  `POST https://passport.bilibili.com/x/passport-login/web/cookie/refresh`
  （需实测确认参数：csrf=bili_jct + refresh_token）。刷新后 Set-Cookie 返回新
  SESSDATA，续期 180 天。可做到期前自动续，实现真正「免登长期保活」。

### bili_ticket 刷新（已确认接口）

```
POST https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket
参数: key_id=ec02
      hexsign = hmac_sha256("XgwSnGZ1p", "ts" + <unix秒>)
      context[ts] = <unix秒>
      csrf = bili_jct(可空)
响应: data.ticket (JWT) + data.ttl (259200 = 3 天)
```

匿名可调（Referer 空或 .bilibili.com 子域）。固定密钥 `XgwSnGZ1p`、HMAC-SHA256，
比 wbi/abogus 简单一个量级。替换 cookie 串里的 `bili_ticket` + `bili_ticket_expires` 即可。

---

## 2. weibo

### 扫码登录流程（CDP，已实现）

1. 导航 `https://passport.weibo.com/sso/signin?...disp=popup`（weibo/login.ts:20-21）。
2. 读页面自带的 `v2.qr.weibo.cn/inf/gen` 二维码 img → 经 `appHost.http` 取字节转 data URL（直接 `<img src>` 会被 WebView 存储限制拦掉）。
3. 轮询 `SUB`（HttpOnly，只能 `getAllCookies` 读）出现 = 成功，`SUBP` 作 user_id；已在 profile 里登录则直接短路。

> 旧「qrcode/image + JSONP + crossDomainUrlList」流程未采用，已删除。

### 保活

- **SUB 有效期 ~1 年**（`ALF` 字段是 auto-login flag，值≈到期时间戳）。
- 无公开刷新接口，**到期重登**（扫码即可）。1 年一次，低频可接受。

---

## 3. xiaohongshu

### 扫码登录流程（CDP，已实现）

1. 已登录（页面 `user.loggedIn` / 侧栏「我」）直接短路。
2. 点首页「登录」按钮 → 等登录弹窗的 data URL 二维码 → `emitQr` 推给 UI。
3. 轮询 `user_id` cookie 相对基线变化 / 页面登录位翻转 = 成功，再取全量 cookie（含 HttpOnly `web_session`）。

> `web_session` 不是登录判据（游客也签发）；原「qrcode/create + 轮询 status」API 流程需要 x-s 签名，从未采用。
>
> **两个「扫码没生效」坑（2026-10-30 修）**：① login lane 的 tab 跨扫码复用，
> 入口导航**必须强制重载**，否则读到失效前渲染的 `user.loggedIn=true` 会短路成
> 「已登录（无需重复扫码）」并把旧 cookie 写回去；② 弹窗里的码过期后页面只剩
> 「二维码已过期 点击刷新」——过期码**不能推给 UI**（手机扫了直接失效），出码前与
> 轮询中都要检查过期状态、重载换新码。新码 30s 内出不来就报错，不再静默等满 5 分钟。
> 服务端 session 被顶下线时页面给的是「电脑设备登录超限，请重新登录」（平台侧，
> 重新扫码会把旧设备踢掉），xhs 渠道的 SSR 未就绪错误会直接把这个状态翻译出来。

### 保活

- `web_session` **Max-Age=31536000 = 1 年**（实测 apifox 返回的 set-cookie）。
- 无刷新接口，**到期重登**（扫码即可）。1 年一次，低频可接受。

---

## 4. 过期影响 → 续期策略（设计依据）

两个 token 的过期代价不在一个量级，决定了续期调度完全不同：

| 凭证 | 过期后果 | 性质 | 续期调度 |
|---|---|---|---|
| **bili_ticket**（3 天） | 请求仍全通，仅**风控概率升高**（wbi 接口更易 -412、更易验证码）。非必需（bilibili-API-collect：「存在可降低风控概率」「没发现多少风控价值」）。 | 软性风控因子 | **宽松惰性**：请求路径查 `bili_ticket_expires`，临期/过期即刷。**匿名可刷、零失败成本，不需要定时任务**。 |
| **SESSDATA**（180 天） | **登录态整体失效**：未登录 code:-101、bili:dynamic 返空、视频档位降级 720P。（直播弹幕匿名可用——2026-09 实测更正，详见 `docs/playback/danmaku.md`。） | 硬性登录凭证 | **严格闭环**：refresh_token 与 SESSDATA **同寿命**(~180 天)，`cookie/refresh` 续期成功**双双重置** → 每个 180 天窗口内成功续一次即**永久有效**。启动检查 + 定期(如每 60 天)主动续；续期失败(双双过期)→「待重登」态。 |

**设计原则**：
1. bili_ticket 不做定时任务——软性因子，随取随补最省。
2. SESSDATA 才是「保活」对象——登录时必须捕获 refresh_token（resolve 已取到），**并持久化**；当前 core `scanLogin` 只落 cookie、未存 refreshToken，闭环仍缺最后一环（dart 漏这步 → 只能失效重登）。
3. **所有平台统一兜底 = 失效检测**：请求层识别登录失效（bili `code:-101` / weibo 432 / xhs 461）→ 标记凭证过期 → 引导重登（扫码登录即重登动作）。

## 5. 应用内落地架构建议

```
packages/resolve/src/platform/<平台>/login.ts   # 扫码登录(如 biliScanLogin / weiboScanLogin /
                                        # xhsScanLogin / douyinScanLogin),经 channel 级 Loginable 暴露

apps/desktop/src/views/manage/AccountPage.tsx  # 每平台一张卡:手填/保存/清除 cookie + 扫码登录
                                        # (QrImage 渲染 emitQr 的 data URL)

packages/core/src/types/settings.ts   # 仍是 flat 字段 bilibiliCookie/weiboCookie/xhsCookie/douyinCookie
                                        # (字段名由 @amoeba/platform 定义);结构化凭证对象未实现

保活调度:
  bili  → 惰性(请求前查 bili_ticket_expires < now+1d 则刷新) + 定期用 refresh_token 续 SESSDATA
          (均未实现;SESSDATA 到期前 7d 续,接口参数待实测)
  weibo/xhs → 到期检测(解析 expiresAt), 到期提示重登
```

- **二维码渲染**：`qrcode`（desktop 已依赖）在前端把 `emitQr` 的 data URL 画成图（`components/QrImage.tsx`）。
- **浏览器依赖**：xhs/weibo 登录必须经抓取浏览器（CDP）；mobile 已冻结（2026-10-26），登录只在桌面/服务端。
- **凭证安全**：cookie + refresh_token 属敏感凭证，存 localStorage/settings 前需
  评估（桌面本地应用可接受，但避免进 git）。

### 启动 cookie 快照同步（2026-10-23 已落地）

扫码只在成功时把 cookie 写一次 settings；浏览器 profile 会随访问轮换 cookie，而 HTTP
路径（weibo 长文展开 `/statuses/extend`、热搜词搜索）读的是 settings 快照。数据服务
boot（`READY`）后 1.5s 由服务进程跑 `DataLayer.syncBrowserCookies()`（`--no-cookie-sync` 可关）；桌面经 service-client 的同名方法已是 no-op（返回 []），桌面不再维护浏览器 profile。

- **只读**：`browser.getCookies`（含 HttpOnly），不导航、不发平台请求。
- **xhs 标记 = `id_token`**：`web_session` 对游客也签发；`user_id` 可能残留/短信登录不种。
  实测匿名 Edge 会话没有 `id_token`，扫码登录的 profile 有。
- **weibo 优先 `https://m.weibo.cn`**（`WB_BASE` 消费域），缺失才回落 `weibo.com`；
  不合并两域（扁平 Record 会丢同名 SUB/SUBP 的域信息）。
- **douyin 标记 = `sessionid`**（`ttwid` 匿名也签发）；域取 `https://www.douyin.com`。
  抖音桌面侧没有浏览器数据路径（直播流解析/主页全是 HTTP + `douyinCookie()`），
  2026-10-30 才补上这一步 —— 在此之前浏览器里换号/重登都不会回流 settings。
- **消费方门槛**：只处理**有启用订阅**的平台；只有 `weiboCookie` 是「值得单独拉起
  浏览器」的桌面 HTTP 消费方。`xhsCookie`（xhs 全走浏览器，settings 只剩账号页展示）
  与 `douyinCookie` 都只在浏览器已因 weibo 被拉起时**顺带**同步，不为它们单独启动
  —— 抖音只有订阅、没有 weibo/xhs 订阅时，启动**不会**同步 douyinCookie（扫码当时
  写的那份继续用）。bili 不参与（纯 HTTP，无登录态字段）。
- **只读不改坏**：浏览器无登录标记时**不清空** settings（无法区分登出与 profile 重置）；
  读+写在 `withBrowserOpSlot` 内与「清除凭证/清理浏览器数据」互斥；写经
  `setIfUnchanged` 原子比对（比对与写入同一串行临界区），期间用户保存/扫码写过就放弃。
- **存储边界**：快照写入服务自己的 settings；CLI 本地探针（自带 `apps/cli/.data/rss.db`）
  与已冻结的 mobile 各持独立 settings，拿不到这份快照。
- 代价：有启用的 xhs/weibo 订阅时，服务启动会拉起一次隐藏 WebView2（活跃约 472MB private，
  关图后更低；空闲 3 分钟整树回收，`node/browser-sidecar.ts` 的 `IDLE_CLOSE_MS`，下次抓取
  ~0.3s 重建）；只有停用/无订阅的平台不会拉起。
- 自检：`bun packages/core/src/example/cookie-sync.check.ts`。

---

## 6. 待实测确认项

- [ ] bili `cookie/refresh` 续期接口的精确参数（refresh_token 是否够、是否需 csrf）。
- [ ] 扫码出码本身尚未在「未登录 profile」下实测（现有 profile 已登录走的是短路）：用 `rss --service --profile-dir <空目录>` 验。

## 来源

- B 站: `tmp/dart_simple_live/simple_live_app/lib/modules/mine/account/bilibili/qr_login_controller.dart`
  + bilibili-API-collect 仓库的 `misc/sign/bili_ticket.md`
- weibo / xhs: 实现以 `packages/resolve/src/platform/{weibo,xhs}/login.ts` 的 CDP 路径为准；
  2026-08 调研的纯 HTTP 接口（sina qrcode JSONP、小红书 qrcode/create）均未采用，来源不再列出。
