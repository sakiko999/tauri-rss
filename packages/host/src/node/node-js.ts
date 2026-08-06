/**
 * nodeJsBackend — JsBackend 的 new Function 实现。
 * 运行 douyu CryptoJS / douyin ABogus 签名 blob。生产可换受限执行器。
 */
export function nodeJsBackend(): JsBackend {
  return {
    call(code: string, fn: string, args: (string | number)[]) {
      // eslint-disable-next-line no-new-func
      const factory = new Function(`${code}\n;return ${fn}(...arguments)`) as (...a: unknown[]) => unknown
      return factory(...args)
    },
  }
}
