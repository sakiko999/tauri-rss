/**
 * Minimal MD5 (RFC 1321) hex digest.
 *
 * Why inline: Web Crypto's `crypto.subtle.digest` does not support MD5 (SHA
 * only), and the data layer is intentionally dependency-free for signing
 * (Bilibili Wbi, Huya anticode both need MD5). This is a compact
 * reference implementation kept here so we add no dependency for it.
 *
 * Input is UTF-8 encoded. Output is a 32-char lowercase hex string.
 */
export function md5Hex(input: string): string {
  function rh(n: number): string {
    let s = ""
    for (let j = 0; j <= 3; j++) {
      s += ((n >> (j * 8 + 4)) & 0x0f).toString(16) + ((n >> (j * 8)) & 0x0f).toString(16)
    }
    return s
  }
  function ad(x: number, y: number): number {
    const l = (x & 0xffff) + (y & 0xffff)
    const m = (x >> 16) + (y >> 16) + (l >> 16)
    return (m << 16) | (l & 0xffff)
  }
  function rl(n: number, c: number): number {
    return (n << c) | (n >>> (32 - c))
  }
  function cm(q: number, a: number, b: number, x: number, s: number, t: number): [number, number] {
    a = ad(a, ad(ad(q, x), t))
    return [ad(rl(a, s), b), b]
  }
  type St = [number, number, number, number]
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): St {
    const [na, nb] = cm((b & c) | (~b & d), a, b, x, s, t)
    return [na, nb, c, d]
  }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): St {
    const [na, nb] = cm((b & d) | (c & ~d), a, b, x, s, t)
    return [na, nb, c, d]
  }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): St {
    const [na, nb] = cm(b ^ c ^ d, a, b, x, s, t)
    return [na, nb, c, d]
  }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): St {
    const [na, nb] = cm(c ^ (b | ~d), a, b, x, s, t)
    return [na, nb, c, d]
  }
  function cb(s: string): number[] {
    const b: number[] = []
    for (let i = 0; i < s.length * 8; i += 8) {
      const idx = i >> 5
      b[idx] = (b[idx] ?? 0) | ((s.charCodeAt(i / 8) & 0xff) << i % 32)
    }
    return b
  }

  const x = cb(unescape(encodeURIComponent(input)))
  const len = x.length
  const padIdx = len >> 5
  x[padIdx] = (x[padIdx] ?? 0) | (0x80 << len % 32)
  x[(((len + 64) >>> 9) << 4) + 14] = len * 8

  let a = 1732584193,
    b = -271733879,
    c = -1732584194,
    d = 271733878

  for (let i = 0; i < x.length; i += 16) {
    const oa = a,
      ob = b,
      oc = c,
      od = d
    ;[a, b, c, d] = ff(a, b, c, d, x[i]!, 7, -680876936)
    ;[d, a, b, c] = ff(d, a, b, c, x[i + 1]!, 12, -389564586)
    ;[c, d, a, b] = ff(c, d, a, b, x[i + 2]!, 17, 606105819)
    ;[b, c, d, a] = ff(b, c, d, a, x[i + 3]!, 22, -1044525330)
    ;[a, b, c, d] = ff(a, b, c, d, x[i + 4]!, 7, -176418897)
    ;[d, a, b, c] = ff(d, a, b, c, x[i + 5]!, 12, 1200080426)
    ;[c, d, a, b] = ff(c, d, a, b, x[i + 6]!, 17, -1473231341)
    ;[b, c, d, a] = ff(b, c, d, a, x[i + 7]!, 22, -45705983)
    ;[a, b, c, d] = ff(a, b, c, d, x[i + 8]!, 7, 1770035416)
    ;[d, a, b, c] = ff(d, a, b, c, x[i + 9]!, 12, -1958414417)
    ;[c, d, a, b] = ff(c, d, a, b, x[i + 10]!, 17, -42063)
    ;[b, c, d, a] = ff(b, c, d, a, x[i + 11]!, 22, -1990404162)
    ;[a, b, c, d] = ff(a, b, c, d, x[i + 12]!, 7, 1804603682)
    ;[d, a, b, c] = ff(d, a, b, c, x[i + 13]!, 12, -40341101)
    ;[c, d, a, b] = ff(c, d, a, b, x[i + 14]!, 17, -1502002290)
    ;[b, c, d, a] = ff(b, c, d, a, x[i + 15]!, 22, 1236535329)
    ;[a, b, c, d] = gg(a, b, c, d, x[i + 1]!, 5, -165796510)
    ;[d, a, b, c] = gg(d, a, b, c, x[i + 6]!, 9, -1069501632)
    ;[c, d, a, b] = gg(c, d, a, b, x[i + 11]!, 14, 643717713)
    ;[b, c, d, a] = gg(b, c, d, a, x[i]!, 20, -373897302)
    ;[a, b, c, d] = gg(a, b, c, d, x[i + 5]!, 5, -701558691)
    ;[d, a, b, c] = gg(d, a, b, c, x[i + 10]!, 9, 38016083)
    ;[c, d, a, b] = gg(c, d, a, b, x[i + 15]!, 14, -660478335)
    ;[b, c, d, a] = gg(b, c, d, a, x[i + 4]!, 20, -405537848)
    ;[a, b, c, d] = gg(a, b, c, d, x[i + 9]!, 5, 568446438)
    ;[d, a, b, c] = gg(d, a, b, c, x[i + 14]!, 9, -1019803690)
    ;[c, d, a, b] = gg(c, d, a, b, x[i + 3]!, 14, -187363961)
    ;[b, c, d, a] = gg(b, c, d, a, x[i + 8]!, 20, 1163531501)
    ;[a, b, c, d] = gg(a, b, c, d, x[i + 13]!, 5, -1444681467)
    ;[d, a, b, c] = gg(d, a, b, c, x[i + 2]!, 9, -51403784)
    ;[c, d, a, b] = gg(c, d, a, b, x[i + 7]!, 14, 1735328473)
    ;[b, c, d, a] = gg(b, c, d, a, x[i + 12]!, 20, -1926607734)
    ;[a, b, c, d] = hh(a, b, c, d, x[i + 5]!, 4, -378558)
    ;[d, a, b, c] = hh(d, a, b, c, x[i + 8]!, 11, -2022574463)
    ;[c, d, a, b] = hh(c, d, a, b, x[i + 11]!, 16, 1839030562)
    ;[b, c, d, a] = hh(b, c, d, a, x[i + 14]!, 23, -35309556)
    ;[a, b, c, d] = hh(a, b, c, d, x[i + 1]!, 4, -1530992060)
    ;[d, a, b, c] = hh(d, a, b, c, x[i + 4]!, 11, 1272893353)
    ;[c, d, a, b] = hh(c, d, a, b, x[i + 7]!, 16, -155497632)
    ;[b, c, d, a] = hh(b, c, d, a, x[i + 10]!, 23, -1094730640)
    ;[a, b, c, d] = hh(a, b, c, d, x[i + 13]!, 4, 681279174)
    ;[d, a, b, c] = hh(d, a, b, c, x[i]!, 11, -358537222)
    ;[c, d, a, b] = hh(c, d, a, b, x[i + 3]!, 16, -722521979)
    ;[b, c, d, a] = hh(b, c, d, a, x[i + 6]!, 23, 76029189)
    ;[a, b, c, d] = hh(a, b, c, d, x[i + 9]!, 4, -640364487)
    ;[d, a, b, c] = hh(d, a, b, c, x[i + 12]!, 11, -421815835)
    ;[c, d, a, b] = hh(c, d, a, b, x[i + 15]!, 16, 530742520)
    ;[b, c, d, a] = hh(b, c, d, a, x[i + 2]!, 23, -995338651)
    ;[a, b, c, d] = ii(a, b, c, d, x[i]!, 6, -198630844)
    ;[d, a, b, c] = ii(d, a, b, c, x[i + 7]!, 10, 1126891415)
    ;[c, d, a, b] = ii(c, d, a, b, x[i + 14]!, 15, -1416354905)
    ;[b, c, d, a] = ii(b, c, d, a, x[i + 5]!, 21, -57434055)
    ;[a, b, c, d] = ii(a, b, c, d, x[i + 12]!, 6, 1700485571)
    ;[d, a, b, c] = ii(d, a, b, c, x[i + 3]!, 10, -1894986606)
    ;[c, d, a, b] = ii(c, d, a, b, x[i + 10]!, 15, -1051523)
    ;[b, c, d, a] = ii(b, c, d, a, x[i + 1]!, 21, -2054922799)
    ;[a, b, c, d] = ii(a, b, c, d, x[i + 8]!, 6, 1873313359)
    ;[d, a, b, c] = ii(d, a, b, c, x[i + 15]!, 10, -30611744)
    ;[c, d, a, b] = ii(c, d, a, b, x[i + 6]!, 15, -1560198380)
    ;[b, c, d, a] = ii(b, c, d, a, x[i + 13]!, 21, 1309151649)
    ;[a, b, c, d] = ii(a, b, c, d, x[i + 4]!, 6, -145523070)
    ;[d, a, b, c] = ii(d, a, b, c, x[i + 11]!, 10, -1120210379)
    ;[c, d, a, b] = ii(c, d, a, b, x[i + 2]!, 15, 718787259)
    ;[b, c, d, a] = ii(b, c, d, a, x[i + 9]!, 21, -343485551)
    a = ad(a, oa)
    b = ad(b, ob)
    c = ad(c, oc)
    d = ad(d, od)
  }
  return rh(a) + rh(b) + rh(c) + rh(d)
}
