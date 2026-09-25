import { createFileRoute, Link } from "@tanstack/react-router";
import { LocalPrivacyDetails, PrivacyDetails } from "@/components/privacy-note";
import { readFirebaseConfig } from "@/lib/firebase-config";

const firebaseOn =
  readFirebaseConfig({
    VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
  }) !== null;

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [{ title: "Privacy · Waybill Wall" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 pb-10 pt-3 sm:px-6">
      <header className="pb-4">
        <Link to="/" className="text-sm font-semibold text-stamp">
          Waybill Wall
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">Privacy</h1>
      </header>
      <div className="rounded-card border border-line bg-card px-4 py-4">
        {firebaseOn ? <PrivacyDetails /> : <LocalPrivacyDetails />}
      </div>
    </main>
  );
}
