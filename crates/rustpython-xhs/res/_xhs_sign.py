"""rustpython-xhs 签名入口 —— 包装 xhshow.sign_headers_get 为 JSON 字符串边界。

Rust 侧只传字符串(uri / cookie / params 的 JSON),返回完整签名 headers 的 JSON。
边界全字符串:避免跨语言类型转换,也便于单测与调试。
"""

import json
from urllib.parse import parse_qsl, urlsplit

from xhshow import Xhshow


def _sign(uri: str, cookie: str, params_json: str) -> str:
    """生成小红书 API 签名 headers,返回 JSON 字符串。

    - uri: 请求 path + 查询串(如 `/api/...?num=30&cursor=&user_id=xxx`)。
    - cookie: 会话 cookie 串(`a1` 作签名种子,xhshow 校验缺 a1 抛错)。
    - params_json: 保留参数(仅当 uri 无查询串时兜底用)。

    ⚠️ 参数顺序必须与服务器实际请求串一致:xhshow 的 `_build_content_string`
    (GET)按 payload 的 dict 顺序拼 content string 再签名,顺序错 → 签名无效
    (实测 406 vs 有效签名到账号校验层 461)。故**从 uri 查询串解析并保序**
    (crawler 的 searchParams 同源);不用 Rust 传来的 params(Rust 侧 serde_json
    Map 按键排序,顺序不可控)。sign_format="xyw":data API 拒 XYS_ 前缀(406),
    xyw(XYW_ 前缀)被接受——见 xhshow client.py docstring。
    """
    parts = urlsplit(uri)
    path = parts.path
    # keep_blank_values 保留 `cursor=` 空值(签名内容含它);parse_qsl 保 URL 顺序。
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    if not params and params_json:
        params = json.loads(params_json)
    headers = Xhshow().sign_headers_get(path, cookie, params=params, sign_format="xyw")
    return json.dumps(headers, ensure_ascii=False)
