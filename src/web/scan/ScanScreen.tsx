import { useCallback, useEffect, useRef, useState } from "react";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { CardImage } from "../../components/CardImage.tsx";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { artRect, perceptualHash } from "../../scan/phash.ts";
import { guideRect, guideStyle } from "../../scan/frame.ts";
import { loadCardIndex, identify, type CardIndex, type ScanResult } from "../../scan/cardIndex.ts";
import type { CollectFinish } from "../../models/cards.ts";
import styles from "./ScanScreen.module.css";

/**
 * Point the camera at a card and mark it owned.
 *
 * Web only, and lazy-loaded so the glasses never download it: they have no
 * pointer, no camera API, and a 600x600 additive display where a live preview
 * would cost every row of the list it replaced.
 *
 * Recognition is entirely on-device — the artwork is hashed and matched against
 * a 13KB index shipped with the app. Nothing is uploaded, no round-trip is on
 * the scan path, and it works with the phone in aeroplane mode.
 *
 * There is deliberately no card-boundary detection here. Measured over 374 real
 * cards, cropping to a fixed guide with a 3% alignment error still identified
 * 99.7% of them with zero false accepts, and OpenCV.js is 8-11MB of wasm that
 * cannot use threads on GitHub Pages. Detection has to beat that number before
 * it is worth its download.
 */

const CAPTURE_WIDTH = 245;
const CAPTURE_HEIGHT = 342;

type Phase =
  | { at: "idle" }
  | { at: "starting" }
  | { at: "live" }
  | { at: "denied"; reason: string }
  | { at: "unsupported" };

export function ScanScreen() {
  const { pop, push } = useNavigation();
  const { toggleOwned, ownedFinishes } = useLibrary();

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [index, setIndex] = useState<CardIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  // Start loading the index immediately: it is 13KB and the camera permission
  // prompt is far slower, so this is free if it happens now and a stall if it
  // waits for the first capture.
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

  // Releasing the camera matters more than usual here: a stream left open keeps
  // the indicator lit and the sensor warm, which on a phone is both alarming
  // and a battery drain.
  useEffect(() => {
    return () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, []);

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
    setResult(identify(index, hash, 3));
  }, [index]);

  const mark = (cardId: string, setId: string, finish: CollectFinish) => {
    toggleOwned(cardId, finish, setId);
    setAdded((prev) => [`${cardId}|${finish}`, ...prev].slice(0, 20));
    setResult(null);
  };

  const busy = phase.at === "starting";
  const live = phase.at === "live";

  return (
    <Screen
      title="Scan"
      headerLeft={<BackRow focused={false} onActivate={pop} />}
      headerRight={added.length ? `${added.length} added` : undefined}
      canGoBack
    >
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
                Line a card up inside the frame. Everything happens on this device — nothing is uploaded.
              </p>
            )}
          </div>
        ) : null}
      </div>

      {indexError ? <p className={styles.error}>Card index unavailable: {indexError}</p> : null}

      <div className={styles.controls}>
        {live ? (
          <button type="button" className={styles.shutter} onClick={capture} disabled={!index}>
            {index ? "Capture" : "Loading cards…"}
          </button>
        ) : (
          <button type="button" className={styles.shutter} onClick={() => void start()} disabled={busy}>
            {busy ? "Starting camera…" : "Start camera"}
          </button>
        )}
      </div>

      {result ? (
        <div className={styles.result} role="group" aria-label="Scan result">
          {result.candidates.length === 0 ? (
            <p className={styles.hint}>No match. Try again with more light.</p>
          ) : (
            <>
              <p className={styles.verdict}>
                {result.confident ? "Match" : "Not sure — pick one"}
                <span className={styles.distance}>{result.candidates[0].distance} bits</span>
              </p>
              <ul className={styles.candidates}>
                {(result.confident ? result.candidates.slice(0, 1) : result.candidates).map(
                  ({ card, distance }) => {
                    const held = ownedFinishes(card.id);
                    return (
                      <li key={card.id} className={styles.candidate}>
                        <CardImage src={undefined} alt="" size="thumb" />
                        <div className={styles.meta}>
                          <span className={styles.name}>{card.name}</span>
                          <span className={styles.sub}>
                            {card.setName} · {card.number}
                            {result.confident ? "" : ` · ${distance} bits`}
                          </span>
                          {held.length > 0 ? (
                            <span className={styles.owned}>already own {held.join(", ")}</span>
                          ) : null}
                        </div>
                        <div className={styles.actions}>
                          {/* Normal and reverse cover the overwhelming majority
                              of what gets pulled from a pack. Anything rarer is
                              a tap away on the card itself, where every printing
                              the set actually has is listed. */}
                          <button type="button" onClick={() => mark(card.id, card.setId, "normal")}>
                            Normal
                          </button>
                          <button type="button" onClick={() => mark(card.id, card.setId, "reverse")}>
                            Reverse
                          </button>
                          <button
                            type="button"
                            className={styles.link}
                            onClick={() => push({ name: "set", setId: card.setId, setName: card.setName })}
                          >
                            Open set
                          </button>
                        </div>
                      </li>
                    );
                  },
                )}
              </ul>
              <button type="button" className={styles.dismiss} onClick={() => setResult(null)}>
                Skip
              </button>
            </>
          )}
        </div>
      ) : null}

      {index ? (
        <p className={styles.footnote}>{index.cards.length.toLocaleString()} cards indexed from your sets.</p>
      ) : null}
    </Screen>
  );
}
