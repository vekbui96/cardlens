import { useCallback, useEffect, useRef, useState } from "react";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { artRect, perceptualHash } from "../../scan/phash.ts";
import { guideRect, guideStyle } from "../../scan/frame.ts";
import { loadCardIndex, identify, type CardIndex, type ScanResult } from "../../scan/cardIndex.ts";
import type { CollectFinish } from "../../models/cards.ts";
import styles from "./ScanScreen.module.css";

/**
 * Point the camera at a card, keep going, review the batch at the end.
 *
 * Web only, and lazy-loaded so the glasses never download it: they have no
 * pointer, no camera API, and a 600x600 additive display where a live preview
 * would cost every row of the list it replaced.
 *
 * Recognition is entirely on-device — the artwork is hashed and matched against
 * the index shipped with the app. Nothing is uploaded, no round-trip is on the
 * scan path, and it works with the phone in aeroplane mode.
 *
 * **Scanning never stops to ask.** A prompt per card turns a stack of two
 * hundred into two hundred decisions, which is the difference between a
 * scanner and a form. Captures queue silently; the questions are asked once,
 * at the end, over the whole batch — and only for the ones the artwork could
 * not settle on its own.
 */

const CAPTURE_WIDTH = 245;
const CAPTURE_HEIGHT = 342;
/** Thumbnails only have to be recognisable to a human reviewing a list. */
const THUMB_WIDTH = 82;

type Phase =
  | { at: "idle" }
  | { at: "starting" }
  | { at: "live" }
  | { at: "denied"; reason: string }
  | { at: "unsupported" };

interface Capture {
  key: number;
  thumb: string;
  result: ScanResult;
  /** Index into candidates, or null when nothing has been chosen yet. */
  choice: number | null;
  finish: CollectFinish;
  rejected: boolean;
}

/** Ready to commit: kept, and something was actually identified. */
function isKept(c: Capture): boolean {
  return !c.rejected && c.choice !== null;
}

