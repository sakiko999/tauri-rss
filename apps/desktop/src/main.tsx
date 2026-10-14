import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { injectTauriHost } from "@tauri-playground/host";
import { router } from "./router";
import { useDesktop } from "./store/index";
import { showSkeleton } from "./store/selectors.ts";
import "@tauri-playground/core/source/rsshub";
import "./styles.css";

// 注入桌面宿主能力到全局 appHost(core/crawler 从它读 http/js/storage/now)
injectTauriHost();

// dev 调试锚点:CDP 连进运行实例时用 `__store.getState()` 读权威状态
// (订阅表 / refreshErrors / view —— 这些 UI 只以图标/计数呈现,文本读不到)。
if (import.meta.env.DEV) (globalThis as { __store?: unknown }).__store = useDesktop;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

/* ------------------------------------------------------------------
 * 启动过渡的收尾:摘掉 index.html 里的静态骨架。
 *
 * 骨架是纯 HTML/CSS(见 index.html),这里只负责在**有真实内容可显示**时摘掉它。
 * 判据与 App.tsx 铺 React 骨架那一层**同一个**(showSkeleton):
 *
 *   - 铺着(index.html 那份,或 App 里那份)—— 两者逐像素同构,换手看不出来
 *   - 该收(!showSkeleton)—— 先让它露够 SKELETON_MIN_MS,再淡出
 *
 * ⚠️ 为什么两层骨架要同时收:App 那层盖在真实视图上,index.html 那层盖在最上面;
 * 按同一个信号收,中间不会出现「骨架撤了但内容是空的」那一帧。
 *
 * ⚠️ 不用 Suspense fallback:滚动容器交由 Virtuoso / masonic 自己持有,context
 * 变更不会让它们重挂 —— 用 Suspense 命中的就是「不重挂 → 滚动位置错乱」那条
 * 已知失败路径。所以这里用「同一套骨架类 + 一个 overlay」而不是 Suspense。
 * ------------------------------------------------------------------ */
const SKELETON_MIN_MS = 350;
const skelT0 = Date.now();
const skeleton = document.getElementById("boot-skeleton");
function dismissSkeleton() {
  if (!skeleton || skeleton.classList.contains("boot-skeleton-out")) return;
  skeleton.classList.add("boot-skeleton-out"); // 只动 opacity,见 index.html
  // 万一动画没跑,也不能让它一直挡着应用:到点先从 DOM 移除。
  setTimeout(() => skeleton.remove(), 300);
}
const afterPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

void (async () => {
  // 先等「至少露脸」,再等「有内容可显示」—— 顺序不能反。
  await new Promise<void>((r) => setTimeout(r, Math.max(0, SKELETON_MIN_MS - (Date.now() - skelT0))));
  if (showSkeleton(useDesktop.getState())) {
    await new Promise<void>((resolve) => {
      const off = useDesktop.subscribe(() => {
        if (!showSkeleton(useDesktop.getState())) {
          off();
          resolve();
        }
      });
    });
  }
  await afterPaint();
  dismissSkeleton();
})();
