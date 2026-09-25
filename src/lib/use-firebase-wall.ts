import { useCallback, useEffect, useRef, useState } from "react";
import type { FirebaseClientConfig } from "@/lib/firebase-config";
import {
  classifySyncFailure,
  planInitialMerge,
  planWallWrite,
  syncFailureNotice,
  syncRetryDelayMs,
} from "@/lib/wall-sync-plan";
import { sameSlipContent } from "@/lib/wall-merge";
import type { Slip } from "@/lib/wall-codec";
import type { FirebaseSession, WallUser } from "@/lib/firebase-session";

export type AccountMode = "off" | "signed-out" | "anonymous" | "google";
export type SyncState = "off" | "local" | "saved" | "error";

export type FirebaseWallController = {
  mode: AccountMode;
  email: string | null;
  uid: string | null;
  busy: boolean;
  sync: SyncState;
  /** Set while sync is "error". The slips on screen are unchanged. */
  syncDetail: string | null;
  notice: { id: number; text: string } | null;
  linkGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteData: () => Promise<void>;
};

type Options = {
  config: FirebaseClientConfig | null;
  ready: boolean;
  suspended: boolean;
  revision: number;
  createIdentity: boolean;
  slips: Slip[];
  onSlips: (slips: Slip[]) => void;
};

