import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import sourcemaps from "rollup-plugin-sourcemaps";

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

export default defineConfig({
  build: {
    minify: false,
    sourcemap: false,

    rollupOptions: {
      plugins: [
        sourcemaps()
      ],

      input: {
        background: path.resolve(
          __dirname,
          "src/background.js"
        ),

        offscreen: path.resolve(
          __dirname,
          "src/offscreen.js"
        )
      },

      output: {
        entryFileNames: "[name].js"
      }
    }
  }
});
