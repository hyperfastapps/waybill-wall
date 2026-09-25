import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
// @ts-expect-error JS plugin alongside the TS vite config
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";
// @ts-expect-error JS plugin alongside the TS vite config
import { appEnvPlugin } from "./scripts/app-env-plugin.mjs";
import {
  isFirebaseAuthPath,
  proxyFirebaseHostingRequest,
  readFirebaseProjectId,
} from "./src/lib/firebase-auth-proxy.ts";

/**
 * `/auth/popup` stays intercepted so a React route cannot paint the app shell
 * inside a popup. Waybill Wall does not use that sign-in flow.
 */
function authPopupPlugin(): Plugin {
  return {
    name: "app-builder:auth-popup",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathOnly = (req.url ?? "").split("?", 1)[0] ?? "";
        if (pathOnly !== "/auth/popup") {
          next();
          return;
        }
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("Sign-in popups are not used by Waybill Wall.");
      });
    },
  };
}

/**
 * Dev server half of the same-origin Firebase Auth handler. Production uses
 * `server/middleware/firebase-auth-proxy.ts`.
 */
function firebaseAuthProxyPlugin(): Plugin {
  return {
    name: "waybill:firebase-auth-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (!isFirebaseAuthPath(pathOnly)) {
            next();
            return;
          }
          const projectId = readFirebaseProjectId();
          if (!projectId) {
            res.statusCode = 404;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Firebase is not configured.");
            return;
          }
          const host = String(req.headers.host ?? "localhost:8080");
          const proto = String(
            req.headers["x-forwarded-proto"] ??
              ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https" : "http"),
          );
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const item of value) headers.append(key, item);
            } else headers.set(key, value);
          }
          const method = (req.method ?? "GET").toUpperCase();
          const body = method === "GET" || method === "HEAD" ? undefined : await readNodeBody(req);
          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method,
            headers,
            body,
          });
          const response = await proxyFirebaseHostingRequest(request, projectId);
          await writeNodeResponse(res, response);
        } catch (error) {
          console.error("[waybill] Firebase auth proxy failed:", error);
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Firebase auth proxy failed.");
          }
        }
      });
    },
  };
}

function readNodeBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function writeNodeResponse(
  res: import("node:http").ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  const setCookies =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    res.setHeader(key, value);
  });
  for (const cookie of setCookies) res.appendHeader("set-cookie", cookie);
  res.end(Buffer.from(await response.arrayBuffer()));
}

// `0.0.0.0:8080` is the live-preview contract — don't change host/port.
export default defineConfig(({ command, isPreview }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    authPopupPlugin(),
    firebaseAuthProxyPlugin(),
    // Dev-only /__app-env, read by scripts/check-auth-invariant.mjs.
    appEnvPlugin(),
    // PWA head + ?install=1 tutorial page; runs before Start/Nitro.
    grokPwaPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            preset: "vercel",
            // Auto-registers server/middleware/* (the PWA install page +
            // manifest + head-tag middleware). Nitro v3 defaults serverDir to
            // false, so removing this silently unwires /?install=1 on deploys.
            serverDir: "./server",
          }),
        ]
      : []),
    viteReact(),
  ],
}));
