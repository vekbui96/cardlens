import { useCallback, useEffect, useRef, useState } from "react";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { artRect, perceptualHash } from "../../scan/phash.ts";
import { guideRect, guideStyle } from "../../scan/frame.ts";
import { loadCardIndex, identify, type CardIndex, type ScanResult } from "../../scan/cardIndex.ts";
import { autoHint, decide, initialAutoState, type AutoState, type Decision } from "../../scan/autoCapture.ts";
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
  const { addManyOwned } = useLibrary();

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const nextKey = useRef(1);

  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [index, setIndex] = useState<CardIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Capture[]>([]);
  const [reviewing, setReviewing] = useState(false);
  /** Video has real dimensions. Capturing before that reads a 0x0 frame. */
  const [ready, setReady] = useState(false);
  const [auto, setAuto] = useState(true);
  const [hint, setHint] = useState<Decision["reason"]>("moving");
  const autoState = useRef<AutoState>(initialAutoState);
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

  /**
   * Re-attach the stream whenever the preview comes back.
   *
   * Review renders a different Screen, so React unmounts the <video> and mounts
   * a fresh one on the way back — with no srcObject, and therefore videoWidth
   * of 0, so every capture afterwards silently did nothing and the preview was
   * black. The MediaStream itself is held in a ref and survives; only the
   * element needs reconnecting.
   */
  useEffect(() => {
    const el = video.current;
    if (reviewing) {
      // The element is unmounted by the review screen; whatever it reported
      // about itself is stale until a new one loads.
      setReady(false);
      return;
    }
    if (!el || !stream.current) return;
    if (el.srcObject !== stream.current) {
      el.srcObject = stream.current;
      void el.play().catch(() => {});
    }
  }, [reviewing, phase]);

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

  /** Hash the guide region of the current frame, or null if there is none. */
  const hashFrame = useCallback(() => {
    const el = video.current;
    if (!el || !el.videoWidth) return null;
    const guide = guideRect(el.videoWidth, el.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    // Crop to the guide and normalise to the size every index entry was built
    // at, so resolution alone can never change a hash.
    ctx.drawImage(el, guide.x, guide.y, guide.w, guide.h, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    const frame = ctx.getImageData(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    return {
      hash: perceptualHash(frame.data, CAPTURE_WIDTH, CAPTURE_HEIGHT, artRect(CAPTURE_WIDTH, CAPTURE_HEIGHT)),
      canvas,
    };
  }, []);

  const capture = useCallback(() => {
    const framed = hashFrame();
    if (!framed || !index) return;
    const result = identify(index, framed.hash, 3);

    // A thumbnail of what the camera actually saw. Reviewing a list of names
    // with no picture is guesswork; this is how you catch the one that went
    // wrong without rescanning the pile.
    const thumb = document.createElement("canvas");
    thumb.width = THUMB_WIDTH;
    thumb.height = Math.round((THUMB_WIDTH * CAPTURE_HEIGHT) / CAPTURE_WIDTH);
    thumb.getContext("2d")?.drawImage(framed.canvas, 0, 0, thumb.width, thumb.height);

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
  }, [index, hashFrame]);

  const live = phase.at === "live";

  /**
   * The detection loop.
   *
   * ~10fps, not 60: detection at frame rate buys nothing a hand can use and
   * costs the main thread the smoothness of the preview. One hash per tick is
   * the entire budget — the same hash answers "has it stopped moving" and
   * "is this still the card I just took".
   */
  useEffect(() => {
    if (!auto || !live || !ready || !index || reviewing) return;
    const timer = window.setInterval(() => {
      const framed = hashFrame();
      if (!framed) return;
      const decision = decide(autoState.current, framed.hash, Date.now());
      autoState.current = decision.state;
      setHint(decision.reason);
      if (decision.capture) capture();
    }, 100);
    return () => window.clearInterval(timer);
  }, [auto, live, ready, index, reviewing, hashFrame, capture]);

  const update = (key: number, patch: Partial<Capture>) =>
    setQueue((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const commit = () => {
    const kept = queue.filter(isKept);
    // One merge and one write for the whole batch. Adding them one at a time
    // re-reads and re-serialises the entire collection per card, which is
    // quadratic over a batch and exactly what a scanner produces. Never
    // toggleOwned: a pile being digitised overlaps what is already held, and
    // toggling would un-mark precisely those.
    addManyOwned(
      kept.flatMap((c) => {
        const card = c.result.candidates[c.choice as number]?.card;
        return card ? [{ cardId: card.id, finish: c.finish, setId: card.setId }] : [];
      }),
    );
    setAddedCount((n) => n + kept.length);
    setQueue([]);
    setReviewing(false);
  };

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
        <video
          ref={video}
          className={live ? styles.video : styles.videoHidden}
          playsInline
          muted
          onLoadedMetadata={() => setReady((video.current?.videoWidth ?? 0) > 0)}
          onPlaying={() => setReady((video.current?.videoWidth ?? 0) > 0)}
        />
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
      <div className={styles.autoRow}>
        <button
          type="button"
          className={`${styles.chip} ${auto ? styles.chipOn : ""}`}
          aria-pressed={auto}
          onClick={() => {
            // Fresh state either way: a stale baseline from before the toggle
            // would either fire immediately or refuse to.
            autoState.current = initialAutoState;
            setAuto((on) => !on);
          }}
        >
          {auto ? "Auto on" : "Auto off"}
        </button>
        <span className={styles.autoNote}>
          {auto ? "Hold a card in the frame — it captures itself" : "Tap to capture each card"}
        </span>
      </div>

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
            disabled={!index || !ready}
            data-testid="capture"
          >
            {!index ? "Loading cards…" : !ready ? "Focusing…" : auto ? autoHint(hint) : "Capture"}
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
