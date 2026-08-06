/** 订阅引用的 channelKey 在 crawler 注册表中不存在。 */
export class NoChannelError extends Error {
  constructor(channelKey: string) {
    super(`no crawler channel registered for "${channelKey}"`)
    this.name = "NoChannelError"
  }
}
