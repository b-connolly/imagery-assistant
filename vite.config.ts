import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const proxyTarget =
    (env.VITE_MCP_PROXY_TARGET || "http://127.0.0.1:8808").replace(/\/+$/, "");

  const proxyOptions = {
    target: proxyTarget,
    changeOrigin: true,
  };

  return {
    plugins: [react()],
    base: "/apps/imagery-assistant/",
    server: {
      proxy: {
        // MCP relay for external MCP servers (CORS bypass)
        "/dev-mcp-relay": {
          target: "http://127.0.0.1",
          changeOrigin: true,
          router(req: any): string {
            const after = (req.url as string)
              .replace(/^\/dev-mcp-relay/, "")
              .replace(/\?.*$/, "");
            const m = after.match(/^\/(https?)\/([^/?#]+)/);
            if (!m) return proxyTarget;
            return `${m[1]}://${m[2]}`;
          },
          rewrite(path: string): string {
            const stripped = path.replace(/^\/dev-mcp-relay\/https?\/[^/?#]+/, "");
            return stripped.startsWith("/") ? stripped : `/${stripped}`;
          },
        },
        // Local MCP hub proxy
        "/api/mcp": {
          ...proxyOptions,
          rewrite: (path: string) => path.replace(/^\/api\/mcp/, ""),
        },
      },
    },
    build: {
      target: "esnext",
    },
  };
});
