/** Paths Firebase Auth loads from `authDomain`. */
export function isFirebaseAuthPath(pathname: string): boolean {
  return (
    pathname === "/__/auth" ||
    pathname.startsWith("/__/auth/") ||
    pathname === "/__/firebase" ||
    pathname.startsWith("/__/firebase/")
  );
}

export function readFirebaseProjectId(): string {
  return (process.env.VITE_FIREBASE_PROJECT_ID ?? "").trim();
}

/**
 * Reverse-proxy Firebase's auth handler so it is served from this site.
 * `authDomain` should be the site itself (for example waybill-wall.vercel.app),
 * which keeps the redirect inside Android Chrome and an installed PWA.
 */
export async function proxyFirebaseHostingRequest(
  request: Request,
  projectId: string,
): Promise<Response> {
  const incoming = new URL(request.url);
  if (!isFirebaseAuthPath(incoming.pathname)) {
    return new Response("Not found", { status: 404 });
  }
  if (!/^[a-z0-9-]+$/i.test(projectId)) {
    return new Response("Firebase project id is not configured.", { status: 404 });
  }
  const target = new URL(
    incoming.pathname + incoming.search,
    `https://${projectId}.firebaseapp.com`,
  );
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");
  const method = request.method.toUpperCase();
  const upstream = await fetch(target, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
    redirect: "manual",
  });
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "set-cookie" || lower === "content-encoding" || lower === "content-length")
      return;
    if (lower === "connection" || lower === "transfer-encoding" || lower === "keep-alive") return;
    out.set(key, value);
  });
  const setCookies =
    typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  for (const cookie of setCookies) out.append("set-cookie", cookie);
  out.set("cache-control", "no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}
