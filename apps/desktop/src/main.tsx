import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { injectTauriHost } from "@tauri-playground/host";

// 注入桌面宿主能力到全局 appHost(core/crawler 从它读 http/js/storage/now)
injectTauriHost();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
