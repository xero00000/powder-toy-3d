// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { communityProxyPlugin } from "./scripts/community-proxy.mjs";

// compressjs predates ES modules and wraps each source file in a tiny AMD
// factory. Convert only that package's library files to ESM so Vite does not
// pull its Node-only amdefine loader (and `path`) into the browser bundle.
function compressJsAmdPlugin() {
  const libraryRoot = fileURLToPath(new URL("./node_modules/compressjs/lib/", import.meta.url));
  const virtualPrefix = "\0powder3-compressjs:";
  const convert = (source, id) => {
    const wrapper = source.match(/define\(\s*(\[[\s\S]*?\])\s*,\s*function\s*\(([^)]*)\)\s*\{/u);
    if (!wrapper || wrapper.index == null) return null;
    const end = source.lastIndexOf("});");
    if (end < wrapper.index) return null;
    const dependencies = JSON.parse(wrapper[1].replaceAll("'", '"'));
    const parameters = wrapper[2].split(",").map((name) => name.trim()).filter(Boolean);
    if (dependencies.length !== parameters.length) throw new Error(`Cannot convert AMD wrapper in ${id}`);
    const imports = dependencies.map((dependency, index) => {
      const name = dependency.replace(/^\.\//u, "");
      return `import __compressjs_${index} from ${JSON.stringify(`virtual:powder3-compressjs:${name}`)};`;
    }).join("\n");
    const body = source.slice(wrapper.index + wrapper[0].length, end);
    return `${imports}\nconst __compressjs_default = (function(${parameters.join(", ")}) {${body}\n})(${dependencies.map((_, index) => `__compressjs_${index}`).join(", ")});\nexport default __compressjs_default;\n`;
  };
  return {
    name: "compressjs-amd-to-esm",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./compressjs-bzip2.js" && importer?.endsWith("/src/ops-export.js")) return `${virtualPrefix}Bzip2`;
      if (source.startsWith("virtual:powder3-compressjs:")) return `${virtualPrefix}${source.slice("virtual:powder3-compressjs:".length)}`;
      return null;
    },
    load(id) {
      if (!id.startsWith(virtualPrefix)) return null;
      const name = id.slice(virtualPrefix.length);
      if (!/^[A-Za-z0-9_-]+$/u.test(name)) throw new Error(`Invalid compressjs virtual module ${name}`);
      const source = readFileSync(`${libraryRoot}${name}.js`, "utf8");
      const code = convert(source, id);
      if (!code) throw new Error(`Cannot convert compressjs AMD module ${name}`);
      return code;
    },
  };
}

export default defineConfig({
  // GitHub Pages serves project sites from /<repository>/. Local development
  // and normal production builds remain rooted at / unless CI supplies this.
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [compressJsAmdPlugin(), communityProxyPlugin()],
  resolve: {
    // Fengari's CommonJS build probes `require("os").platform()` whenever a
    // host exposes a partial `process` global (Electron does). Keep its path
    // selection deterministic in browsers without modifying the dependency.
    alias: {
      os: fileURLToPath(new URL("./src/fengari-os-browser.js", import.meta.url)),
    },
  },
  // Fengari selects its browser implementation through `typeof process`.
  // Make that branch statically knowable so Rollup drops its Node-only
  // filesystem, subprocess and package-loader code from the lazy Lua chunk.
  define: {
    "process.env.FENGARICONF": "undefined",
    process: "undefined",
  },
  optimizeDeps: {
    exclude: ["compressjs", "compressjs/lib/Bzip2.js"],
    // Vite's development dependency optimizer is a separate esbuild pass and
    // does not inherit the production `define` table above.
    esbuildOptions: {
      define: {
        "process.env.FENGARICONF": "undefined",
        process: "undefined",
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
          if (id.endsWith("upstream-elements.generated.js")) return "upstream-registry";
          return undefined;
        },
      },
    },
  },
});
