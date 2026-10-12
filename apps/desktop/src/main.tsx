import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { injectTauriHost } from "@tauri-playground/host";
import { router } from "./router";
import { useDesktop } from "./store/index";
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
