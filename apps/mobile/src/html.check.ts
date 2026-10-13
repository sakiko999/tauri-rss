/**
 * mobile html 自检 —— `bun apps/mobile/src/html.check.ts`
 * 覆盖:HTML 探测不误判裸 `<` / 块标签转段落换行 / 脚本丢弃 / 实体解码 / 纯文本原样。
 */
import { htmlToText, displayBody, looksLikeHtml } from "./html.ts"

let fails = 0
const ok = (c: unknown, l: string) => {
  if (c) console.log(`  ✓ ${l}`)
  else {
    fails++
    console.error(`  ✗ ${l}`)
  }
}

ok(looksLikeHtml("<p>a</p>"), "识别 <p>")
ok(!looksLikeHtml("use x < y and a > b"), "裸 < 不误判为 HTML")
ok(!looksLikeHtml("见 <https://a.b>"), "裸 URL 尖括号不误判")

ok(htmlToText("<p>第一段</p><p>第二段</p>") === "第一段\n\n第二段", "块标签转空行分段")
ok(htmlToText("A<br>B") === "A\nB", "br 转单换行")
ok(!htmlToText("<p>x</p><script>alert(1)</script>").includes("alert"), "丢弃脚本")
ok(htmlToText("<p>a &amp; b &lt;tag&gt;</p>") === "a & b <tag>", "实体解码")

ok(displayBody("纯文本 x < y") === "纯文本 x < y", "纯文本原样(不剥)")
ok(!displayBody("<p>正文</p>").includes("<"), "HTML 剥标签")

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
