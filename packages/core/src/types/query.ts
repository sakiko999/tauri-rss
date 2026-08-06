/** store 查询条件。 */
export interface MediaQuery {
  /** 限定单一订阅。省略 = 全部。 */
  subscriptionId?: string
  today?: boolean
  unreadOnly?: boolean
  starredOnly?: boolean
  /** 排序:publishedAt 降序(新在前);平局按 id。 */
}
