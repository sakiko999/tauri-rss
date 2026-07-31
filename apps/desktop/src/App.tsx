import { useAppStore } from "./store";

export default function App() {
  const count = useAppStore((s) => s.count);
  const inc = useAppStore((s) => s.inc);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 transition-colors dark:bg-zinc-900 dark:text-zinc-100">
      <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16">
        <h1 className="text-2xl font-bold">RSS Reader</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Desktop · React 19 · Tailwind 4 · Zustand
        </p>

        <div className="mt-4 flex items-center gap-3">
          <span className="rounded-full bg-zinc-200 px-4 py-1.5 text-sm font-medium dark:bg-zinc-800">
            count = {count}
          </span>
          <button
            onClick={inc}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            +1
          </button>
          <button
            onClick={toggleTheme}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            切换到 {theme === "light" ? "暗色" : "亮色"}
          </button>
        </div>
      </main>
    </div>
  );
}
