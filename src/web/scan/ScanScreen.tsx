import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Screen } from "../../components/Screen.tsx";
import { BackRow } from "../../components/BackRow.tsx";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import { useLibrary } from "../../app/LibraryProvider.tsx";
import { useRepositories } from "../../app/contexts.tsx";
import { artRect, detail, perceptualHash } from "../../scan/phash.ts";
import { guideRect, guideStyle, numberBandRect } from "../../scan/frame.ts";
import {
  loadCardIndex,
  identify,
  type CardIndex,
  type IndexedCard,
  type ScanResult,
} from "../../scan/cardIndex.ts";
import { RECOGNISE_TIMEOUT_MS, RecogniserAuthError, recogniseRemote } from "../../scan/remoteRecognize.ts";
import { combineWithMault, lookalikesIn } from "../../scan/cameraMault.ts";
import { PhotoAuthError, cropPhoto, identifyPhoto, preparePhoto } from "../../scan/photoIdentify.ts";
import { boxFromOutline, defaultBox, type CropBox } from "../../scan/cropBox.ts";
import type { CardOutline } from "../../models/identify.ts";
import { PhotoCrop } from "./PhotoCrop.tsx";
import { track } from "../../services/metrics.ts";
import { scanBatchMetrics, scanOutcomeMetric } from "./scanMetrics.ts";
import { autoHint, decide, initialAutoState, type AutoState, type Decision } from "../../scan/autoCapture.ts";
import { ScanFinishes } from "./ScanFinishes.tsx";
import { ScanCardPicker } from "./ScanCardPicker.tsx";
import { ScanOwnedNote } from "./ScanOwnedNote.tsx";
import { alreadyOwnedSummary, scanOwnership } from "./scanOwned.ts";
import type { CollectFinish } from "../../models/cards.ts";
import styles from "./ScanScreen.module.css";

/**
 * Point the camera at a card, keep going, review the batch at the end.
 *
 * Web only, and lazy-loaded so the glasses never download it: they have no
 * pointer, no camera API, and a 600x600 additive display where a live preview
 * would cost every row of the list it replaced.
 *
 * Recognition runs **server-first, device-always**. The capture goes to the
 * Python recogniser behind `/api/recognize`, which today runs a bit-exact port
 * of `phash.ts` over the same index and therefore answers identically — but
 * which can be given a bigger index, OCR disambiguation or card detection
 * without reshipping this app, none of which fits in a 13KB static asset.
 *
 * The on-device index stays loaded and answers whenever the server does not:
 * SERVER-PC has been found powered off twice, and a scanner that stops when the
 * house does is not a scanner. Every capture records which one answered, so a
 * silent failover cannot be mistaken for the server working.
 *
 * **Scanning never stops to ask.** A prompt per card turns a stack of two
 * hundred into two hundred decisions, which is the difference between a
 * scanner and a form. Captures queue silently; the questions are asked once,
 * at the end, over the whole batch — and only for the ones the artwork could
 * not settle on its own.
 *
 * Two of those questions cannot be avoided, and both are asked in review:
 * WHICH card, when two printings share their artwork, and WHICH PRINTING, since
 * a normal and a reverse holo are the same picture. The second is answered from
 * the printings oracle rather than a fixed pair — see ScanFinishes.
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

/**
 * Which recogniser answered. `null` while the answer is still in flight.
 * `mault` is the photo engine behind /api/cards/identify (an uploaded photo);
 * `server+mault` / `device+mault` is a camera capture phash could not settle
 * and Mault was asked about too (see cameraMault.ts).
 */
type Via = "server" | "device" | "mault" | "server+mault" | "device+mault" | null;

/** A Mault score (% match) rather than phash bits sits on this row's candidates. */
const scoredByMault = (via: Via) => via === "mault" || via === "server+mault" || via === "device+mault";

const VIA_LABEL: Record<NonNullable<Via>, string> = {
  server: "Server",
  device: "On device",
  mault: "Photo · Mault",
  "server+mault": "Server + Mault",
  "device+mault": "On device + Mault",
};

