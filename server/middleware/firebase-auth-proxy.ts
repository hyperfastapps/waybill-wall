import type { H3Event } from "h3";
import {
  isFirebaseAuthPath,
  proxyFirebaseHostingRequest,
  readFirebaseProjectId,
} from "../../src/lib/firebase-auth-proxy";

/**
 * Production half of the same-origin Firebase Auth handler. Nitro registers
 * every file in `server/middleware`. The dev server uses the Vite plugin.
 */
export default async function firebaseAuthProxy(
  event: H3Event,
  next: () => Promise<unknown>,
): Promise<unknown> {
  if (!isFirebaseAuthPath(event.url.pathname)) return next();
  const projectId = readFirebaseProjectId();
  if (!projectId) {
    return new Response("Firebase is not configured.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const method = event.req.method.toUpperCase();
  const request = new Request(event.url, {
    method,
    headers: event.req.headers,
    body: method === "GET" || method === "HEAD" ? undefined : event.req.body,
    // Node's fetch requires duplex when a stream body is forwarded.
    duplex: "half",
  } as RequestInit);
  return proxyFirebaseHostingRequest(request, projectId);
}
