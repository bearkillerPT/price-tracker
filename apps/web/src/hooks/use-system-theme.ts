import { useSyncExternalStore } from "react";

const query = () => window.matchMedia("(prefers-color-scheme: dark)");

/** "dark" or "light", following the system setting (index.html toggles the `dark` class from the same query). */
export function useSystemTheme(): "dark" | "light" {
  return useSyncExternalStore(
    (onChange) => {
      const mq = query();
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => (query().matches ? "dark" : "light"),
  );
}
