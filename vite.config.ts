import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        panel: "index.html",
        background: "background.html",
        overlay: "overlay.html",
      },
    },
  },
});
