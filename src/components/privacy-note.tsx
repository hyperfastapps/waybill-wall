import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";

const LOCAL_ONLY =
  "This does not log into a carrier as you. Account pages, signatures, and delivery addresses stay on their site. The wall only keeps the numbers, shipper, and captions you type.";

export function PrivacyNote({ firebaseOn }: { firebaseOn: boolean }) {
  if (!firebaseOn) {
    return (
      <p className="flex gap-3 rounded-card border border-line bg-card px-4 py-3 text-sm text-ink">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-stamp" aria-hidden="true" />
        <span>{LOCAL_ONLY}</span>
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="flex gap-3 rounded-card border border-line bg-card px-4 py-3 text-sm text-ink">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-stamp" aria-hidden="true" />
        <span>
          This does not log into a carrier. The first time you pin a slip, Waybill Wall creates an
          anonymous Firebase ID and stores the tracking number, shipper, nickname, and caption in
          Google Firebase (Firestore), tied to that ID.
        </span>
      </p>
      <details
        data-testid="privacy-panel"
        className="rounded-card border border-line bg-card px-4 py-3 text-sm text-ink"
      >
        <summary data-testid="privacy-summary" className="cursor-pointer font-medium">
          What is stored and how to delete it
        </summary>
        <div className="mt-3 grid gap-3">
          <PrivacyDetails />
          <p>
            <Link to="/privacy" className="font-semibold text-stamp">
              Privacy note
            </Link>
          </p>
        </div>
      </details>
    </div>
  );
}

export function PrivacyDetails() {
  return (
    <div className="grid gap-3 text-sm text-ink">
      <p>
        An anonymous Google/Firebase ID is created when you first pin a slip, or when you choose
        “Save my wall to Google” if you have not pinned yet. Someone only opening a shared link does
        not get an account.
      </p>
      <p>
        Firestore stores that wall at <span className="font-medium">walls/&lt;that id&gt;</span>:
        tracking number, shipper, nickname, and caption, up to 12 slips. Linking Google attaches
        your Google account email to the same ID. The wall can then open on another device where you
        use that Google account.
      </p>
      <p>
        If that Google account already has a wall, the slips are combined. The Google wall’s slips
        stay, a tracking number is kept once, and new ones are added until the wall is full at 12.
      </p>
      <p>
        A shared link contains only the slips in the URL hash. It is not a live copy of the saved
        wall, and opening it does not write your account.
      </p>
      <p>
        Sign out leaves the slips on this phone and stops syncing. The next pin starts a new
        anonymous saved wall. “Delete my data” deletes the Firestore wall and the Firebase user, and
        clears the slips on this phone.
      </p>
      <p>
        The app still does not sign into USPS, UPS, FedEx, DHL, HDX, OnTrac, or Amazon. Opening a
        carrier follows their site. If the server has FedEx credentials, checking a FedEx slip sends
        that tracking number to FedEx’s Track API.
      </p>
    </div>
  );
}

export function LocalPrivacyDetails() {
  return (
    <div className="grid gap-3 text-sm text-ink">
      <p>{LOCAL_ONLY}</p>
      <p>
        On this copy of Waybill Wall, Firebase is not configured. Slips stay in this browser and in
        the share link. A shared link contains only the slips in the URL hash. Nothing is written to
        Firestore, and no Firebase ID is created.
      </p>
      <p>
        The app does not sign into USPS, UPS, FedEx, DHL, HDX, OnTrac, or Amazon. If the server has
        FedEx credentials, checking a FedEx slip sends that tracking number to FedEx’s Track API.
      </p>
    </div>
  );
}
