import type { H3Event } from "h3";
import {
  firebaseEnvFromProcess,
  isFirebaseAuthPath,
  respondToFirebaseReservedPath,
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
  const method = event.req.method.toUpperCase();
  const request = new Request(event.url, {
    method,
    headers: event.req.headers,
    body: method === "GET" || method === "HEAD" ? undefined : event.req.body,
    // Node's fetch requires duplex when a stream body is forwarded.
    duplex: "half",
  } as RequestInit);
  return respondToFirebaseReservedPath(request, firebaseEnvFromProcess());
}
