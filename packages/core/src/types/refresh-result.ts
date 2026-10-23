import type { ErrorKind } from "@amoeba/resolve"

/** refresh 一次订阅的结果。失败不抛,以 error 返回。 */
export interface RefreshResult {
  subscriptionId: string
  itemCount: number
  error?: string
  /** 失败分类（登录/风控/冷却/网络/…）；成功时省略。 */
  errorKind?: ErrorKind
  fetchedAt: number
}
