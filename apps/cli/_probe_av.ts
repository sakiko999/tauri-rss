import { nodeBackend, nodeJsBackend, nodeWsBackend, setHostCaps } from "@tauri-playground/host";
import { sqliteStorage } from "./src/store/sqlite-storage.ts";
globalThis.localStorage = { getItem: () => "0", setItem(){}, removeItem(){}, clear(){}, key(){return null}, length:0 };
const real = nodeBackend();
setHostCaps({ http: { request: async (req) => { console.log("HTTP →", req.url); return real.request(req); } }, js: nodeJsBackend(), storage: sqliteStorage(), ws: nodeWsBackend() });
const { resolveBiliVideoPlay } = await import("@tauri-playground/resolve");
try {
  const s = await resolveBiliVideoPlay("av170001");
  console.log("streams:", s.length, s.map(x => x.quality + "/" + x.rate));
} catch (e) { console.log("THREW:", e.message); }
