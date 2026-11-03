import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/zeelys-dh-owlbear/",
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