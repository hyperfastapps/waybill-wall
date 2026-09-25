import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Link2, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { lookupShipment, type PublicTrack } from "@/lib/fedex-track";
import {
  CARRIERS,
  carrierById,
  guessCarrier,
  isCarrierId,
  isTrackingNumber,
  trackUrl,
  type CarrierId,
} from "@/lib/carriers";
import {
  WALL_HASH_PREFIX,
  WALL_STORAGE_KEY,
  decodeWall,
  encodeWall,
  normalizeNumber,
  type Slip,
} from "@/lib/wall-codec";

export const Route = createFileRoute("/")({ component: Home });

type Card = Slip & {
  pending: boolean;
  track: PublicTrack | null;
};

const fieldClass =
  "h-11 w-full rounded-xl border border-line bg-paper px-3 text-base text-ink outline-none placeholder:text-muted focus:border-ink";

function nicknameFor(number: string, nickname: string): string {
  const trimmed = nickname.trim();
  if (trimmed) return trimmed.slice(0, 40);
  return `Parcel · ${number.slice(-4)}`;
}

function Home() {
  const lookup = useServerFn(lookupShipment);
  const [nickname, setNickname] = useState("");
  const [number, setNumber] = useState("");
  const [caption, setCaption] = useState("");
  const [carrier, setCarrier] = useState<CarrierId | "auto">("auto");
  const guessedFor = useRef("");
  const numberRef = useRef("");
  const manualRef = useRef(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [ready, setReady] = useState(false);
  const [shared, setShared] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pinning, setPinning] = useState(false);

  useEffect(() => {
    let initial: Slip[] = [];
    let fromShare = false;
    const hash = window.location.hash.replace(/^#/, "");
    if (hash.startsWith(WALL_HASH_PREFIX)) {
      const decoded = decodeWall(hash.slice(WALL_HASH_PREFIX.length));
      if (decoded && decoded.length > 0) {
        initial = decoded;
        fromShare = true;
      }
    }
    if (!fromShare) {
      try {
        const stored = window.localStorage.getItem(WALL_STORAGE_KEY);
        if (stored) {
          const decoded = decodeWall(stored);
          if (decoded) initial = decoded;
        }
      } catch {
        /* private mode */
      }
    }
    const next = initial.map((slip) => ({ ...slip, pending: true, track: null }));
    setCards(next);
    setShared(fromShare);
    setReady(true);
    void hydrate(next);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const slips: Slip[] = cards.map(({ id, number: n, nickname: k, caption: c, carrier: s }) => ({
      id,
      number: n,
      nickname: k,
      caption: c,
      carrier: s,
    }));
    const encoded = encodeWall(slips);
    try {
      window.localStorage.setItem(WALL_STORAGE_KEY, encoded);
    } catch {
      /* ignore quota */
    }
    const next = slips.length > 0 ? `#${WALL_HASH_PREFIX}${encoded}` : "";
    if (window.location.hash !== next) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}${next}`,
      );
    }
  }, [cards, ready]);

  async function hydrate(targets: Card[]) {
    await Promise.all(
      targets.map(async (card) => {
        let track: PublicTrack | null = null;
        try {
          track = await lookup({ data: { number: card.number, carrier: card.carrier } });
        } catch {
          track = null;
        }
        setCards((current) =>
          current.map((item) => (item.id === card.id ? { ...item, pending: false, track } : item)),
        );
      }),
    );
  }

  function guessNow(raw: string) {
    const cleaned = normalizeNumber(raw);
    if (!isTrackingNumber(cleaned)) return;
    if (manualRef.current && cleaned === guessedFor.current) return;
    guessedFor.current = cleaned;
    manualRef.current = false;
    setCarrier(guessCarrier(cleaned));
  }

  function onNumberChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    const previousLength = normalizeNumber(numberRef.current).length;
    numberRef.current = next;
    setNumber(next);
    const cleaned = normalizeNumber(next);
    const inputType = (event.nativeEvent as InputEvent).inputType ?? "";
    const pasted =
      inputType === "insertFromPaste" ||
      inputType === "insertFromDrop" ||
      inputType === "insertReplacementText";
    const jumped = cleaned.length - previousLength >= 4;
    const finished =
      /^1Z[A-Z0-9]{16}$/i.test(cleaned) ||
      /^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(cleaned) ||
      /^\d{12}$/.test(cleaned) ||
      /^\d{15}$/.test(cleaned) ||
      /^\d{20,34}$/.test(cleaned) ||
      /^[CD]\d{14}$/i.test(cleaned) ||
      /^1LS[A-Z0-9]{5,}$/i.test(cleaned) ||
      /^BN[A-Z0-9]{6,}$/i.test(cleaned);
    if (pasted || jumped || finished) guessNow(next);
  }

  async function onPin() {
    const cleaned = normalizeNumber(numberRef.current);
    if (!isTrackingNumber(cleaned)) {
      toast.error("Use 8 to 40 letters or digits.");
      return;
    }
    if (cards.some((card) => card.number === cleaned)) {
      toast("That number is already on the wall.");
      return;
    }
    if (cards.length >= 12) {
      toast.error("Twelve slips is the wall’s limit. Remove one first.");
      return;
    }
    const resolved = carrier === "auto" ? guessCarrier(cleaned) : carrier;
    setPinning(true);
    const slip: Card = {
      id: crypto.randomUUID(),
      number: cleaned,
      nickname: nicknameFor(cleaned, nickname),
      caption: caption.trim().slice(0, 140),
      carrier: resolved,
      pending: true,
      track: null,
    };
    setCards((current) => [slip, ...current]);
    setNumber("");
    numberRef.current = "";
    setNickname("");
    setCaption("");
    guessedFor.current = "";
    manualRef.current = false;
    setCarrier("auto");
    setConfirmClear(false);
    setPinning(false);
    void hydrate([slip]);
  }

  function removeCard(id: string) {
    setCards((current) => current.filter((card) => card.id !== id));
  }

  async function copyLink() {
    if (cards.length === 0) {
      toast("Pin a number before sharing the wall.");
      return;
    }
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied. Anyone with it sees these slips.");
    } catch {
      toast.error("Couldn’t copy. Select the address bar instead.");
    }
  }

  function clearWall() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setCards([]);
    setShared(false);
    setConfirmClear(false);
    toast("Wall cleared on this browser.");
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 pb-10 pt-3 sm:px-6">
      <header className="flex items-center justify-between gap-3 pb-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Waybill Wall</h1>
        <button
          type="button"
          onClick={() => void copyLink()}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-stamp px-3 text-sm font-semibold text-stamp-ink"
        >
          <Link2 className="size-4" aria-hidden="true" />
          Copy link
        </button>
      </header>

      <form
        onSubmit={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          const target = event.target;
          if (!(target instanceof Element) || target.closest("#tracking-number")) return;
          const field = document.getElementById("tracking-number");
          const raw = field instanceof HTMLInputElement ? field.value : numberRef.current;
          if (raw && raw !== numberRef.current) {
            numberRef.current = raw;
            setNumber(raw);
          }
          if (raw) guessNow(raw);
        }}
        className="grid gap-2 rounded-card border border-line bg-card p-3"
      >
        <label className="grid gap-1 text-sm font-medium">
          Tracking number
          <input
            id="tracking-number"
            value={number}
            onChange={onNumberChange}
            onBlur={(event) => guessNow(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            onPaste={(event) => {
              const text = event.clipboardData?.getData("text") ?? "";
              const cleaned = normalizeNumber(text);
              if (!cleaned) return;
              event.preventDefault();
              numberRef.current = cleaned;
              setNumber(cleaned);
              guessNow(cleaned);
            }}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Paste a number"
            className={`${fieldClass} tabular-nums`}
            required
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Shipper
          <select
            value={carrier}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "auto") {
                manualRef.current = false;
                setCarrier("auto");
              } else if (isCarrierId(next)) {
                manualRef.current = true;
                guessedFor.current = normalizeNumber(numberRef.current);
                setCarrier(next);
              }
            }}
            className={fieldClass}
          >
            <option value="auto">Auto-Detect</option>
            {CARRIERS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Nickname (optional)
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            maxLength={40}
            placeholder="The espresso machine"
            className={fieldClass}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Caption (optional)
          <input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            maxLength={140}
            placeholder="Should land before Friday"
            className={fieldClass}
          />
        </label>
        <button
          type="button"
          onClick={() => void onPin()}
          disabled={pinning}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-ink px-4 text-sm font-semibold text-card disabled:opacity-60"
        >
          Pin to the wall
        </button>
      </form>

      <section className="mt-6" aria-live="polite">
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold">On the wall</h2>
          <button
            type="button"
            onClick={clearWall}
            disabled={cards.length === 0}
            className="h-11 rounded-xl px-3 text-sm font-medium text-muted disabled:opacity-40"
          >
            {confirmClear ? "Confirm clear" : "Clear wall"}
          </button>
        </div>

        {!ready ? (
          <p className="text-sm text-muted">Opening the wall…</p>
        ) : cards.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-card px-5 py-10 text-center">
            <p className="font-display text-2xl">Nothing pinned yet.</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
              Add a number you are willing to show. The share link carries those slips and nothing
              else.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {cards.map((card) => (
              <li
                key={card.id}
                className="rise overflow-hidden rounded-card border border-line bg-card"
              >
                <div className="flex">
                  <div className="w-1.5 shrink-0 bg-stamp" aria-hidden="true" />
                  <div className="min-w-0 flex-1 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-xl leading-tight">{card.nickname}</p>
                        <p className="mt-1 truncate text-sm tabular-nums text-muted">
                          {carrierById(card.carrier).name} · {card.number}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeCard(card.id)}
                        className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-paper hover:text-ink"
                        aria-label={`Remove ${card.nickname}`}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>

                    {card.caption ? <p className="mt-3 text-sm text-ink">{card.caption}</p> : null}

                    <div className="mt-4 border-t border-dashed border-line pt-3">
                      {card.pending ? (
                        <p className="flex items-center gap-2 text-sm text-muted">
                          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                          Checking the public tracker…
                        </p>
                      ) : card.track ? (
                        <TrackBody track={card.track} />
                      ) : (
                        <p className="text-sm text-muted">Couldn’t reach the tracker just now.</p>
                      )}
                    </div>

                    <a
                      href={trackUrl(card.carrier, card.number)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex h-11 items-center gap-2 text-sm font-semibold text-stamp"
                    >
                      Open on {carrierById(card.carrier).name}
                      <ExternalLink className="size-4" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-8 grid gap-3">
        {shared ? (
          <p className="text-sm text-muted">
            Opened from a shared link. Editing it updates this browser’s copy.
          </p>
        ) : null}
        <p className="flex gap-3 rounded-card border border-line bg-card px-4 py-3 text-sm text-ink">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-stamp" aria-hidden="true" />
          <span>
            This does not log into a carrier as you. Account pages, signatures, and delivery
            addresses stay on their site. The wall only keeps the numbers, shipper, and captions you
            type.
          </span>
        </p>
      </div>
    </main>
  );
}

function TrackBody({ track }: { track: PublicTrack }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-semibold">{track.headline}</p>
      <p className="text-sm text-muted">{track.detail}</p>
      {track.outcome === "live" ? (
        <dl className="mt-1 grid gap-1 text-sm">
          {track.service ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Service</dt>
              <dd className="text-right">{track.service}</dd>
            </div>
          ) : null}
          {track.fromLabel || track.toLabel ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Route</dt>
              <dd className="text-right">
                {[track.fromLabel, track.toLabel].filter(Boolean).join(" → ")}
              </dd>
            </div>
          ) : null}
          {track.eta ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">When</dt>
              <dd className="text-right tabular-nums">{track.eta}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {track.events.length > 0 ? (
        <ol className="mt-2 grid gap-2">
          {track.events.map((event, index) => (
            <li key={`${event.when}-${index}`} className="text-sm">
              <p>{event.what}</p>
              <p className="text-muted">{[event.where, event.when].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
