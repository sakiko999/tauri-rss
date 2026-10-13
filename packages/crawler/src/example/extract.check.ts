/**
 * extractArticle 自检：正文提取的边界（标签剥离 / 脚本丢弃 / 实体解码 / 相对图绝对化 /
 * SPA 空页返回 null）。仓库无测试基建，用最小断言。
 *   bun packages/crawler/src/example/extract.check.ts
 */
import { extractArticle, decodeEntities } from "../channels/rss/extract.ts"

let failed = 0
function assert(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    console.log(`  FAIL ${name}`)
    failed++
  }
}

console.log("extractArticle:")
{
  const html = `<!doctype html><html><head><title>标题A</title>
    <meta property="og:image" content="/img/hero.png">
    <meta name="description" content="x">
    </head><body>
    <nav><a href="/">首页</a> <a href="/about">关于</a></nav>
    <article>
      <h1>标题A</h1>
      <p>第一段，这是一段足够长的正文内容，用来超过最小字符阈值，确保提取器不会因为没有段落而回退失败。</p>
      <p>第二段 &amp; 带实体 &lt;tag&gt; &#8212; 结束，同样需要足够长度才能被认定为有效正文而不是导航噪声。</p>
      <script>var x = "不该出现";</script>
      <p>第三段，继续补充内容以保证整体可读文本长度明显超过阈值下限。<img src="https://cdn.example.com/pic.jpg" width="400"></p>
    </article>
    <footer>版权所有</footer></body></html>`
  const ex = extractArticle(html, "https://site.example/post/1")
  assert("提取到正文", !!ex)
  assert("含第一段", !!ex?.text.includes("第一段"))
  assert("含第二段", !!ex?.text.includes("第二段"))
  assert("实体解码 &", !!ex?.text.includes("& 带实体"))
  assert("实体解码 <tag>", !!ex?.text.includes("<tag>"))
  assert("不含脚本内容", !ex?.text.includes("不该出现"))
  assert("不含页脚", !ex?.text.includes("版权所有"))
  assert("og:image 相对→绝对", ex?.image === "https://site.example/img/hero.png")
  assert("title 提取", ex?.title === "标题A")
}
console.log("SPA 空页 / 反爬占位:")
{
  const spa = `<html><head><title>App</title></head><body><div id="root"></div>
    <script src="/bundle.js"></script></body></html>`
  assert("空页返回 null", extractArticle(spa, "https://app.example/") === null)
}
console.log("无 <p> 时整体去标签兜底:")
{
  const noP = `<html><body><article><div>${"正文内容".repeat(60)}</div></article></body></html>`
  const ex = extractArticle(noP, "https://site.example/")
  assert("整块去标签兜底", !!ex && ex.text.includes("正文内容"))
}
console.log("decodeEntities:")
{
  assert("nbsp→空格", decodeEntities("a&nbsp;b") === "a b")
  assert("十六进制", decodeEntities("&#x41;") === "A")
  assert("未知实体原样", decodeEntities("&foo;") === "&foo;")
}

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项失败`)
if (failed > 0) process.exit(1)
