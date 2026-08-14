# core 层登录态架构（实施蓝图）

> 2026-08 规划。目标：core 层引入**认证子系统**，支撑应用内扫码登录获取完整认证
> + 定期保活，替代「浏览器手抄 cookie 串」临时方案。登录协议/保活接口调研见
> `docs/platform-login-research.md`。
>
> 已确认决策：① 凭证独立 storage key「auth」（不与 UI 偏好混存）；② 平台归属由
> crawler channel 声明（不再字符串前缀猜）；③ DEFAULT_*_COOKIE 保留为「未登录降级」；
> ④ 本蓝图落 docs。

## 1. 现状诊断（为什么现在是「堆砌」）

core 层现状：

```
DataLayer (createDataLayer，无参，访问 globalThis.appHost)
├── subscriptions / reading / settings 三个 repo（storage 各一 key，load JSON + save 全量）
├── store: MediaStore（内存）
├── refresh / resolvePlay / resolveLivePlay / resolveHotWord
└── sourceInfoFor: 按 channelKey.startsWith("bili:") 合并 settings 里 3 个 cookie 串
```

登录态相关仅 3 处，且都接不住认证：

| # | 问题 | 后果 |
|---|---|---|
| 1 | 凭证与 UI 偏好混存（`AppSettings` 同对象同 key） | 凭证无独立生命周期；`reset` 一起清 |
| 2 | 平台归属靠 `channelKey.startsWith()` 猜 | 新平台要改 core 硬编码；语义脆弱 |
| 3 | cookie 是裸字符串，无 refresh_token/过期/状态 | bili_ticket 惰性刷、SESSDATA 续期无承载对象 |
| 4 | 无失效检测（refresh catch 只记 log） | 432/461/-101/1006 无法触发「引导重登」 |
| 5 | 保活逻辑无处安放 | 无认证服务概念 |

## 2. 目标架构：`core/auth/` 认证子系统

```
core/
  auth/
    types.ts            PlatformId / PlatformCredential 判别联合 / CredentialStatus
    credential-repo.ts  凭证持久化（storage "auth"，独立于偏好）
    login-service.ts    LoginService：扫码编排 + 凭证生命周期 + 保活 + 失效检测
  data-layer.ts         改造：sourceInfoFor 从 auth 取 cookie；catch AuthError → 标记失效
  types/settings.ts     移除 3 个 cookie 字段（凭证迁到 auth），只留 UI 偏好
```

### 凭证类型（判别联合，平台差异显式建模）

```ts
type PlatformId = "bili" | "weibo" | "xhs"        // 未来 + "douyin" | "youtube"
type CredentialStatus = "valid" | "expired" | "needsLogin"

interface BiliCredential {
  platform: "bili"
  cookie: string
  status: CredentialStatus
  updatedAt: number
  refreshToken: string            // 扫码登录 poll 响应体捕获（dart 参考漏了这步）
  biliTicketExpires?: number      // 惰性刷新检测点
  sessdataExpires?: number        // 续期窗口检测点
}
interface LongLivedCredential {
  platform: "weibo" | "xhs"
  cookie: string
  status: CredentialStatus
  updatedAt: number
  expiresAt?: number              // SUB / web_session 均 ~1 年
}
type PlatformCredential = BiliCredential | LongLivedCredential
```

### LoginService（core 编排，crawler 提供协议）

```ts
interface LoginService {
  beginLogin(platform: PlatformId): Promise<{ qrId: string; qrContent: string }>
  poll(platform: PlatformId, qrId: string): Promise<"scanning" | "confirmed" | "expired">
  confirm(platform: PlatformId, qrId: string): Promise<PlatformCredential>  // 组装 + 写 repo
  refresh(platform: PlatformId): Promise<PlatformCredential>                // 保活/到期检测
  status(platform: PlatformId): Promise<CredentialStatus>
  logout(platform: PlatformId): Promise<void>
  credential(platform: PlatformId): Promise<PlatformCredential | undefined>
}
```

