import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { injectTauriHost } from "@tauri-playground/host";
import { router } from "./router";
import "./styles.css";

// 注入桌面宿主能力到全局 appHost(core/crawler 从它读 http/js/storage/now)
injectTauriHost();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
