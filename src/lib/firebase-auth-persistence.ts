import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  indexedDBLocalPersistence,
  type Persistence,
} from "firebase/auth";

/**
 * IndexedDB first, then localStorage. `initializeAuth` copies a user saved by
 * the previous localStorage-only persistence into IndexedDB and removes that
 * older copy. If IndexedDB is unavailable, localStorage is used as-is.
 * The redirect resolver stays on, or Google sign-in throws before leaving the page.
 */
export function wallAuthInitOptions(): {
  persistence: Persistence[];
  popupRedirectResolver: typeof browserPopupRedirectResolver;
} {
  return {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  };
}
