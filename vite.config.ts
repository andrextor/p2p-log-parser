import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      // Sin esto se publican también las declaraciones de los tests.
      include: ["src"],
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "P2PLogParser",
      // `package.json` declara `dist/p2p-log-parser.cjs`, pero el nombre por
      // defecto de Vite para el formato CJS es `.umd.cjs`: el paquete publicado
      // no resolvía para ningún consumidor CommonJS.
      formats: ["es", "cjs"],
      fileName: (format) =>
        format === "es" ? "p2p-log-parser.js" : "p2p-log-parser.cjs",
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@checkout": resolve(__dirname, "src/checkout"),
      "@rest": resolve(__dirname, "src/rest"),
      "@common": resolve(__dirname, "src/common"),
      "@types": resolve(__dirname, "src/types"),
      "@utils": resolve(__dirname, "src/utils"),
      "@test": resolve(__dirname, "test"),
    },
  },
});