/**
 * Long edge of the guide crop sent to Mault. The guide at camera resolution
 * is ~886x1237 on a 1080p phone; the embedding gains nothing past this and the
 * upload stays ~150-250KB through the tunnel.
 */
const MAULT_CROP_EDGE = 1200;

/** The guide region of the current video frame at (near) native resolution. */
function guideCrop(el: HTMLVideoElement): HTMLCanvasElement | null {
  if (!el.videoWidth) return null;
  const guide = guideRect(el.videoWidth, el.videoHeight);
  const scale = Math.min(1, MAULT_CROP_EDGE / Math.max(guide.w, guide.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(guide.w * scale);
  canvas.height = Math.round(guide.h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(el, guide.x, guide.y, guide.w, guide.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function jpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("the crop could not be encoded"))),
      "image/jpeg",
      0.9,
    ),
  );
}

interface Capture {
  key: number;
  thumb: string;
  /**
   * The collector-number strip, shown only when recognition could not decide.
   *
   * 1,730 of 20,205 cards cannot be told apart by artwork at all — they are
   * genuine reprints with identical art, and the number is the only thing that
   * separates them. Rather than read it, which needs OCR and introduces a way
   * to file the wrong card silently, this puts the pixels in front of the
   * person who is already being asked "which one?".
   *
   * Dropped as soon as a row settles confidently, so a batch of thirty cards
   * does not hold thirty full-resolution crops it will never show.
   */
  numberBand: string | null; /**
   * Null until an answer arrives.
   *
   * A server round trip cannot block the shutter — the next card is already
   * being lined up — so the row is queued empty and filled in when it settles.
   * That also keeps the filmstrip in capture order rather than reply order.
   */
  result: ScanResult | null;
  via: Via;
  /** The service's reasoning, or why there is no result. */
  note: string | null;
  /** Index into candidates, or null when nothing has been chosen yet. */
  choice: number | null;
  /**
   * Named by hand, overriding whatever was recognised.
   *
   * Kept beside the result rather than written over it so the original
   * candidates survive: changing your mind after correcting a row should not
   * mean rescanning the card.
   */
  manual: IndexedCard | null;
  finish: CollectFinish;
  rejected: boolean;
  /** A camera capture, or a photo uploaded from the device. */
  source: "camera" | "photo";
  /**
   * The uploaded photo, kept only while it may need sending again: a photo
   * has no on-device fallback, so an offline server leaves a Retry button.
   * Dropped once any answer arrives.
   */
  photo: Blob | null;
  /**
   * Photo rows only: the uploaded photo as first picked, kept for the row's
   * life so it can be cropped by hand (`photo` above is whatever was sent last,
   * possibly a crop, and is dropped once answered).
   */
  original: Blob | null;
  /** Photo rows only: the preview the crop box is dragged over. */
  preview: string | null;
  /** Photo rows only: the photo's width / height. */
  aspect: number | null;
  /** Where the server found the card in the ORIGINAL photo, if it did. */
  outline: CardOutline | null;
  /** The last hand crop, so reopening the crop starts from it. */
  crop: CropBox | null;
  /** The crop box is open on this row. */
  cropping: boolean;
  /** Why it opened by itself (no outline found), or null when tapped open. */
  cropPrompt: string | null;
}

/** "97% match" for an engine that scores candidates; phash bits otherwise. */
function scoreOf(cand: { distance: number | null; confidence?: number | null }): string {
  // Mault's unsure answer names cards without scoring them.
  if (cand.confidence === null) return "best guess";
  if (cand.confidence !== undefined) return `${Math.round(cand.confidence * 100)}% match`;
  return `${cand.distance} bits`;
}

/** What this row will file, however it was decided. */
function chosenOf(c: Capture): { card: IndexedCard; distance: number | null } | null {
  if (c.manual) return { card: c.manual, distance: null };
  if (c.choice === null || !c.result) return null;
  const candidate = c.result.candidates[c.choice];
  return candidate ? { card: candidate.card, distance: candidate.distance } : null;
}

/** Ready to commit: kept, and something was actually identified. */
function isKept(c: Capture): boolean {
  return !c.rejected && chosenOf(c) !== null;
}

