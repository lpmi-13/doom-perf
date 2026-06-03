#!/usr/bin/env node
// Single source of truth for web-asset cache-busting.
//
// One run computes content-hash versions for the map WAD and the WASM engine,
// injects them into the bundle as build-time constants (__WAD_VERSION__ /
// __ENGINE_VERSION__), and stamps the bundle's own content hash into the game
// HTML's <script> tag. Because every version is derived from the actual file
// contents in one place, a build can't ship a new bundle that points at a stale
// WAD or engine (or vice versa) -- the cache-bust is always consistent and only
// changes when the asset changes.
//
// Usage:
//   node scripts/build-web.mjs            one-shot production build
//   node scripts/build-web.mjs --watch --serve   dev server (esbuild watch+serve)
//
// In --watch mode the static-asset versions fall back to a "dev" sentinel that
// the bundle turns into a runtime timestamp, so iterating on the map/engine
// never serves a cached copy; the bundle itself is re-stamped on every rebuild.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const watch = process.argv.includes("--watch");
const serve = process.argv.includes("--serve");

const hashOf = (paths) => {
  const hash = createHash("sha256");
  let found = false;
  for (const path of paths) {
    if (existsSync(path)) {
      hash.update(readFileSync(path));
      found = true;
    }
  }
  return found ? hash.digest("hex").slice(0, 12) : "missing";
};

// Static assets get a real content hash for a production build, or a "dev"
// sentinel under --watch (esbuild's injected define is fixed for the session,
// so the bundle expands "dev" to a fresh runtime timestamp instead).
const wadVersion = watch ? "dev" : hashOf(["public/maps/doomperf-lab.wad"]);
const engineVersion = watch ? "dev" : hashOf(["public/engine/doom.js", "public/engine/doom.wasm"]);

const htmlPath = "public/game/index.html";
const bundlePath = "public/dist/index.js";

// Stamp the freshly built bundle's content hash into the HTML <script src>, so
// the browser fetches a new bundle exactly when its contents change.
const stampBundleVersion = () => {
  if (!existsSync(bundlePath)) return undefined;
  const version = hashOf([bundlePath]);
  const html = readFileSync(htmlPath, "utf8");
  const next = html.replace(/(\/dist\/index\.js\?v=)[^"']*/, `$1${version}`);
  if (next !== html) writeFileSync(htmlPath, next);
  return version;
};

const stampPlugin = {
  name: "stamp-asset-versions",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      const bundleVersion = stampBundleVersion();
      if (bundleVersion) {
        console.log(`[build-web] bundle=${bundleVersion} wad=${wadVersion} engine=${engineVersion}`);
      }
    });
  },
};

const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  sourcemap: true,
  outdir: "public/dist",
  define: {
    __WAD_VERSION__: JSON.stringify(wadVersion),
    __ENGINE_VERSION__: JSON.stringify(engineVersion),
  },
  plugins: [stampPlugin],
};

if (watch || serve) {
  const ctx = await esbuild.context(options);
  if (watch) await ctx.watch();
  if (serve) {
    const { host, port } = await ctx.serve({ host: "127.0.0.1", port: 8000, servedir: "public" });
    console.log(`[build-web] serving http://${host}:${port}`);
  }
} else {
  await esbuild.build(options);
}
