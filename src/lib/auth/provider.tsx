import type { ReactNode } from "react";

/**
 * Root mount point kept for the app shell. Waybill Wall accounts live in
 * Firebase (see `src/lib/firebase-session.ts`), not in this provider.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