export function ScanScreen() {
  const { pop, push } = useNavigation();
  const { toggleOwned } = useLibrary();

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const nextKey = useRef(1);

  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [index, setIndex] = useState<CardIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Capture[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  // The index is 13KB and the permission prompt is far slower, so fetching it
  // now is free and fetching it on first capture is a stall.
  useEffect(() => {
    let live = true;
    loadCardIndex().then(
      (loaded) => live && setIndex(loaded),
      (err: Error) => live && setIndexError(err.message),
    );
    return () => {
      live = false;
    };
  }, []);

  // A stream left open keeps the camera indicator lit and the sensor warm,
  // which on a phone is both alarming and a battery drain.
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    },
    [],
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase({ at: "unsupported" });
      return;
    }
    setPhase({ at: "starting" });
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        // The rear camera, and as much resolution as offered: the art window is
        // a fraction of the frame, so this is what the hash actually sees.
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        audio: false,
      });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play().catch(() => {});
      }
      setPhase({ at: "live" });
    } catch (err) {
      setPhase({ at: "denied", reason: err instanceof Error ? err.name : "unknown" });
    }
  }, []);

  const capture = useCallback(() => {
    const el = video.current;
    if (!el || !index || !el.videoWidth) return;

    const guide = guideRect(el.videoWidth, el.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    // Crop to the guide and normalise to the size every index entry was built
    // at, so resolution alone can never change a hash.
    ctx.drawImage(el, guide.x, guide.y, guide.w, guide.h, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    const frame = ctx.getImageData(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    const hash = perceptualHash(
      frame.data,
      CAPTURE_WIDTH,
      CAPTURE_HEIGHT,
      artRect(CAPTURE_WIDTH, CAPTURE_HEIGHT),
    );
    const result = identify(index, hash, 3);

    // A thumbnail of what the camera actually saw. Reviewing a list of names
    // with no picture is guesswork; this is how you catch the one that went
    // wrong without rescanning the pile.
    const thumb = document.createElement("canvas");
    thumb.width = THUMB_WIDTH;
    thumb.height = Math.round((THUMB_WIDTH * CAPTURE_HEIGHT) / CAPTURE_WIDTH);
    thumb.getContext("2d")?.drawImage(canvas, 0, 0, thumb.width, thumb.height);

    setQueue((prev) => [
      ...prev,
      {
        key: nextKey.current++,
        thumb: thumb.toDataURL("image/jpeg", 0.6),
        result,
        // A confident match needs no decision; an unsure one must not be
        // pre-answered, or the review turns into rubber-stamping.
        choice: result.confident ? 0 : null,
        finish: "normal",
        rejected: false,
      },
    ]);
  }, [index]);

  const update = (key: number, patch: Partial<Capture>) =>
    setQueue((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const commit = () => {
    const kept = queue.filter(isKept);
    for (const c of kept) {
      const card = c.result.candidates[c.choice as number]?.card;
      if (card) toggleOwned(card.id, c.finish, card.setId);
    }
    setAddedCount((n) => n + kept.length);
    setQueue([]);
    setReviewing(false);
  };

  const live = phase.at === "live";
  const unsure = queue.filter((c) => c.choice === null && !c.rejected).length;
  const keeping = queue.filter(isKept).length;

  if (reviewing) {
    return (
      <Screen
        title="Review scans"
        headerLeft={<BackRow focused={false} onActivate={() => setReviewing(false)} />}
        headerRight={`${keeping}/${queue.length}`}
        canGoBack
      >
        {queue.length === 0 ? (
          <p className={styles.hint}>Nothing scanned yet.</p>
        ) : (
          <ul className={styles.review}>
            {queue.map((c) => {
              const chosen = c.choice === null ? null : c.result.candidates[c.choice];
              return (
                <li
                  key={c.key}
                  className={`${styles.row} ${c.rejected ? styles.rowRejected : ""}`}
                  data-testid="review-row"
                >
                  <img className={styles.thumb} src={c.thumb} alt="" />
                  <div className={styles.rowBody}>
                    {c.result.candidates.length === 0 ? (
                      <span className={styles.sub}>No match found</span>
                    ) : chosen && c.result.confident ? (
                      <>
                        <span className={styles.name}>{chosen.card.name}</span>
                        <span className={styles.sub}>
                          {chosen.card.setName} · {chosen.card.number} · {chosen.distance} bits
                        </span>
                      </>
                    ) : (
                      <>
                        <span className={styles.sub}>{c.choice === null ? "Which one?" : "Chosen"}</span>
                        <div className={styles.picker} role="group" aria-label="Pick the card">
                          {c.result.candidates.map((cand, i) => (
                            <button
                              key={cand.card.id}
                              type="button"
                              className={`${styles.option} ${c.choice === i ? styles.optionOn : ""}`}
                              aria-pressed={c.choice === i}
                              onClick={() => update(c.key, { choice: i, rejected: false })}
                            >
                              {cand.card.name}
                              <span className={styles.optionSub}>
                                {cand.card.setName} · {cand.card.number}
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    <div className={styles.rowActions}>
                      {(["normal", "reverse"] as CollectFinish[]).map((f) => (
                        <button
                          key={f}
                          type="button"
                          className={`${styles.chip} ${c.finish === f ? styles.chipOn : ""}`}
                          aria-pressed={c.finish === f}
                          onClick={() => update(c.key, { finish: f })}
                        >
                          {f === "normal" ? "Normal" : "Reverse"}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={styles.chip}
                        aria-pressed={c.rejected}
                        onClick={() => update(c.key, { rejected: !c.rejected })}
                      >
                        {c.rejected ? "Rejected" : "Reject"}
                      </button>
                      {chosen ? (
                        <button
                          type="button"
                          className={styles.link}
                          onClick={() =>
                            push({
                              name: "set",
                              setId: chosen.card.setId,
                              setName: chosen.card.setName,
                            })
                          }
                        >
                          Open set
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className={styles.footer}>
          {unsure > 0 ? (
            <p className={styles.hint}>
              {unsure} still need{unsure === 1 ? "s" : ""} a choice — they will be skipped.
            </p>
          ) : null}
          <button type="button" className={styles.shutter} onClick={commit} disabled={keeping === 0}>
            {keeping > 0 ? `Add ${keeping} card${keeping === 1 ? "" : "s"}` : "Nothing to add"}
          </button>
          <button type="button" className={styles.dismiss} onClick={() => setReviewing(false)}>
            Keep scanning
          </button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      title="Scan"
      headerLeft={<BackRow focused={false} onActivate={pop} />}
      headerRight={addedCount ? `${addedCount} added` : undefined}
      canGoBack
    >
      {/*
        The preview owns the space and never gives it up. Everything below is a
        fixed height that is reserved whether or not there is anything in it —
        a stage that resizes the moment a result appears re-lays-out the guide
        under the card the user is still holding.
      */}
      <div className={styles.stage}>
        <video ref={video} className={live ? styles.video : styles.videoHidden} playsInline muted />
        {live ? (
          <div
            className={styles.guide}
            style={guideStyle(video.current?.videoWidth || 1080, video.current?.videoHeight || 1920)}
            aria-hidden="true"
          >
            <span className={styles.corner} />
            <span className={`${styles.corner} ${styles.tr}`} />
            <span className={`${styles.corner} ${styles.bl}`} />
            <span className={`${styles.corner} ${styles.br}`} />
          </div>
        ) : null}

        {!live ? (
          <div className={styles.placeholder}>
            {phase.at === "unsupported" ? (
              <p className={styles.error}>This browser has no camera API.</p>
            ) : phase.at === "denied" ? (
              <p className={styles.error}>
                Camera blocked ({phase.reason}). Allow it in site settings, then try again.
              </p>
            ) : (
              <p className={styles.hint}>
                Line each card up inside the frame and keep going. Nothing is uploaded, and nothing is added
                until you review.
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* Reserved even when empty, so the preview above never changes size. */}
      <div className={styles.strip} aria-label="Scanned this session">
        {queue.length === 0 ? (
          <span className={styles.stripEmpty}>
            {indexError
              ? indexError
              : index
                ? `${index.cards.length.toLocaleString()} cards indexed from your sets`
                : "Loading cards…"}
          </span>
        ) : (
          queue
            .slice()
            .reverse()
            .map((c) => (
              <img
                key={c.key}
                className={`${styles.stripThumb} ${c.choice === null ? styles.stripUnsure : ""}`}
                src={c.thumb}
                alt=""
              />
            ))
        )}
      </div>

      <div className={styles.controls}>
        {live ? (
          <button
            type="button"
            className={styles.shutter}
            onClick={capture}
            disabled={!index}
            data-testid="capture"
          >
            {index ? "Capture" : "Loading cards…"}
          </button>
        ) : (
          <button
            type="button"
            className={styles.shutter}
            onClick={() => void start()}
            disabled={phase.at === "starting"}
          >
            {phase.at === "starting" ? "Starting camera…" : "Start camera"}
          </button>
        )}
        <button
          type="button"
          className={styles.reviewButton}
          onClick={() => setReviewing(true)}
          disabled={queue.length === 0}
        >
          {queue.length > 0 ? `Done — review ${queue.length}${unsure ? ` (${unsure} unsure)` : ""}` : "Done"}
        </button>
      </div>
    </Screen>
  );
}
