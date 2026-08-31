/**
 * 平台登录 cookie(core 层默认值,敏感——**当前纯匿名方案,全为空占位**)。
 *
 * ⚠️ 本文件三个常量**全部留空** = 零登录(2026-08-31 决策,暂时纯匿名):
 *   - bili:直播原画/超清封顶,视频 720P 封顶;bili:dynamic/bili:live:hot/直播弹幕
 *     需登录,匿名会失败(符合「纯匿名」预期)。
 *   - weibo:weibo:user / 热搜词流 resolveHotWord 需登录,匿名失败;
 *     weibo:hot 热搜列表(hot_band)匿名可用。
 *   - xhs:xhs:explore(推荐流)匿名 SSR 可用;xhs:user 匿名 noteId 抹空 → 0 条;
 *     笔记详情页 noteDetail 匿名可用(带列表项 xsec_token)。
 *
 * 如需恢复登录态:三个常量填真实 cookie 串(SESSDATA/SUB/web_session),
 * `git update-index --no-skip-worktree packages/core/src/bilibili-cookie.ts`
 * 让改动可提交(勿提交真实值)。
 *
 * 留空 = 纯匿名。订阅级 info.cookie 优先于它;settings 持久化的
 * bilibiliCookie/weiboCookie/xhsCookie 也优先于它。
 */
export const DEFAULT_BILIBILI_COOKIE = ""
export const DEFAULT_WEIBO_COOKIE = ""
export const DEFAULT_XHS_COOKIE = ""
