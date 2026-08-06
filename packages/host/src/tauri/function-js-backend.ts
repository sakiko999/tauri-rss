/**
 * FunctionJsBackend — JsBackend 的 new Function 实现。
 * 运行 douyu CryptoJS / douyin ABogus 签名 blob。tauri.conf csp:null 允许 unsafe-eval。
 * 生产可换成 node:vm 受限执行器。
 */
export class FunctionJsBackend implements JsBackend {
  call(code: string, fn: string, args: (string | number)[]): unknown {
    const argsLiteral = args
      .map((a) => (typeof a === "string" ? JSON.stringify(a) : String(a)))
      .join(",")
    // eslint-disable-next-line no-new-func
    const wrapper = new Function(`${code}; return ${fn}(${argsLiteral});`) as () => unknown
    return wrapper()
  }
}
