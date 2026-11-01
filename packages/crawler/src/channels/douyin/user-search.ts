/**
 * douyin:user:search —— 查抖音用户(搜索渠道,不直接订阅)。
 *
 * 输入**抖音号**(`unique_id`,如 `pvcyinse`),经旧版资料接口换 `sec_uid` +
 * 昵称/头像(匿名可用,取数在 resolve `fetchDouyinUserByUniqueId`)。产出单条
 * Video item,url = 用户主页 —— 候选提取从 url 解析 sec_uid。
 *
 * ⚠️ 是「查号」不是「按昵称搜」:抖音真正的关键词搜索接口匿名 2483/需登录,
 * 未做(见 docs/platforms/platform-notes.md 抖音段)。抖音号即用户唯一好记的标识,
 * 与 `douyin:user` 订阅框「可直接填抖音号」同一套解析。
 *
 * 下游订阅走 `douyin:user`(sec_uid 参数),本渠道只作「搜索添加」的取数源。
 */

import { fetchDouyinUserByUniqueId, now } from "@amoeba/resolve"
import type { Video } from "@amoeba/xml"

import { makeApiChannel } from "../factory.ts"

export const DouyinUserSearchChannel = makeApiChannel({
  key: "douyin:user:search",
  name: "抖音查用户",
  kind: "video",
  sourceInfoTpl: [{ key: "keyword", label: "抖音号", placeholder: "如:pvcyinse", required: true }],
  channelTitle: (info) => `抖音查用户 ${info.keyword ?? ""}`,
  channelLink: "https://www.douyin.com/",
  fetchPage: async (info) => {
    const kw = String(info.keyword ?? "")
      .trim()
      .replace(/^@+/, "")
    if (!kw) throw new Error("douyin:user:search 需要抖音号")
    const u = await fetchDouyinUserByUniqueId(kw)
    return [
      {
        id: `dyu-${u.secUid.slice(-12)}`,
        sourceId: "douyin:user:search",
        kind: "video",
        title: u.nickname,
        url: `https://www.douyin.com/user/${u.secUid}`,
        thumbnail: u.avatar,
        summary: u.uniqueId && u.uniqueId !== kw ? `抖音号 ${u.uniqueId}` : undefined,
        fetchedAt: now(),
      } satisfies Video,
    ]
  },
})
