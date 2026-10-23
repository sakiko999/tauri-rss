/** store 查询条件。 */
export interface MediaQuery {
  /** 限定单一订阅。省略 = 全部。 */
  subscriptionId?: string
  /** 限定一组订阅(分组聚合节点 `group:<gid>`)。与 subscriptionId 同时给出时取交集。 */
  subscriptionIds?: string[]
  today?: boolean
  unreadOnly?: boolean
  starredOnly?: boolean
  /** 排序:publishedAt 降序(新在前);同刻按插入序(稳定排序,无 id tie-break)。 */
}
