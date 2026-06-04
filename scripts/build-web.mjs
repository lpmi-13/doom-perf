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
import { createServer, request as httpRequest } from "node:http";

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

// Public dev-server port and the Go telemetry collector it fronts. The wrapper
// below proxies /telemetry and /healthz to the collector so the browser reaches
// it same-origin -- exactly how nginx fronts the collector in the iximiuz prod
// VM. Keeping dev and prod on the same origin means the EventSource never makes
// a cross-origin request, so the collector needs no CORS headers.
const DEV_PORT = 8000;
const DEV_HOST = "127.0.0.1";
const TELEMETRY_HOST = process.env.DOOM_TELEMETRY_HOST ?? "127.0.0.1";
const TELEMETRY_PORT = Number(process.env.DOOM_TELEMETRY_PORT ?? 9999);

// Stream a request through to `target`, copying status/headers verbatim. Both
// directions are piped (never buffered) so Server-Sent-Events flush chunk by
// chunk and the telemetry stream stays live.
const proxyRequest = (target, clientReq, clientRes) => {
  const proxyReq = httpRequest(
    {
      host: target.host,
      port: target.port,
      method: clientReq.method,
      path: clientReq.url,
      headers: { ...clientReq.headers, host: `${target.host}:${target.port}` },
    },
    (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(clientRes);
    }
  );
  proxyReq.on("error", (err) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "content-type": "text/plain" });
    }
    clientRes.end(`telemetry proxy error: ${err.message}\n`);
  });
  clientReq.pipe(proxyReq);
};

if (watch || serve) {
  const ctx = await esbuild.context(options);
  if (watch) await ctx.watch();
  if (serve) {
    // esbuild serves the static files + in-memory bundle on an ephemeral
    // internal port (port: 0); our http server out front owns the public
    // DEV_PORT, routing telemetry to the collector and everything else to
    // esbuild. (esbuild's own serve defaults to 8000, so it must not be left to
    // claim the public port.)
    const esbuildServer = await ctx.serve({ host: DEV_HOST, port: 0, servedir: "public" });
    const esbuildTarget = { host: DEV_HOST, port: esbuildServer.port };
    const telemetryTarget = { host: TELEMETRY_HOST, port: TELEMETRY_PORT };

    const proxy = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      const target = path === "/telemetry" || path === "/healthz" ? telemetryTarget : esbuildTarget;
      proxyRequest(target, req, res);
    });
    proxy.listen(DEV_PORT, DEV_HOST, () => {
      console.log(`[build-web] serving http://${DEV_HOST}:${DEV_PORT}`);
      console.log(`[build-web] proxying /telemetry -> http://${TELEMETRY_HOST}:${TELEMETRY_PORT}`);
    });
  }
} else {
  await esbuild.build(options);
}
