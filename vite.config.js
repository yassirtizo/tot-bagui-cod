import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;
let hmrConfig;

if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT) || 8002,
    clientPort: 443,
  };
}

// Shopify's App Proxy forwards storefront requests (e.g. the COD popup's
// fetch call) to this dev server through the Cloudflare tunnel. The browser's
// Origin header stays the store's domain, but the raw `Host` header on the
// forwarded request is the tunnel's domain — a mismatch that React Router's
// built-in CSRF origin check (added in recent versions) rejects with a 400,
// even though the request is legitimate. Shopify does send the real,
// trustworthy origin in `X-Forwarded-Host`, so we copy it onto `Host` before
// React Router sees the request, making the two match again.
function trustAppProxyHost() {
  return {
    name: "trust-app-proxy-host",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const forwardedHost = req.headers["x-forwarded-host"];
        if (forwardedHost) {
          req.headers.host = Array.isArray(forwardedHost)
            ? forwardedHost[0]
            : forwardedHost;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  server: {
    allowedHosts: [host, ".myshopify.com"],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [trustAppProxyHost(), reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
});