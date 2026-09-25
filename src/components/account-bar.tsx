import { useEffect, useState } from "react";

type AccountMode = "signed-out" | "anonymous" | "google";

type Props = {
  mode: AccountMode;
  email: string | null;
  uid: string | null;
  busy: boolean;
  sync: string;
  syncDetail: string | null;
  onGoogle: () => void;
  onSignOut: () => void;
  onDelete: () => void;
};

export function AccountBar({
  mode,
  email,
  uid,
  busy,
  sync,
  syncDetail,
  onGoogle,
  onSignOut,
  onDelete,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const signedIn = mode === "anonymous" || mode === "google";

  useEffect(() => {
    setConfirmSignOut(false);
  }, [mode]);

  return (
    <div
      data-testid="account-bar"
      data-account={mode}
      data-sync={sync}
      data-uid={uid ?? ""}
      className="mb-3 flex flex-wrap items-center gap-2"
    >
      {mode === "anonymous" ? (
        <span
          data-testid="account-chip"
          className="inline-flex h-11 max-w-full items-center rounded-xl border border-line bg-card px-3 text-sm text-muted"
        >
          Saved on this device · anonymous
        </span>
      ) : null}
      {mode === "anonymous" && confirmSignOut ? (
        <p
          id="anonymous-sign-out-note"
          data-testid="sign-out-confirm"
          className="w-full text-sm leading-snug text-ink"
        >
          This anonymous wall can’t be opened again after you sign out. Save it to Google first, or
          sign out and leave it behind.
        </p>
      ) : null}
      {mode === "google" ? (
        <span
          data-testid="account-chip"
          className="inline-flex h-11 max-w-full min-w-0 items-center rounded-xl border border-line bg-card px-3 text-sm"
        >
          <span className="truncate">{email ? `Saved to ${email}` : "Saved to Google"}</span>
        </span>
      ) : null}
      {mode !== "google" ? (
        <button
          type="button"
          data-testid="save-google"
          disabled={busy}
          onClick={() => {
            setConfirmSignOut(false);
            onGoogle();
          }}
          className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-semibold text-stamp disabled:opacity-60"
        >
          Save my wall to Google
        </button>
      ) : null}
      {signedIn ? (
        <>
          <button
            type="button"
            data-testid="sign-out"
            disabled={busy}
            aria-describedby={
              mode === "anonymous" && confirmSignOut ? "anonymous-sign-out-note" : undefined
            }
            onClick={() => {
              if (mode === "anonymous" && !confirmSignOut) {
                setConfirmSignOut(true);
                return;
              }
              setConfirmSignOut(false);
              onSignOut();
            }}
            className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-medium text-muted disabled:opacity-60"
          >
            {mode === "anonymous" && confirmSignOut ? "Sign out anyway" : "Sign out"}
          </button>
          <button
            type="button"
            data-testid="delete-data"
            disabled={busy}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              setConfirmDelete(false);
              onDelete();
            }}
            className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-medium text-muted disabled:opacity-60"
          >
            {confirmDelete ? "Confirm delete" : "Delete my data"}
          </button>
        </>
      ) : null}
      {sync === "error" && syncDetail ? (
        <p className="w-full text-sm text-muted" data-testid="sync-detail">
          {syncDetail}
        </p>
      ) : null}
    </div>
  );
}
