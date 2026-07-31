import { create } from "zustand";

type Theme = "light" | "dark";

interface AppState {
  count: number;
  theme: Theme;
  inc: () => void;
  toggleTheme: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  count: 0,
  theme: "dark",
  inc: () => set((s) => ({ count: s.count + 1 })),
  toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
}));