export function useFirebaseWall(options: Options): FirebaseWallController {
  const { config, ready, suspended, revision, createIdentity, slips, onSlips } = options;
  slipsHolder.current = slips;
  const slipsRef = useRef(slips);
  slipsRef.current = slips;
  const onSlipsRef = useRef(onSlips);
  onSlipsRef.current = onSlips;
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const createIdentityRef = useRef(createIdentity);
  createIdentityRef.current = createIdentity;

  const [user, setUser] = useState<WallUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState<SyncState>(config ? "local" : "off");
  const [syncDetail, setSyncDetail] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const noticeId = useRef(0);
  const sessionRef = useRef<FirebaseSession | null>(null);
  const appliedStartup = useRef(false);
  const pushChain = useRef(Promise.resolve());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttempt = useRef(0);
  const failureNoted = useRef(false);

  const publishNotice = useCallback((text: string | null) => {
    if (!text) return;
    noticeId.current += 1;
    setNotice({ id: noticeId.current, text });
  }, []);

  const clearRetry = useCallback(() => {
    if (retryTimer.current != null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  const noteFailure = useCallback(
    (error: unknown) => {
      const text = syncFailureNotice(classifySyncFailure(error));
      setSync("error");
      setSyncDetail(text);
      if (failureNoted.current) return;
      failureNoted.current = true;
      publishNotice(text);
    },
    [publishNotice],
  );

  const markSaved = useCallback(() => {
    retryAttempt.current = 0;
    failureNoted.current = false;
    clearRetry();
    setSync("saved");
    setSyncDetail(null);
  }, [clearRetry]);

  const scheduleRetry = useCallback(() => {
    clearRetry();
    retryAttempt.current += 1;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setRetryTick((value) => value + 1);
    }, syncRetryDelayMs(retryAttempt.current));
  }, [clearRetry]);

  useEffect(() => {
    if (!config) return;
    let cancel = false;
    let unsub = () => {};
    void load(config)
      .then((session) => {
        if (cancel) return;
        sessionRef.current = session;
        unsub = session.subscribe((next) => {
          if (!cancel) setUser(next);
        });
      })
      .catch(() => {
        if (!cancel) setSync("error");
      });
    return () => {
      cancel = true;
      unsub();
    };
  }, [config]);

  useEffect(() => {
    if (!config || !ready || suspended) return;
    let cancel = false;
    void load(config)
      .then(async (session) => {
        if (cancel || suspendedRef.current) return;
        sessionRef.current = session;
        const startup = session.startup;
        if (startup.deleted) {
          if (!appliedStartup.current) {
            appliedStartup.current = true;
            onSlipsRef.current([]);
            publishNotice(startup.notice);
          }
          setSync("local");
          return;
        }
        if (startup.merged) {
          if (!appliedStartup.current) {
            appliedStartup.current = true;
            if (startup.slips && !sameSlipContent(startup.slips, slipsRef.current)) {
              onSlipsRef.current(startup.slips);
            }
            publishNotice(startup.notice);
          }
          markSaved();
          return;
        }
        const plan = planInitialMerge({
          configured: true,
          suspended: false,
          hasUser: session.current() !== null,
          alreadyMerged: startup.merged,
        });
        if (plan === "skip") return;
        const merged = await session.merge("local-wins", slipsRef.current);
        if (cancel || !merged) return;
        if (!sameSlipContent(merged.slips, slipsRef.current)) onSlipsRef.current(merged.slips);
        if (merged.dropped.length > 0) {
          publishNotice("Some slips from another device didn’t fit on the 12-slip wall.");
        }
        markSaved();
      })
      .catch((error: unknown) => {
        // A rejected write must not replace the slips on screen with the older server wall.
        if (!cancel) {
          noteFailure(error);
          scheduleRetry();
        }
      });
    return () => {
      cancel = true;
    };
  }, [config, ready, suspended, markSaved, noteFailure, publishNotice, scheduleRetry]);

  useEffect(() => {
    if (!config || !ready || (revision <= 0 && retryTick <= 0)) return;
    const identity = createIdentityRef.current;
    pushChain.current = pushChain.current
      .catch(() => undefined)
      .then(async () => {
        const session = await load(config);
        sessionRef.current = session;
        const creating = session.isCreatingUser();
        const plan = planWallWrite({
          configured: true,
          suspended: suspendedRef.current,
          hasUser: session.current() !== null || creating,
          createIdentity: identity || creating,
          revision: revision > 0 ? revision : 1,
        });
        if (plan === "skip" || plan === "local-only") return;
        await session.push(() => slipsHolder.current, plan === "create-and-push" || identity);
        markSaved();
      })
      .catch((error: unknown) => {
        noteFailure(error);
        scheduleRetry();
      });
  }, [config, ready, revision, retryTick, markSaved, noteFailure, scheduleRetry]);

  useEffect(() => {
    if (!config) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || retryAttempt.current === 0) return;
      clearRetry();
      setRetryTick((value) => value + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [config, clearRetry]);

  useEffect(() => () => clearRetry(), [clearRetry]);

  async function linkGoogle() {
    if (!config) return;
    setBusy(true);
    try {
      const session = await load(config);
      sessionRef.current = session;
      await session.linkGoogle();
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!config) return;
    setBusy(true);
    try {
      const session = sessionRef.current ?? (await load(config));
      await session.signOut();
      setSync("local");
    } finally {
      setBusy(false);
    }
  }

  async function deleteData() {
    if (!config) return;
    setBusy(true);
    try {
      const session = sessionRef.current ?? (await load(config));
      const result = await session.deleteAccount();
      if (result === "deleted") {
        onSlipsRef.current([]);
        setSync("local");
        publishNotice("Deleted the saved wall and the Firebase account.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return {
      mode: "off",
      email: null,
      uid: null,
      busy: false,
      sync: "off",
      syncDetail: null,
      notice: null,
      linkGoogle: async () => {},
      signOut: async () => {},
      deleteData: async () => {},
    };
  }

  const mode: AccountMode = !user ? "signed-out" : user.anonymous ? "anonymous" : "google";
  return {
    mode,
    email: user?.email ?? null,
    uid: user?.uid ?? null,
    busy,
    sync,
    syncDetail,
    notice,
    linkGoogle,
    signOut,
    deleteData,
  };
}

function load(config: FirebaseClientConfig) {
  return import("@/lib/firebase-session").then(({ loadFirebaseSession }) =>
    loadFirebaseSession(config, () => slipsHolder.current),
  );
}

const slipsHolder = { current: [] as Slip[] };
