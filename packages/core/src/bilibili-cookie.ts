/**
 * bilibili 登录 cookie(core 层默认值,敏感)。
 *
 * ⚠️ 本文件被 git 跟踪的是**空占位**;本地真实 cookie 经 `git update-index --skip-worktree`
 * 保护,不会提交进仓库。clone 后如需登录态:
 *   1. 复制本文件为 `bilibili-cookie.ts`(保留本文件不动)
 *   2. 填入从浏览器 bilibili.com 已登录页面复制的完整 cookie 串(含 SESSDATA)
 *   3. `git update-index --skip-worktree packages/core/src/bilibili-cookie.ts` 防止误提交
 *
 * 留空 = 零登录(bili 直播原画/超清封顶,视频 720P 封顶)。
 * 订阅级 info.cookie 优先于它;settings 持久化的 bilibiliCookie 也优先于它。
 */
export const DEFAULT_BILIBILI_COOKIE = ""
