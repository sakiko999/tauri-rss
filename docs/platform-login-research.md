# 平台扫码登录 + 保活调研（bili / weibo / xhs）

> 2026-08 调研。目标：应用内扫码登录获取**完整认证信息** + **定期保活**，
> 替代当前「浏览器手抄 cookie 串」的临时方案。参考 `tmp/dart_simple_live` 的 B 站
> 登录模块；weibo/xhs 接口为网络调研（来源见文末）。

## 结论速览

| 平台 | 扫码登录 | 签名要求 | 拿到的认证信息 | 可自动保活 |
|---|---|---|---|---|
| bili | ✅ 纯 HTTP，无签名 | 无 | SESSDATA / bili_jct / DedeUserID / **refresh_token**（响应体，dart 没拿） | ✅ bili_ticket 3 天自动续 + SESSDATA 用 refresh_token 续期 |
| weibo | ✅ 纯 HTTP，JSONP 解析 | 无 | SUB / SUBP / SSOLoginState / SCF / ALF | ⚠️ SUB ~1 年，无刷新接口，到期重登 |
| xhs | ✅ 需 x-s 签名（**已有 xhshow**） | x-s / x-t / x-s-common | web_session / a1 / gid / webId（**1 年有效**） | ⚠️ 1 年有效，无刷新接口，到期重登 |

三平台扫码登录全部可行；**只有 bili 支持真·自动续期**，weibo/xhs 是「长效 cookie +
到期重登」模式（1 年/1 年，低频维护，可接受）。

---

## 1. bilibili

### 扫码登录流程（dart_simple_live `qr_login_controller.dart` 完整参考）

```
1. GET https://passport.bilibili.com/x/passport-login/web/qrcode/generate
   → { data: { url, qrcode_key } }         # url 是二维码内容(含 qrcode_key)

2. 轮询(每 3s) GET https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=...
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
**应用内实现必须额外捕获**，否则 SESSDATA 180 天到期只能重登。

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

### 扫码登录流程（web 端，纯 HTTP + JSONP 解析）

```
1. GET https://login.sina.com.cn/sso/qrcode/image?entry=weibo&size=180&callback=STK_{ts}
   → JSONP 包裹: { data: { qrid, image } }        # image 是二维码图 URL, qrid 是轮询键

2. 轮询(每 5s) GET https://login.sina.com.cn/sso/qrcode/check?entry=weibo&qrid={qrid}&callback=STK_{ts}
   retcode:
     50114001 → 未使用(继续等)
     50114002 → 已扫码,待手机确认
     50114004 → 已失效(重开)
     20000000 → 成功! data.alt = 登录跳转凭证

3. GET https://login.sina.com.cn/sso/login.php?entry=weibo&returntype=TEXT&crossdomain=1&cdult=3&domain=weibo.com&alt={alt}&savestate=30&callback=...
   → 返回 crossDomainUrlList(4 个跨域 URL)

4. 依次访问 crossDomainUrlList[0..2](第 2 个 URL 需追加 &action=login),
   session 累积 Set-Cookie → 得到 SUB / SUBP / SSOLoginState / SCF / ALF 等完整 cookie

5. 验证: GET https://account.weibo.com/set/aj/iframe/schoollist?...  → code==100000 有效
```

无任何加密签名（qrid/alt 明文），只需解析 `STK_xxx(...)` JSONP 包裹。比 PC 端
密码登录（RSA 逆向 su/sp）简单得多。

### 保活

- **SUB 有效期 ~1 年**（`ALF` 字段是 auto-login flag，值≈到期时间戳）。
- 无公开刷新接口，**到期重登**（扫码即可）。1 年一次，低频可接受。

---

## 3. xiaohongshu

### 扫码登录流程（接口公开，需要 x-s 签名）

```
1. 前置: 拿匿名 a1(签名种子) + 匿名 cookie 会话
   - a1 可由 xhshow 的 generateA1() 生成(已导出,纯算)
   - 或 GET /api/sns/web/v1/login/activate 注册会话(需签名)

2. POST https://edith.xiaohongshu.com/api/sns/web/v1/login/qrcode/create
   headers: x-s/x-t/x-s-common(用已有 xhshow 签名) + 匿名 cookie(a1/webId/gid)
   body:   { "qr_type": 1 }
   → { data: { url, qr_id, code } }              # url 是二维码内容(含 qr_id/code)

3. 轮询 GET https://edith.xiaohongshu.com/api/sns/web/v1/login/qrcode/status?qr_id={qr_id}&code={code}
   data.code_status:
     1 → 已扫码,未确认
     2 → 扫码成功!
     3 → 已失效
   data.login_info: { session(=web_session), secure_session, user_id }

4. 组装 cookie: 响应体 cookie + 轮询/响应 Set-Cookie 的 web_session(拼接)
   → web_session / a1 / gid / webId / websectiga / sec_poison_id 等完整串
