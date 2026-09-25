import { useEffect, useRef, useState } from "react";
import type { FirebaseClientConfig } from "@/lib/firebase-config";
import { planInitialMerge, planWallWrite } from "@/lib/wall-sync-plan";
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
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const noticeId = useRef(0);
  const sessionRef = useRef<FirebaseSession | null>(null);
  const appliedStartup = useRef(false);
  const pushChain = useRef(Promise.resolve());

  function publishNotice(text: string | null) {
    if (!text) return;
    noticeId.current += 1;
    setNotice({ id: noticeId.current, text });
  }

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
          setSync("saved");
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
        setSync("saved");
      })
      .catch(() => {
        if (!cancel) setSync("error");
      });
    return () => {
      cancel = true;
    };
  }, [config, ready, suspended]);

  useEffect(() => {
    if (!config || !ready || revision <= 0) return;
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
          revision,
        });
        if (plan === "skip" || plan === "local-only") return;
        await session.push(() => slipsHolder.current, plan === "create-and-push" || identity);
        setSync("saved");
      })
      .catch(() => {
        setSync("error");
        publishNotice("Saved on this phone. It will sync when you’re back online.");
      });
  }, [config, ready, revision]);

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
