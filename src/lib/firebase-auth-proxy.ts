import { readFirebaseConfig, type FirebaseEnv } from "./firebase-config.ts";

/** Paths Firebase Auth loads from `authDomain`. */
export function isFirebaseAuthPath(pathname: string): boolean {
  return (
    pathname === "/__/auth" ||
    pathname.startsWith("/__/auth/") ||
    pathname === "/__/firebase" ||
    pathname.startsWith("/__/firebase/")
  );
}

const INIT_JSON_PATH = "/__/firebase/init.json";

export function firebaseEnvFromProcess(
  env: Record<string, string | undefined> = process.env,
): FirebaseEnv {
  return {
    VITE_FIREBASE_API_KEY: env.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN: env.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID: env.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: env.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: env.VITE_FIREBASE_APP_ID,
  };
}

/**
 * Same document Firebase Hosting would serve at `/__/firebase/init.json`.
 * The auth handler compares `apiKey` with the app. Hosting is not enabled
 * on this project, so the app serves it from the VITE_FIREBASE_* config.
 */
export function firebaseInitJson(env: FirebaseEnv): string | null {
  const config = readFirebaseConfig(env);
  if (!config) return null;
  return JSON.stringify({
    apiKey: config.web.apiKey,
    appId: config.web.appId,
    authDomain: config.web.authDomain,
    messagingSenderId: config.web.messagingSenderId,
    projectId: config.web.projectId,
    storageBucket: config.web.storageBucket,
  });
}

export function readFirebaseProjectId(): string {
  return (process.env.VITE_FIREBASE_PROJECT_ID ?? "").trim();
}

/**
 * `/__/auth/*` is proxied to the project's auth handler (that endpoint works
 * without Firebase Hosting). `authDomain` should be this site, for example
 * waybill-wall.vercel.app, so the Google redirect stays first-party.
 * `/__/firebase/init.json` is served here. Other `/__/firebase/*` paths are
 * not proxied: Hosting is not set up, and the upstream answer is an HTML
 * "Site Not Found" page.
 */
export async function respondToFirebaseReservedPath(
  request: Request,
  env: FirebaseEnv,
): Promise<Response> {
  const incoming = new URL(request.url);
  if (incoming.pathname === INIT_JSON_PATH) {
    const body = firebaseInitJson(env);
    if (!body) {
      return new Response("Firebase is not configured.", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  if (incoming.pathname === "/__/firebase" || incoming.pathname.startsWith("/__/firebase/")) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  return proxyFirebaseHostingRequest(request, (env.VITE_FIREBASE_PROJECT_ID ?? "").trim());
}

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