```

**关键**：签名不是障碍——`packages/xhshow` 已有 `Client.signXS/signXSCommon`
（`signApiHeaders` 已在 `platform/xhs/client.ts` 封装）。扫码流程只需复用现有签名
门面，新增 login 端点。

### 保活

- `web_session` **Max-Age=31536000 = 1 年**（实测 apifox 返回的 set-cookie）。
- 无刷新接口，**到期重登**（扫码即可）。1 年一次，低频可接受。

---

## 5. 过期影响 → 续期策略（设计依据）

两个 token 的过期代价不在一个量级，决定了续期调度完全不同：

| 凭证 | 过期后果 | 性质 | 续期调度 |
|---|---|---|---|
| **bili_ticket**（3 天） | 请求仍全通，仅**风控概率升高**（wbi 接口更易 -412、更易验证码）。非必需（bilibili-API-collect：「存在可降低风控概率」「没发现多少风控价值」）。 | 软性风控因子 | **宽松惰性**：请求路径查 `bili_ticket_expires`，临期/过期即刷。**匿名可刷、零失败成本，不需要定时任务**。 |
| **SESSDATA**（180 天） | **登录态整体失效**：未登录 code:-101、bili:dynamic 返空、直播弹幕被服务器拒(1006)、视频档位降级 720P。 | 硬性登录凭证 | **严格闭环**：refresh_token 与 SESSDATA **同寿命**(~180 天)，`cookie/refresh` 续期成功**双双重置** → 每个 180 天窗口内成功续一次即**永久有效**。启动检查 + 定期(如每 60 天)主动续；续期失败(双双过期)→「待重登」态。 |

**设计原则**：
1. bili_ticket 不做定时任务——软性因子，随取随补最省。
2. SESSDATA 才是「保活」对象——登录时**必须捕获 refresh_token**（dart 漏了这步 → 只能失效重登），否则无法闭环。
3. **所有平台统一兜底 = 失效检测**：请求层识别登录失效（bili `code:-101` / 弹幕 1006 / weibo 432 / xhs 461）→ 标记凭证过期 → 引导重登（扫码登录即重登动作）。

## 6. 应用内落地架构建议

```
crawler/src/platform/<平台>/login.ts   # 扫码登录纯函数: createQR() / poll() / assembleCookie()
                                        # (无状态,复用各自 client 的请求/签名能力)

apps/desktop/src/...                   # 登录 Dialog: qrcode 库渲染二维码 → 轮询状态 →
                                        # 成功回调(拿完整 cookie + refresh_token)

core/src/settings.ts                   # 认证对象扩展: 平台登录凭证(非裸 cookie 串)
                                        # { cookie, refresh_token?, expiresAt? }
                                        # 取代/升级现有 settings.bilibiliCookie 等

保活调度:
  bili  → 惰性(请求前查 bili_ticket_expires < now+1d 则刷新) + 定期跑刷新脚本
          SESSDATA 到期前 7d 用 refresh_token 续期(需实测接口)
  weibo/xhs → 到期检测(解析 expiresAt), 到期提示重登
```

- **二维码渲染**：qrcode 库（desktop 现有依赖栈可加，纯前端）。
- **WebView/CSP**：请求走 `appHost.http` 隧道（Rust），签名走 `appHost.js`——与现有
  crawler 能力一致，登录流程在桌面/移动端同一套代码可跑。
- **凭证安全**：cookie + refresh_token 属敏感凭证，存 localStorage/settings 前需
  评估（桌面本地应用可接受，但避免进 git）。

---

## 7. 待实测确认项

- [ ] bili `cookie/refresh` 续期接口的精确参数（refresh_token 是否够、是否需 csrf）。
- [ ] bili poll 成功响应体 `data.refresh_token` 字段名（以实测为准）。
- [ ] weibo `qrcode/image` 当前是否仍可用（2026-08，接口较老，需验证 retcode 语义）。
- [ ] weibo 扫码可能触发**验证码拦截**（部分账号风控），落地需处理。
- [ ] xhs `qrcode/create` 对 xhshow 签名版本（xhs-pc-web）的兼容性实测。
- [ ] xhs 匿名会话初始化（login/activate vs generateA1 + 首访 cookie）选哪条路。

## 来源

- B 站: `tmp/dart_simple_live/simple_live_app/lib/modules/mine/account/bilibili/qr_login_controller.dart`
  + bilibili-API-collect `docs/misc/sign/bili_ticket.md`
- 微博: CSDN《Python扫码登录保存和验证cookies值——微博篇》、github ext2ed/sina-qrcode-login
- 小红书: CSDN《小红书扫码登录协议分析》(2024-10)、知乎《python获取小红书web_session》(2023-07)、
  github submato/xhscrawl、apifox 二维码登录接口文档
