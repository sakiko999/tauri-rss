/**
 * weibo:user:search —— 搜微博用户(搜索渠道,不直接订阅)。
 *
 * m.weibo.cn container `100103type=3&q=<昵称>`(**需登录**,匿名 `ok:-100` 直接
 * 风控;取数在 resolve `searchWeiboUsers`)。产出 Video item:每个用户一条,
 * url = `weibo.com/u/<uid>` —— 候选提取从 url 解析 uid。
 *
 * 下游订阅走 `weibo:user`(uid 参数),本渠道只作「搜索添加」的取数源。
 */

import { now, searchWeiboUsers } from "@amoeba/resolve"
import type { Video } from "@amoeba/xml"

import { makeApiChannel } from "../factory.ts"

export const WeiboUserSearchChannel = makeApiChannel({
  key: "weibo:user:search",
  name: "微博搜用户",
  kind: "video",
  sourceInfoTpl: [{ key: "keyword", label: "用户昵称", placeholder: "如:半佛仙人", required: true }],
  channelTitle: (info) => `微博搜用户 ${info.keyword ?? ""}`,
  channelLink: "https://weibo.com/",
  fetchPage: async (info) => {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("weibo:user:search 需要关键词")
    // cookie 三级语义在 resolve 层收口(显式 > 空串强制匿名 > provider);
    // 无登录态直接抛「需要登录」,不打匿名请求(会触发平台冷却)。
    const users = await searchWeiboUsers(kw, info.cookie as string | undefined)
    const t = now()
    return users.map((u): Video => ({
      id: `wbu-${u.uid}`,
      sourceId: "weibo:user:search",
      kind: "video",
      title: u.screenName,
      url: `https://weibo.com/u/${u.uid}`,
      thumbnail: u.avatar,
      // 候选行的次行信息(粉丝数/认证理由)。raw 不穿 XML,summary 是唯一到 UI 的自由字段。
      summary: [u.verified, u.followers ? `${u.followers} 关注者` : ""].filter(Boolean).join(" · ") || undefined,
      fetchedAt: t,
    }))
  },
})
