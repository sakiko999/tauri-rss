/**
 * rsshub provider —— RSSHub 外挂实例源(source 层外部插件)。
 *
 * 定位(2026-08-26 反转):**内置 crawler 为主,RSSHub 作可选的「外挂 HTTP 服务器」**。
 * 不内嵌 npm 包/不跑 sidecar 进程——直连用户配置的公网实例(自部署 rsshub.app 等)。
 * 因此 baseUrl 必须存在(settings.rsshubBaseUrl 或订阅 info.baseUrl);无则抛清晰错误,
 * 而不是静默连不存在的本地端口。
 *
 * import 本模块即自注册(模块副作用,与 injectTauriHost 同模式)——desktop 入口
 * `import "@tauri-playground/core/source/rsshub"`,mobile 不 import 即不进 bundle。
 *
 * 渠道只有 fetch(直传外部 RSSHub 的标准 RSS 2.0 XML):无播放能力——视频/直播/弹幕由
 * crawler/resolver 按 item.url 统一路由解析(与 crawler 输出一起生效)。
 * ⚠️ 不把平台 cookie 附给 RSSHub 请求(公网实例泄露风险)。
 */
import { httpText } from "@tauri-playground/crawler"
import { registerSourceProvider, type RssChannel, type SourceInfo, type SourceInfoField } from "./index.ts"

/** 公网 RSSHub 实例兜底(settings.rsshubBaseUrl 缺失时用的默认外挂)。 */
const DEFAULT_BASE_URL = "https://rsshub.app"

/** 请求 UA(与 crawler rss 直传一致的桌面 Chrome)。 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

/** 渠道声明:route 模板(`{param}` 占位) + 参数字段。 */
interface RsshubChannelSpec {
  key: string
  name: string
  kind: RssChannel["kind"]
  /** 路由模板,如 "/weibo/user/{uid}" 或泛用 "{route}"。 */
  routeTpl: string
  fields?: SourceInfoField[]
  /** defaultInfo(存在 = 无需输入即可订阅)。 */
  defaultInfo?: SourceInfo
}

/** `{a}/{b}` 模板 + info 填充;缺失必填参数抛错(fetch 时才校验,构造期零 IO)。 */
function renderRoute(tpl: string, info: SourceInfo): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = info[k]
    if (v === undefined || v === "") throw new Error(`rsshub: 缺少路由参数 "${k}"`)
    return v
  })
}

/** 按声明产渠道(getSource 返回仅 { fetch } 的直传 source)。 */
function rsshubChannel(spec: RsshubChannelSpec): RssChannel {
  return {
    key: spec.key,
    name: spec.name,
    kind: spec.kind,
    ...(spec.fields ? { sourceInfoTpl: spec.fields } : {}),
    ...(spec.defaultInfo ? { defaultInfo: spec.defaultInfo } : {}),
    getSource(info: SourceInfo) {
      return {
        fetch: async () => {
          const route = renderRoute(spec.routeTpl, info)
          const base = (info.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")
          const path = route.startsWith("/") ? route : `/${route}`
          return httpText(`${base}${path}`, { "user-agent": UA })
        },
      }
    },
  }
}

/** 首期渠道清单:高频具名 + 泛用兜底(可按需扩充;kind 是 item 默认,加工层可推断覆盖)。 */
const CHANNEL_SPECS: RsshubChannelSpec[] = [
  {
    key: "rsshub:weibo:hot",
    name: "微博热搜(RSSHub)",
    kind: "article",
    routeTpl: "/weibo/search/hot",
    defaultInfo: {},
  },
  {
    key: "rsshub:weibo:user",
    name: "微博用户(RSSHub)",
    kind: "article",
    routeTpl: "/weibo/user/{uid}",
    fields: [{ key: "uid", label: "用户 uid", required: true, placeholder: "1195230310" }],
  },
  // ── 视频(点击播放走 crawler/resolver by-url:RSSHub 输出 item.link → 平台解析) ──
  {
    key: "rsshub:bili:popular",
    name: "B站综合热门(RSSHub)",
    kind: "video",
    routeTpl: "/bilibili/popular/all",
    defaultInfo: {},
  },
  {
    key: "rsshub:bili:weekly",
    name: "B站每周必看(RSSHub)",
    kind: "video",
    routeTpl: "/bilibili/weekly",
    defaultInfo: {},
  },
  {
    key: "rsshub:bili:precious",
    name: "B站入站必刷(RSSHub)",
    kind: "video",
    routeTpl: "/bilibili/precious",
    defaultInfo: {},
  },
  {
    key: "rsshub:youtube:channel",
    name: "YouTube 频道(RSSHub)",
    kind: "video",
    routeTpl: "/youtube/channel/{channelId}",
    fields: [{ key: "channelId", label: "频道 ID", required: true, placeholder: "UCYO_jab_esuFRV4b17AJtAw" }],
  },
  {
    key: "rsshub:feed",
    name: "RSSHub 任意路由",
    kind: "article",
    routeTpl: "{route}",
    fields: [
      { key: "route", label: "路由路径", required: true, placeholder: "/weibo/user/1195230310" },
      { key: "baseUrl", label: "实例地址(留空用设置)" },
    ],
  },
]

const CHANNELS = new Map(CHANNEL_SPECS.map((s) => [s.key, rsshubChannel(s)]))

/** provider 实例(import 即注册)。 */
export const rsshubProvider = {
  id: "rsshub",
  listChannels: () => [...CHANNELS.values()],
  getChannel: (key: string) => CHANNELS.get(key),
}

registerSourceProvider(rsshubProvider)
