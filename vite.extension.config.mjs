import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist/extension-ui",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.join(root, "src/extension.jsx"),
      formats: ["iife"],
      name: "CaptionReviewPagePanel",
      fileName: () => "caption-review-ui.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [react()],
});
