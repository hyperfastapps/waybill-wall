import { useState } from "react";

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
  const signedIn = mode === "anonymous" || mode === "google";

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
          className="inline-flex h-11 items-center rounded-xl border border-line bg-card px-3 text-sm text-muted"
        >
          Saved to this account
        </span>
      ) : null}
      {mode === "google" ? (
        <span
          data-testid="account-chip"
          className="inline-flex h-11 max-w-full items-center truncate rounded-xl border border-line bg-card px-3 text-sm"
        >
          {email ?? "Google account"}
        </span>
      ) : null}
      {mode !== "google" ? (
        <button
          type="button"
          data-testid="save-google"
          disabled={busy}
          onClick={onGoogle}
          className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-semibold text-stamp disabled:opacity-60"
        >
          Save my wall to Google
        </button>
      ) : null}
      {signedIn ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onSignOut}
            className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-medium text-muted disabled:opacity-60"
          >
            Sign out
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
