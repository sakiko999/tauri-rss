/**
 * 平台 cookie provider —— cookie 链第 3→4 跳的结构性收口。
 *
 * 背景:cookie 注入端集中(core sourceInfoFor 一处),消费端却靠各渠道「记得」把
 * info.cookie 传进平台 client 的**每个**调用。漏传即静默匿名,已有三次案底:
 *   - bili:user_video 漏传(登录用户永远匿名 → space 接口 412,2026-10-21 修);
 *   - bili:favlist 私有收藏夹(登录也必失败);
 *   - douyin 整平台死键(douyinCookie 落库后零消费,扫码承诺的「解锁原画」无代码兑现)。
 *
 * provider 让 client 在「调用点没显式传 cookie」时自动回落宿主注册的平台默认
 * (settings 里扫码/手填的登录态)。注册方:
 *   - core DataLayer 构造时注册(settings 快照,set/reset/refresh 后刷新);
 *   - CLI 探针进程在入口注册同源 lookup(它不经 DataLayer 直调 channel/client)。
 *
 * resolve 不依赖 core——这里只暴露注入钩子,依赖方向(resolve ← crawler ← core)不破。
 *
 * 语义(必须保序,各 client 经 resolveCookie 统一):
 *   1. 调用点显式非空串 → 原样使用(订阅/CLI kv 覆盖);
 *   2. 显式空串 "" → **强制匿名**,不回落 provider(xhs 详情刻意匿名、
 *      CLI `--kv cookie=` 探针依赖此语义);
 *   3. undefined → provider(platform);宿主未注册/无值 → client 原兜底(douyin 的
 *      匿名 ttwid jar / bili-weibo-xhs 的无 cookie)。
 */

let lookup: ((platform: string) => string | undefined) | null = null

/** 注册平台默认 cookie 来源(宿主启动时一次;传 null 注销)。后注册覆盖先注册。 */
export function setPlatformCookieLookup(fn: ((platform: string) => string | undefined) | null): void {
  lookup = fn
}

/** provider 查询(未注册/无值 → undefined)。client 内部用,渠道层别直接调。 */
export function platformCookie(platform: string): string | undefined {
  return lookup?.(platform)
}

/**
 * client 统一入口:显式覆盖 > 显式空串(强制匿名) > provider。
 * 各平台 client 在拿到 opts.cookie 后先过这里,禁止再手写 `opts?.cookie ?? 兜底`。
 */
export function resolveCookie(explicit: string | undefined, platform: string): string | undefined {
  if (explicit !== undefined) return explicit || undefined
  return platformCookie(platform)
}
