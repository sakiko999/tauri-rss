/**
 * nodeBackend — Node 原生 fetch 实现的 HttpBackend。
 * 供 example / 测试脚本注入(真实网络)。
 *
 * 注意:响应回传 `set-cookie` header(拼成字符串)——douyin 等平台 warmup 依赖
 * 它抓新鲜 cookie,硬编码空 headers 会让 cookie jar 永远失效。
 */
export function nodeBackend(): HttpBackend {
  return {
    async request(req) {
      const res = await fetch(req.url, {
        method: req.method ?? "GET",
        headers: req.headers ?? {},
        body: req.body,
        redirect: "follow",
        signal: req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : undefined,
      })
      // getSetCookie 返回 array(Undici/Bun);兜底 get("set-cookie") 可能返回单个 string。
      const rawSetCookie = res.headers.getSetCookie?.() ?? res.headers.get("set-cookie")
      const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie : rawSetCookie ? [rawSetCookie] : []
      const headers: Record<string, string> = setCookie.length ? { "set-cookie": setCookie.join("\n") } : {}
      if (req.responseType === "arraybuffer") {
        const buf = new Uint8Array(await res.arrayBuffer())
        return { status: res.status, headers, body: buf }
      }
      const text = await res.text()
      // ⚠️ 空 body 不能 JSON.parse("")——会抛 SyntaxError。平台软限流常返 200 + 空 body
      // (douyu/youtube 的 json 请求),此时应作「无数据」回 null,与 Rust 后端
      // (仅非空才 parse)一致。resolve 的 httpJson 按 `== null` 判空,不会误当数据。
      let body: unknown = text
      if (req.responseType === "json") body = text.trim() === "" ? null : JSON.parse(text)
      return { status: res.status, headers, body }
    },
  }
}