- **协议在 crawler**：`platform/<平台>/login.ts` 实现 `createQR()/poll()/collectCredential()`，
  只做协议（B站纯 HTTP、weibo JSONP、xhs 走 xhshow 签名），不管理生命周期。
- **生命周期在 core**：LoginService 驱动 编排→确认→持久化→保活→失效。

### 平台归属：crawler channel 声明

`RssChannel` 加可选 `platform?: PlatformId`（语义清晰、新平台零改 core）。core 的
`sourceInfoFor` 优先用 `channel.platform` 查 auth；**兼容期**未声明时回退前缀映射。

## 3. 数据流（改造后）

```
desktop UI ──LoginService──► crawler platform/<平台>/login.ts  (createQR / poll / collectCredential)
    │                                    │
    ▼                                    ▼
credential-repo (storage "auth")    PlatformCredential (bili 含 refreshToken)
    │
    ▼
data-layer.sourceInfoFor ──► channel.getSource(info + cookie) ──► fetch / resolve
    │
    ▼  catch AuthError{platform}
credential-repo 标记 expired ──► UI 引导重登（扫码登录即重登动作）
```

## 4. 保活调度

| 凭证 | 时机 | 动作 |
|---|---|---|
| bili_ticket（3 天） | **惰性**：`sourceInfoFor` 路径查 `biliTicketExpires < now+1d` | `GenWebTicket` 匿名刷新（固定密钥 HMAC），写回 repo |
| SESSDATA（180 天） | `LoginService.refresh("bili")`：启动/定时，`sessdataExpires < now+30d` | refresh_token 调 `cookie/refresh` 续期，写回新 SESSDATA + 新 refreshToken |
| weibo/xhs（~1 年） | `LoginService.refresh()`：`expiresAt < now` | 置 `expired`，引导重登 |

**失效检测**：crawler 各平台在识别错误码时抛 `AuthError{platform}`（weibo 432 / xhs 461 /
bili -101 / 弹幕 1006），core 在 refresh/resolve 的 catch 里捕获 → 标记失效 + 透传。
错误码识别放 crawler（平台知识在平台层）。

**降级语义**：DEFAULT_*_COOKIE 保留为「未登录降级默认」——bili 未登录仍 720P、weibo/xhs
匿名可浏览；登录后 auth 凭证优先，解锁高级档位/完整内容。

## 5. 实施阶段

- **Phase 1（crawler 声明层）**：`RssChannel.platform?` + `AuthError` + 三平台
  `platform/<平台>/login.ts` 协议（先 bili，纯 HTTP 无签名）。验证：bili 扫码拿 cookie +
  refreshToken 打通。
- **Phase 2（core/auth 子系统）**：`types` + `credential-repo` + `login-service`（bili 闭环：
  扫码登录 → 持久化 → bili_ticket 惰性刷 → SESSDATA 续期）。
- **Phase 3（data-layer 接线）**：`sourceInfoFor` 从 auth 取 cookie + AuthError 失效检测 +
  `AppSettings` 迁出 cookie 字段。
- **Phase 4（补全平台 + UI）**：weibo/xhs 扫码协议 + 到期重登；desktop 登录 dialog
  （qrcode 渲染 + 状态指示 + 重登引导）。

## 6. 复用与不改动

- **复用**：`packages/xhshow` 签名（xhs 扫码）；`appHost.http/js/storage` 门面；repo 的
  「storage key + JSON 全量」持久化模式（auth repo 同款）。
- **不改动**：`MediaStore` 内容存储、`deserializeFeed` 解析、订阅/阅读 repo 逻辑（只加
  auth 并联）。

## 7. 待实测（承接 platform-login-research）

- [ ] bili `cookie/refresh` 续期接口精确参数（refresh_token 是否够、是否需 csrf）。
- [ ] bili poll 成功响应体 `data.refresh_token` 字段名。
- [ ] weibo `qrcode/image` 2026 可用性 + 部分账号验证码拦截处理。
- [ ] xhs 扫码匿名会话初始化（`login/activate` vs `generateA1`+首访 cookie）。
