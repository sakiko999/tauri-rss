/**
 * 第三方正文 HTML 消毒 —— **唯一**配置（ReaderMain / SocialDetailModal 共用，FocusReader
 * 复用 ReaderMain 的结果）。正文来自任意 feed / 平台，这里是安全边界。
 *
 * 在 DOMPurify 默认（已去 script、事件属性、javascript: 链接、iframe/object/embed）之上
 * 再收紧（2026-11-01）：
 *   - `<style>`：默认放行，但它对**整个应用文档**生效 —— 正文能改写/隐藏任意界面；
 *   - **class / id**：正文与 App 共用同一个文档，全局类名（`.scrim` / `.modal` /
 *     `.overlay-root` / `.card` / `.stack` …）会直接命中 —— 一条 `class="scrim"` 的
 *     `<div>` 就能画出盖住整个窗口的假弹层。id 同理（`#toast-root` 等自带定位样式）；
 *   - 表单族：默认放行 form/input/button 与 action/method，正文能画出「请重新登录」的
 *     假表单，提交即把应用窗口导航走（Rust 侧另有 nav-guard 兜底）；
 *   - 含 `position` / `z-index` 的 style 属性整条去掉：`position:fixed` 能逃出阅读区、
 *     盖住整个应用伪造界面。其余内联样式（颜色、宽度）保留，正文排版不变。
 * 已知上限：不做 CSS 属性级白名单；去掉 class/id 后，正文自带的 `.lede`、代码高亮类、
 * 脚注跳转不生效（属排版损失）；第三方配色在深色主题下可能难读。
 */

import DOMPurify from "dompurify"

const FORBID_TAGS = [
  "style",
  "form",
  "input",
  "button",
  "select",
  "option",
  "optgroup",
  "textarea",
  "datalist",
  "fieldset",
  "legend",
  "output",
  "dialog",
]
const FORBID_ATTR = ["action", "formaction", "method", "class", "id"]

/**
 * 判「这条内联样式能不能逃出阅读区」交给浏览器自己的 CSS 解析器 —— 正则挡不住
 * `p\osition:fixed`（转义）/ `position/**\/:fixed`（注释）这类写法，浏览器照样认。
 * 游离元素只解析声明、不参与渲染，不会触发样式里的资源请求。
 */
const probe = document.createElement("div")
DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName !== "style") return
  probe.setAttribute("style", data.attrValue)
  if (probe.style.position || probe.style.zIndex) data.keepAttr = false
})

/**
 * @param opts.images `false` = 连 `<img>` 一起去掉（社交正文：表情/页脚图走原生 DOM 会被
 *   防盗链 403 破图，主图另走 MediaImage）。
 */
export function sanitizeFeedHtml(html: string, opts: { images?: boolean } = {}): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: opts.images === false ? [...FORBID_TAGS, "img"] : FORBID_TAGS,
    FORBID_ATTR,
    ALLOW_DATA_ATTR: false,
  })
}
