/**
 * HotWordList — 热搜三栏中栏(微博热搜词条列表)。
 *
 * 数据 = 当前 weibo:hot 订阅内容(useDesktop.items,已在 store 聚合)。
 * 行:排名 + 词 + 热度。点击词条 → loadHotWord(word) 加载右栏该词微博流,
 * 选中态高亮(当前 hotWord.word)。参照 ArticleList 的行式列表样式。
 */
import { cn } from "../lib/cn.ts"
import { useDesktop } from "../store.ts"
import { useViewNavigate } from "../router"

export function HotWordList() {
  const { items, hotWord, selectedNodeId } = useDesktop()
  // 点热搜词 → URL 带 ?word= → loader 同步 store.loadHotWord。
  const go = useViewNavigate()
  const words = items.filter((it) => it.kind === "social")

  return (
    <div className="w-80 h-full bg-background border-r border-border flex flex-col shrink-0">
      {/* 头:视图身份(微博热搜)+ 词条数。 */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-border shrink-0">
        <span className="font-medium text-sm">微博热搜</span>
        <span className="text-xs text-muted-foreground tabular-nums">{words.length} 条</span>
      </div>

      {/* 列表:普通滚动(50 条量级,无需虚拟化)。 */}
      <div className="flex-1 overflow-y-auto">
        {words.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">暂无热搜,侧栏点刷新获取</p>
        ) : (
          words.map((it, i) => {
            const word = it.title
            const selected = hotWord?.word === word
            return (
              <div
                key={it.id}
                className={cn(
                  "flex gap-3 p-3 cursor-pointer border-b border-border/50",
                  selected ? "bg-blue-600" : "hover:bg-muted/50",
                )}
                onClick={() => go(selectedNodeId ?? "tab:all", word)}
              >
                {/* 排名:前三红、选中白、其余弱化。 */}
                <span
                  className={cn(
                    "w-5 text-center text-sm font-semibold shrink-0 mt-0.5",
                    selected ? "text-white" : i < 3 ? "text-red-500" : "text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <h3
                    className={cn(
                      "text-sm font-medium leading-snug line-clamp-1",
                      selected ? "text-white" : "text-foreground",
                    )}
                  >
                    {it.title}
                  </h3>
                  <p className={cn("text-xs mt-0.5 line-clamp-1", selected ? "text-blue-100" : "text-muted-foreground")}>
                    {it.content}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