export function ScanScreen() {
  const { pop, push } = useNavigation();
  const { addManyOwned, isOwned, isOwnedFinish } = useLibrary();
  const repo = useRepositories();

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
  /**
   * Server unless this device has never been connected.
   *
   * Falling straight to the device when there is no token is not a downgrade
   * worth a warning: the two answer the same thing today. The status line says
   * which is running so it is never a guess.
   */
  const [engine, setEngine] = useState<"server" | "device">(() =>
    repo.getSyncSettings().token ? "server" : "device",
  );
  const [engineNote, setEngineNote] = useState<string | null>(null);
  /** Key of the capture being named by hand, or null. */
  const [picking, setPicking] = useState<number | null>(null);
  /**
   * Read once, not per render: the auto loop re-renders at 10fps and this is a
   * localStorage read and a JSON parse. Connecting a device happens in
   * Settings, which unmounts this screen, so a mount is exactly the right
   * moment to look.
   */
  const [hasToken] = useState(() => repo.getSyncSettings().token !== "");
  const fileInput = useRef<HTMLInputElement>(null);
  /** Why the last picked file could not be opened, shown where the engine note goes. */
  const [uploadNote, setUploadNote] = useState<string | null>(null);

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
    /*
     * The collector number, at the camera's own resolution.
     *
     * Cropped from the VIDEO, not from the 245x342 canvas above — that canvas
     * exists so resolution can never change a hash, and the number is about 8px
     * tall in it. Straight off a 1080p frame it is nearer 31px, which is the
     * difference between a smudge and something a person can read.
     *
     * It is only ever shown to a human. Nothing here reads it, so it cannot
     * produce a false accept — the failure this scanner is built to avoid.
     */
    const band = numberBandRect(guide);
    const bandCanvas = document.createElement("canvas");
    bandCanvas.width = band.w;
    bandCanvas.height = band.h;
    bandCanvas.getContext("2d")?.drawImage(el, band.x, band.y, band.w, band.h, 0, 0, band.w, band.h);

    const art = artRect(CAPTURE_WIDTH, CAPTURE_HEIGHT);
    return {
      hash: perceptualHash(frame.data, CAPTURE_WIDTH, CAPTURE_HEIGHT, art),
      numberBand: bandCanvas, // What the hash cannot say: whether there is anything in the guide at all.
      // Only auto-capture reads it — a deliberate press means the user can see
      // something the numbers cannot.
      detail: detail(frame.data, CAPTURE_WIDTH, CAPTURE_HEIGHT, art),
      canvas,
    };
  }, []);

  /** Same-art reprint lookup over the loaded index, built once per index. */
  const lookalikes = useMemo(() => (index ? lookalikesIn(index) : null), [index]);

  /**
   * Answer one capture, server first, device if the server cannot.
   *
   * The fallback is silent to the shutter and loud in the UI: scanning a pile
   * must not stop to report a network blip, but a row that says "device" when
   * the user asked for "server" has to be visible, or a server that quietly
   * died looks exactly like one that is working.
   */
  const resolve = useCallback(
    async (key: number, canvas: HTMLCanvasElement, hash: Uint32Array, crop: HTMLCanvasElement | null) => {
      const apply = (patch: Partial<Capture>) =>
        setQueue((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
      const token = repo.getSyncSettings().token;
      /*
       * phash could not settle it: ask Mault about the native-resolution guide
       * crop before counting the outcome. The phash answer is on the row
       * meanwhile, so nothing waits on screen; a confident phash answer never
       * gets here, so the 91% that settle on artwork pay no extra latency.
       *
       * Mault can only CONFIRM one of phash's candidates (cameraMault.ts).
       * Offline, slow or refused is silent: the row stays as phash left it.
       */
      const secondOpinion = async (result: ScanResult, via: "server" | "device", note: string | null) => {
        // No index, no confirmation: the reprint check reads it (cameraMault.ts).
        if (result.confident || !crop || !token || !lookalikes) return settle(result, via, note);
        apply({ result, via, note: note ? `${note} · asking Mault…` : "Asking Mault…", choice: null });
        let combined;
        try {
          const photo = await identifyPhoto(await jpeg(crop), token, index, RECOGNISE_TIMEOUT_MS);
          combined = combineWithMault(
            result,
            { confident: photo.confident, candidates: photo.candidates, reason: photo.reason },
            lookalikes,
          );
        } catch {
          return settle(result, via, note);
        }
        track("scan.via.camera_mault");
        if (combined.confirmed) track("scan.camera_mault.confirmed");
        settle(combined.result, via, combined.reason, `${via}+mault`);
      };
      // A confident match needs no decision; an unsure one must not be
      // pre-answered, or the review turns into rubber-stamping.
      // A confident row will never show its number band, so the crop is
      // released here rather than held for the life of the batch.
      const settle = (result: ScanResult, via: Via, note: string | null, shown: Via = via) => {
        track(scanOutcomeMetric(result));
        if (via)
          track(
            via === "server" ? "scan.via.server" : via === "mault" ? "scan.via.mault" : "scan.via.device",
          );
        setQueue((prev) =>
          prev.map((c) => {
            if (c.key !== key) return c;
            // Mault answers after phash, and someone may already have picked a
            // candidate or named the card by hand in review. Their choice wins:
            // reordering the candidates under it would change what it points at.
            if (c.result && (c.choice !== null || c.manual)) return { ...c, via: shown, note };
            return {
              ...c,
              result,
              via: shown,
              note,
              choice: result.confident ? 0 : null,
              ...(result.confident ? { numberBand: null } : {}),
            };
          }),
        );
      };
      if (engine === "server") {
        try {
          const result = await recogniseRemote(canvas, repo.getSyncSettings().token, index);
          setEngineNote(null);
          await secondOpinion(result, "server", result.reason);
          return;
        } catch (err) {
          const why = err instanceof Error ? err.message : "the server did not answer";
          // A refused token stays refused, so stop asking. Anything else is
          // transient — keep trying the server on the next card, because a
          // stack takes minutes and a service restart takes seconds.
          if (err instanceof RecogniserAuthError) setEngine("device");
          setEngineNote(index ? `${why} — recognising on device.` : why);
        }
      }

      if (!index) {
        track("scan.unknown");
        apply({ result: null, via: null, note: "No server and no index — nothing could identify this." });
        return;
      }
      await secondOpinion(identify(index, hash, 3), "device", null);
    },
    [engine, index, repo, lookalikes],
  );

  const capture = useCallback(() => {
    const framed = hashFrame();
    if (!framed) return;

    // A thumbnail of what the camera actually saw. Reviewing a list of names
    // with no picture is guesswork; this is how you catch the one that went
    // wrong without rescanning the pile.
    const thumb = document.createElement("canvas");
    thumb.width = THUMB_WIDTH;
    thumb.height = Math.round((THUMB_WIDTH * CAPTURE_HEIGHT) / CAPTURE_WIDTH);
    thumb.getContext("2d")?.drawImage(framed.canvas, 0, 0, thumb.width, thumb.height);

    // Taken now, in the same frame as the hash: by the time phash has
    // answered, the next card is already in the guide. Only encoded (and only
    // sent) if phash turns out unsure; otherwise dropped with this closure.
    const crop = hasToken && video.current ? guideCrop(video.current) : null;

    const key = nextKey.current++;
    setQueue((prev) => [
      ...prev,
      {
        key,
        thumb: thumb.toDataURL("image/jpeg", 0.6),
        // Higher quality than the thumbnail: this one exists to be READ, and
        // JPEG artefacts on 3 small characters is exactly where they cost.
        numberBand: framed.numberBand.toDataURL("image/jpeg", 0.92),
        result: null,
        via: null,
        note: null,
        choice: null,
        manual: null,
        finish: "normal",
        rejected: false,
        source: "camera",
        photo: null,
        original: null,
        preview: null,
        aspect: null,
        outline: null,
        crop: null,
        cropping: false,
        cropPrompt: null,
      },
    ]);
    void resolve(key, framed.canvas, framed.hash, crop);
  }, [hashFrame, resolve, hasToken]);

  /**
   * Identify one uploaded photo through the server's photo engine.
   *
   * No device fallback: the on-device index matches a framed capture, not a
   * photo taken however it was taken. So a failure is said once, on the row
   * itself — never a toast per photo — with a Retry, and Pick by set still
   * works because it reads the local index.
   */
  const resolvePhoto = useCallback(
    async (key: number, photo: Blob, cropped = false) => {
      const apply = (patch: Partial<Capture> | ((c: Capture) => Partial<Capture>)) =>
        setQueue((prev) =>
          prev.map((c) =>
            c.key === key ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) } : c,
          ),
        );
      // A re-identify (Retry, or a crop) clears the old answer, so the row says
      // "Identifying…" rather than showing candidates for the previous picture.
      apply({ note: null, photo, result: null, via: null, choice: null, cropping: false, cropPrompt: null });
      try {
        const result = await identifyPhoto(photo, repo.getSyncSettings().token, index);
        track(scanOutcomeMetric(result));
        track("scan.via.mault");
        apply((c) => ({
          result,
          via: "mault",
          note: cropped ? `Cropped · ${result.reason}` : result.reason,
          choice: result.confident ? 0 : null,
          photo: null,
          // The outline is in the coordinates of what was sent; only the
          // original photo's one can seed a crop box over that photo.
          ...(cropped ? {} : { outline: result.outline }),
          // No outline found and nothing sure: the engine searched the whole
          // picture, which is when a hand crop helps. Opened once, by itself;
          // after the person has cropped, Crop is theirs to tap again.
          ...(result.outlineFound === false && !result.confident && !cropped && !c.crop
            ? { cropping: true, cropPrompt: "Couldn't find the card's edges — drag the box around the card." }
            : {}),
        }));
      } catch (err) {
        const why = err instanceof Error ? err.message : "the server did not answer";
        // A refused token is not fixed by retrying; everything else might be.
        const retry = !(err instanceof PhotoAuthError);
        apply({
          result: null,
          via: null,
          note: retry ? `Couldn't identify: ${why}. Retry, or Pick by set.` : `${why}. Pick by set instead.`,
          photo: retry ? photo : null,
        });
      }
    },
    [index, repo],
  );

  const addPhotos = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploadNote(null);
      let added = 0;
      for (const file of files) {
        let prepared;
        try {
          prepared = await preparePhoto(file);
        } catch (err) {
          setUploadNote(err instanceof Error ? err.message : "that file could not be opened");
          continue;
        }
        const key = nextKey.current++;
        added += 1;
        setQueue((prev) => [
          ...prev,
          {
            key,
            thumb: prepared.thumb,
            // The whole photo, at a size the collector number can be read
            // from: where the card sits in it is unknown, so there is no band
            // to crop. Shown only while the row is unsettled, never read.
            numberBand: prepared.preview,
            result: null,
            via: null,
            note: null,
            choice: null,
            manual: null,
            finish: "normal",
            rejected: false,
            source: "photo",
            photo: prepared.upload,
            original: prepared.upload,
            preview: prepared.preview,
            aspect: prepared.aspect,
            outline: null,
            crop: null,
            cropping: false,
            cropPrompt: null,
          },
        ]);
        void resolvePhoto(key, prepared.upload);
      }
      // A photo is reviewed straight away: there is no camera stack to keep
      // feeding, and the answer lands on the row as it arrives.
      if (added > 0) setReviewing(true);
    },
    [resolvePhoto],
  );

  /** Cut the hand-drawn box out of the original photo and identify that. */
  const identifyCrop = useCallback(
    async (key: number, original: Blob, box: CropBox) => {
      const apply = (patch: Partial<Capture>) =>
        setQueue((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
      apply({ crop: box, cropping: false, cropPrompt: null });
      let cropped: Blob;
      try {
        cropped = await cropPhoto(original, box);
      } catch {
        apply({ cropping: true, cropPrompt: "That crop could not be cut out — try again." });
        return;
      }
      await resolvePhoto(key, cropped, true);
    },
    [resolvePhoto],
  );

  /**
   * One hidden picker shared by the scan and review screens. `accept="image/*"`
   * is what makes a phone offer "Take photo" beside the gallery.
   */
  const photoPicker = (
    <input
      ref={fileInput}
      type="file"
      accept="image/*"
      multiple
      hidden
      data-testid="photo-input"
      onChange={(e) => {
        const files = Array.from(e.currentTarget.files ?? []);
        // Reset so picking the same file again still fires a change.
        e.currentTarget.value = "";
        void addPhotos(files);
      }}
    />
  );

  const live = phase.at === "live";

  /**
   * The detection loop.
   *
   * ~10fps, not 60: detection at frame rate buys nothing a hand can use and
   * costs the main thread the smoothness of the preview. One hash per tick is
   * the entire budget — the same hash answers "has it stopped moving" and
   * "is this still the card I just took".
   */
  const canRecognise = engine === "server" || index !== null;

  useEffect(() => {
    if (!auto || !live || !ready || !canRecognise || reviewing) return;
    const timer = window.setInterval(() => {
      const framed = hashFrame();
      if (!framed) return;
      const decision = decide(autoState.current, framed.hash, framed.detail, Date.now());
      autoState.current = decision.state;
      setHint(decision.reason);
      if (decision.capture) capture();
    }, 100);
    return () => window.clearInterval(timer);
  }, [auto, live, ready, canRecognise, reviewing, hashFrame, capture]);

  const update = (key: number, patch: Partial<Capture>) =>
    setQueue((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const commit = () => {
    const kept = queue.filter(isKept);
    for (const [event, n] of scanBatchMetrics(
      queue.map((c) => ({
        kept: isKept(c),
        rejected: c.rejected,
        manual: c.manual !== null,
        confident: Boolean(c.result?.confident),
        choseFirst: c.choice === 0,
      })),
    )) {
      track(event, n);
    }
    // One merge and one write for the whole batch. Adding them one at a time
    // re-reads and re-serialises the entire collection per card, which is
    // quadratic over a batch and exactly what a scanner produces. Never
    // toggleOwned: a pile being digitised overlaps what is already held, and
    // toggling would un-mark precisely those.
    addManyOwned(
      kept.flatMap((c) => {
        const card = chosenOf(c)?.card;
        return card ? [{ cardId: card.id, finish: c.finish, setId: card.setId }] : [];
      }),
    );
    setAddedCount((n) => n + kept.length);
    setQueue([]);
    setReviewing(false);
  };

  const unsure = queue.filter((c) => chosenOf(c) === null && !c.rejected).length;
  const keeping = queue.filter(isKept).length;
  // Of the rows being added, how many the collection already holds in that
  // printing. Informs only: adding one of them changes nothing.
  const alreadyHeld = queue.filter((c) => {
    const card = isKept(c) ? chosenOf(c)?.card : undefined;
    return card ? scanOwnership(card.id, c.finish, { isOwned, isOwnedFinish }) === "this-printing" : false;
  }).length;
  const heldSummary = alreadyOwnedSummary(alreadyHeld, keeping);

  if (reviewing) {
    return (
      <Screen
        title="Review scans"
        headerLeft={<BackRow focused={false} onActivate={() => setReviewing(false)} />}
        headerRight={`${keeping}/${queue.length}`}
        canGoBack
      >
        {picking !== null && index ? (
          <ScanCardPicker
            index={index}
            // The set is usually right even when the card is not — two reprints
            // that confuse the hash are frequently from the same era, and it
            // saves scrolling 174 sets to the one already on screen.
            initialSetId={queue.find((c) => c.key === picking)?.result?.candidates[0]?.card.setId}
            onCancel={() => setPicking(null)}
            onPick={(card) => {
              update(picking, { manual: card, rejected: false, finish: "normal" });
              setPicking(null);
            }}
          />
        ) : null}

        {queue.length === 0 ? (
          <p className={styles.hint}>Nothing scanned yet.</p>
        ) : (
          <ul className={styles.review}>
            {queue.map((c) => {
              const chosen = chosenOf(c);

              /*
               * The card's own number, for a row the scanner could not settle.
               *
               * Declared once and placed by each branch that needs it, so it
               * lands directly UNDER the question and ABOVE the answer: you
               * read the number, then choose. Rendered below the buttons it
               * would arrive after the decision it exists to inform.
               *
               * Two branches want it. With candidates, they are reprints with
               * identical artwork and the printed number is usually the only
               * thing separating them. With none, this is what makes "Pick by
               * set" a lookup rather than a guess.
               *
               * Shown, never read. Nothing here parses it, so it cannot file
               * the wrong card — which is the failure OCR would introduce and
               * the reason this stops short of it.
               */
              // While cropping, the crop box shows the photo; once is enough.
              const numberBand =
                c.numberBand && !c.cropping ? (
                  <img
                    className={c.source === "photo" ? styles.photoPreview : styles.numberBand}
                    src={c.numberBand}
                    alt={
                      c.source === "photo"
                        ? "The uploaded photo, to read the card's collector number from"
                        : "The bottom of the scanned card, where its collector number is printed"
                    }
                    data-testid="number-band"
                  />
                ) : null;
              return (
                <li
                  key={c.key}
                  className={`${styles.row} ${c.rejected ? styles.rowRejected : ""}`}
                  data-testid="review-row"
                >
                  <img className={styles.thumb} src={c.thumb} alt="" />
                  <div className={styles.rowBody}>
                    {c.cropping && c.preview && c.original ? (
                      <PhotoCrop
                        key={`${c.key}-${c.crop ? "again" : "first"}`}
                        src={c.preview}
                        prompt={c.cropPrompt ?? "Drag the box around the card, then identify it."}
                        initial={
                          c.crop ?? (c.outline ? boxFromOutline(c.outline) : defaultBox(c.aspect ?? 3 / 4))
                        }
                        onCancel={() => update(c.key, { cropping: false, cropPrompt: null })}
                        onConfirm={(box) => c.original && void identifyCrop(c.key, c.original, box)}
                      />
                    ) : null}
                    {c.manual ? (
                      <>
                        <span className={styles.name}>{c.manual.name}</span>
                        <span className={styles.sub}>
                          {c.manual.setName} · {c.manual.number} · named by hand
                        </span>
                      </>
                    ) : !c.result ? (
                      <>
                        <span className={styles.sub} data-testid="row-note">
                          {c.note ?? (c.source === "photo" ? "Identifying photo…" : "Recognising…")}
                        </span>
                        {/* A failed photo still needs its number read to Pick by set. */}
                        {c.source === "photo" && c.note ? numberBand : null}
                      </>
                    ) : c.result.candidates.length === 0 ? (
                      <>
                        <span className={styles.sub}>No match found</span>
                        {numberBand}
                      </>
                    ) : chosen && c.result.confident ? (
                      <>
                        <span className={styles.name}>{chosen.card.name}</span>
                        <span className={styles.sub}>
                          {chosen.card.setName} · {chosen.card.number} ·{" "}
                          {scoreOf({
                            distance: chosen.distance,
                            confidence: c.result.candidates[0]?.confidence,
                          })}
                          {!scoredByMault(c.via) && c.result.runnerUp && chosen.distance !== null
                            ? `, ${c.result.runnerUp.distance - chosen.distance} clear`
                            : ""}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className={styles.sub}>{c.choice === null ? "Which one?" : "Chosen"}</span>
                        {numberBand}
                        <div className={styles.picker} role="group" aria-label="Pick the card">
                          {" "}
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
                                {cand.card.setName} · {cand.card.number} · {scoreOf(cand)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {chosen ? <ScanOwnedNote cardId={chosen.card.id} finish={c.finish} /> : null}

                    {/*                      Which recogniser answered, per row and not just per
                      session. The engine can change mid-batch — one timeout                      falls this card back to the device and the next one goes
                      to the server again — so a single banner would describe
                      the wrong rows.
                    */}
                    {c.via ? (
                      <span className={styles.via} data-testid="via">
                        {VIA_LABEL[c.via]}
                        {c.note ? ` · ${c.note}` : ""}
                      </span>
                    ) : null}

                    <div className={styles.rowActions}>
                      {/*
                        Only once a card is chosen: printings are per card, and
                        offering finishes for a row that has not been identified
                        would be asking which variant of nothing this is.
                      */}
                      {chosen ? (
                        <ScanFinishes
                          card={chosen.card}
                          value={c.finish}
                          onChange={(finish) => update(c.key, { finish })}
                        />
                      ) : null}
                      <button
                        type="button"
                        className={styles.chip}
                        aria-pressed={c.rejected}
                        onClick={() => update(c.key, { rejected: !c.rejected })}
                      >
                        {c.rejected ? "Rejected" : "Reject"}
                      </button>
                      {c.photo && !c.result && c.note ? (
                        <button
                          type="button"
                          className={styles.chip}
                          onClick={() => c.photo && void resolvePhoto(c.key, c.photo, c.crop !== null)}
                          data-testid="retry-photo"
                        >
                          Retry
                        </button>
                      ) : null}
                      {c.source === "photo" && c.original && c.preview && !c.cropping && !c.photo ? (
                        <button
                          type="button"
                          className={styles.chip}
                          onClick={() => update(c.key, { cropping: true, cropPrompt: null })}
                          data-testid="crop-photo"
                        >
                          Crop
                        </button>
                      ) : null}
                      {/*
                        The way out when the right card is not among the three
                        offered — which is the whole of the 8.6% the gate refuses,
                        plus anything the camera never saw properly.
                      */}
                      <button
                        type="button"
                        className={styles.link}
                        onClick={() => setPicking(c.key)}
                        disabled={!index}
                        data-testid="pick-by-set"
                      >
                        {c.manual ? "Change" : "Pick by set"}
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
          {heldSummary ? (
            <p className={styles.hint} data-testid="owned-summary">
              {heldSummary}
            </p>
          ) : null}
          <button type="button" className={styles.shutter} onClick={commit} disabled={keeping === 0}>
            {keeping > 0 ? `Add ${keeping} card${keeping === 1 ? "" : "s"}` : "Nothing to add"}
          </button>
          <button type="button" className={styles.dismiss} onClick={() => setReviewing(false)}>
            Keep scanning
          </button>
          <button type="button" className={styles.dismiss} onClick={() => fileInput.current?.click()}>
            Upload another photo
          </button>
          {uploadNote ? <p className={styles.hint}>{uploadNote}</p> : null}
          {photoPicker}
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
                Line each card up inside the frame and keep going.{" "}
                {engine === "server"
                  ? "Each capture is sent to your server to identify."
                  : "Recognition runs on this device."}{" "}
                Nothing is added until you review.
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
        <button
          type="button"
          className={`${styles.chip} ${engine === "server" ? styles.chipOn : ""}`}
          aria-pressed={engine === "server"}
          data-testid="engine"
          onClick={() => {
            setEngineNote(null);
            setEngine((e) => (e === "server" ? "device" : "server"));
          }}
        >
          {engine === "server" ? "Server" : "On device"}
        </button>
        <span className={styles.autoNote}>
          {engineNote
            ? engineNote
            : engine === "server" && !hasToken
              ? "Connect this device in Settings to use the server"
              : auto
                ? "Hold a card in the frame — it captures itself"
                : "Tap to capture each card"}
        </span>
      </div>

      <div className={styles.strip} aria-label="Scanned this session">
        {queue.length === 0 ? (
          <span className={styles.stripEmpty}>
            {index
              ? `${index.cards.length.toLocaleString()} cards indexed${engine === "server" ? " · server recognising" : ""}`
              : indexError
                ? engine === "server"
                  ? `${indexError} — the server is the only recogniser`
                  : indexError
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
            disabled={!canRecognise || !ready}
            data-testid="capture"
          >
            {!canRecognise ? "Loading cards…" : !ready ? "Focusing…" : auto ? autoHint(hint) : "Capture"}
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

      {/*
        A photo instead of the live camera: from the gallery, or the phone's own
        camera app through the picker. Works without starting the camera, and
        without the guide — the server straightens the card itself.
      */}
      <div className={styles.uploadRow}>
        <button
          type="button"
          className={styles.uploadButton}
          onClick={() => fileInput.current?.click()}
          data-testid="upload-photo"
        >
          Upload photo
        </button>
        <span className={styles.autoNote}>
          {uploadNote ??
            (hasToken ? "Identified by your server" : "Connect this device in Settings to identify photos")}
        </span>
        {photoPicker}
      </div>
    </Screen>
  );
}
