import { parseFeed } from "../../packages/xml/src/xml-parser.ts"

const xml = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Android Developers Blog</title>
  <link rel="http://schemas.google.com/g/2005#feed" type="application/atom+xml" href="https://android-developers.googleblog.com/feeds/posts/default"/>
  <link rel="self" type="application/atom+xml" href="https://www.blogger.com/feeds/123/posts/default"/>
  <link rel="alternate" type="text/html" href="https://android-developers.googleblog.com/"/>
  <entry>
    <id>tag:blogger.com,1999:blog-1.post-2</id>
    <published>2026-01-01T00:00:00.000-08:00</published>
    <updated>2026-01-01T00:00:00.000-08:00</updated>
    <title>Some Post</title>
    <link rel="replies" type="application/atom+xml" href="https://android-developers.googleblog.com/feeds/2/comments/default"/>
    <link rel="self" type="application/atom+xml" href="https://www.blogger.com/feeds/123/posts/default/2"/>
    <link rel="alternate" type="text/html" href="https://android-developers.googleblog.com/2026/01/some-post.html"/>
  </entry>
</feed>`

const feed = parseFeed(xml)
console.log("channel.link =", JSON.stringify(feed.channel.link))
console.log("item0.link   =", JSON.stringify(feed.channel.item[0].link))
console.log("item0.guid   =", JSON.stringify(feed.channel.item[0].guid))
