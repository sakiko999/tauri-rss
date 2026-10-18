/**
 * 编号注册表 —— 纯逻辑（无 DOM），供自检复用。
 *
 * 语义：**同一个 key 在本路由会话内永远得到同一个编号**。键释放后不回收给其它键
 * （只有 `reset()` 会清空）。因此编号可能不连续（1、3、7），但不会因为滚动/重挂载
 * 或页面轻微变化而跳号。
 */
export class NumberRegistry {
  private byKey = new Map<string, number>()
  private next = 1

  /** 取该 key 的编号；首次出现时分配最小可用值。 */
  numberFor(key: string): number {
    const hit = this.byKey.get(key)
    if (hit !== undefined) return hit
    const n = this.next++
    this.byKey.set(key, n)
    return n
  }

  has(key: string): boolean {
    return this.byKey.has(key)
  }

  size(): number {
    return this.byKey.size
  }

  max(): number {
    return this.next - 1
  }

  reset(): void {
    this.byKey.clear()
    this.next = 1
  }
}
