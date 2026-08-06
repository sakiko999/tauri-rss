/** refresh 一次订阅的结果。失败不抛,以 error 返回。 */
export interface RefreshResult {
  subscriptionId: string
  itemCount: number
  error?: string
  fetchedAt: number
}
