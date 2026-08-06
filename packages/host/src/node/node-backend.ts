/**
 * nodeBackend — Node 原生 fetch 实现的 HttpBackend。
 * 供 example / 测试脚本注入(真实网络)。
 */
export function nodeBackend(): HttpBackend {
  return {
    async request(req) {
      const res = await fetch(req.url, {
        method: req.method ?? "GET",
        headers: req.headers ?? {},
        redirect: "follow",
        signal: req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : undefined,
      })
      if (req.responseType === "arraybuffer") {
        const buf = new Uint8Array(await res.arrayBuffer())
        return { status: res.status, headers: {}, body: buf }
      }
      const text = await res.text()
      return { status: res.status, headers: {}, body: req.responseType === "json" ? JSON.parse(text) : text }
    },
  }
}
