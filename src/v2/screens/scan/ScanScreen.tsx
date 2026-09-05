import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Chip, Panel, Row, ScreenReaderOnly, Stack, cx } from "../../primitives/index.ts";
import { useNavigation } from "../../../app/NavigationProvider.tsx";
import { useLibrary } from "../../../app/LibraryProvider.tsx";
import { useRepositories } from "../../../app/contexts.tsx";
import { guideStyle } from "../../../scan/frame.ts";
import { identify } from "../../../scan/cardIndex.ts";
import { recogniseRemote } from "../../../scan/remoteRecognize.ts";
import {
  autoHint,
  decide,
  initialAutoState,
  type AutoState,
  type Decision,
} from "../../../scan/autoCapture.ts";
import { answerCapture } from "./recognise.ts";
import { applyAnswer, batchSummary, commitEntries, newCapture, type Capture } from "./batch.ts";
import { bandImageOf, readFrame, thumbnailOf } from "./frameCapture.ts";
import { useCamera } from "./useCamera.ts";
import { useCardIndex } from "./useCardIndex.ts";
import { ScanRow } from "./ScanRow.tsx";
import { PickBySet } from "./PickBySet.tsx";
import type { CollectFinish } from "../../../models/cards.ts";
import styles from "./scan.module.css";

/**
 * Point the camera at a pile and add them.
 *
 * Recognition runs **server-first, device-always**. The capture goes to the
 * Python recogniser behind `/api/recognize`, which today runs a bit-exact port
 * of `phash.ts` over the same index and therefore answers identically — but
 * which can be given a bigger index, OCR disambiguation or card detection
 * without reshipping this app, none of which fits in a 13KB static asset. The
 * on-device index stays loaded and answers whenever the server does not, and
 * every row records which one answered, so a silent failover cannot be mistaken
 * for the server working.
 *
 * **Scanning never stops to ask.** A prompt per card turns a stack of two
 * hundred into two hundred decisions, which is the difference between a scanner
 * and a form. Captures queue silently; the questions are asked at the end, over
 * the whole batch, and only for the rows the artwork could not settle.
 *
 * **The recogniser is not this screen's.** `src/scan/phash.ts` and its accept
 * gate are mirrored in `cardrec/judge.py` on a machine that is not in this repo.
 * This is the SCREEN; nothing under `src/scan/` is touched here.
 */

/** How many candidates to ask the device for. Matched to the service's own. */
const CANDIDATES = 3;

export function ScanScreen() {
  const { push } = useNavigation();
  const { addManyOwned } = useLibrary();
  const repo = useRepositories();

  const camera = useCamera();
  const cards = useCardIndex();
  const index = cards.state.status === "ready" ? cards.state.index : null;

  const [queue, setQueue] = useState<Capture[]>([]);
  const nextKey = useRef(1);
  const [auto, setAuto] = useState(true);
  const [hint, setHint] = useState<Decision["reason"]>("moving");
  const autoState = useRef<AutoState>(initialAutoState);
  const [reviewing, setReviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [added, setAdded] = useState(0);
  const [picking, setPicking] = useState<number | null>(null);

  /**
   * Server unless this device has never been connected.
   *
   * Falling straight to the device when there is no token is not a downgrade
   * worth a warning — the two answer the same thing today — but the status line
   * always says which is running, so it is never a guess.
   */
  const [engine, setEngine] = useState<"server" | "device">(() =>
    repo.getSyncSettings().token ? "server" : "device",
  );
  const [engineNote, setEngineNote] = useState<string | null>(null);
  /**
   * The server refused this device's token.
   *
   * Held as its own state, and it BLOCKS rather than silently falling back. A
   * refused token is a broken configuration, not weather: it will still be
   * broken on the two-hundredth card, and answering the pile on the device
   * while the screen goes on saying "Server" is precisely the silent failover
   * this whole arrangement exists to make impossible.
   */
  const [refused, setRefused] = useState<string | null>(null);
  /**
   * Read once, not per render: the auto loop re-renders at 10fps and this is a
   * localStorage read and a JSON parse. Connecting a device happens in
   * Settings, which unmounts this screen.
   */
  const [hasToken] = useState(() => repo.getSyncSettings().token !== "");

  const live = camera.phase.at === "live";
  const blocked = engine === "server" && refused !== null;
  const canRecognise = (engine === "server" && !blocked) || index !== null;
  const summary = batchSummary(queue);

  /* --- Answering ---------------------------------------------------------- */

  const resolve = useCallback(
    async (key: number, canvas: HTMLCanvasElement, hash: Uint32Array) => {
      const answer = await answerCapture(engine, {
        server: () => recogniseRemote(canvas, repo.getSyncSettings().token, index),
        device: () => (index ? identify(index, hash, CANDIDATES) : null),
      });

      if (answer.kind === "rejected") setRefused(answer.note);
      else if (answer.kind === "answered" && answer.failedOver) setEngineNote(answer.note);
      else if (answer.kind === "answered" && answer.via === "server") setEngineNote(null);

      setQueue((prev) => prev.map((c) => (c.key === key ? applyAnswer(c, answer) : c)));
    },
    [engine, index, repo],
  );

  const capture = useCallback(() => {
    const framed = readFrame(camera.videoRef.current);
    if (!framed) return;
    const key = nextKey.current++;
    setQueue((prev) => [...prev, newCapture(key, thumbnailOf(framed.canvas), bandImageOf(framed.band))]);
    void resolve(key, framed.canvas, framed.hash);
  }, [camera.videoRef, resolve]);

  /**
   * The detection loop.
   *
   * ~10fps, not 60: detection at frame rate buys nothing a hand can use and
   * costs the preview its smoothness. One frame read per tick is the entire
   * budget — the same pass answers "has it stopped moving", "is there anything
   * in the guide" and "is this still the card I just took".
   *
   * The rules themselves live in `src/scan/autoCapture.ts` and are measured;
   * this only decides WHEN to ask. It does not run during review, or a hand
   * moving over the mat would add rows while they are being read.
   */
  useEffect(() => {
    if (!auto || !live || !camera.ready || !canRecognise || reviewing || blocked) return;
    const timer = window.setInterval(() => {
      const framed = readFrame(camera.videoRef.current);
      if (!framed) return;
      const decision = decide(autoState.current, framed.hash, framed.detail, Date.now());
      autoState.current = decision.state;
      setHint(decision.reason);
      if (decision.capture) capture();
    }, 100);
    return () => window.clearInterval(timer);
  }, [auto, live, camera.ready, camera.videoRef, canRecognise, reviewing, blocked, capture]);

  /* --- Batch -------------------------------------------------------------- */

  const update = (key: number, patch: Partial<Capture>) =>
    setQueue((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const commit = async () => {
    if (committing) return;
    const entries = commitEntries(queue);
    if (entries.length === 0) return;
    setCommitting(true);
    // Yield a frame so the button paints disabled before the write. The merge
    // is O(collection) — 0.48ms at 973 rows, 13ms at the 20,000-row cap — and a
    // second press before it returns would file the batch twice.
    await new Promise<void>((r) => window.requestAnimationFrame(() => r()));
    // ONE write, and only ever additive. A pile being digitised overlaps what
    // is already held, and toggling would un-mark exactly those.
    addManyOwned(entries);
    setAdded((n) => n + entries.length);
    setQueue([]);
    setReviewing(false);
    setCommitting(false);
  };

  /* --- What the screen is doing right now --------------------------------- */

  const status = (() => {
    if (cards.state.status === "loading" && !live) return "Loading the card index…";
    if (blocked) return "The server refused this device. Choose a recogniser before scanning again.";
    if (!live) {
      return engine === "server"
        ? "Each capture is sent to your server to identify."
        : "Recognition runs on this device.";
    }
    if (!canRecognise) return "Nothing can identify a card yet.";
    if (!camera.ready) return "Focusing…";
    if (reviewing) return "Paused while you review. Nothing is being captured.";
    return auto ? autoHint(hint) : "Tap Capture for each card.";
  })();

  return (
    <Stack gap={5}>
      <header>
        <h1 className={styles.h1}>Scan</h1>
        <p className={styles.lede}>
          Line each card up inside the frame and keep going. Nothing is added to your collection until you
          review the batch.
        </p>
      </header>

      {refused !== null ? (
        <div className={cx(styles.banner, styles.bannerError)} role="alert">
          <Stack gap={3}>
            <strong>The server rejected this device&rsquo;s token.</strong>
            <span>
              {refused}. Nothing has been recognised on this device instead — a refused token is a broken
              connection, not a slow one, and filing a pile under a recogniser you did not choose would hide
              it. Reconnect this device in Settings, or scan on device deliberately.
            </span>
            <Row gap={2} wrap>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setEngine("device");
                  setRefused(null);
                  setEngineNote("Recognising on this device.");
                }}
              >
                Recognise on this device
              </button>
              <button type="button" className={styles.secondary} onClick={() => setRefused(null)}>
                Try the server again
              </button>
            </Row>
          </Stack>
        </div>
      ) : null}

      {cards.state.status === "failed" ? (
        <div className={cx(styles.banner, styles.bannerWarn)} role="status">
          <Stack gap={3}>
            <strong>The card index could not load.</strong>
            <span>
              {cards.state.error}.{" "}
              {engine === "server"
                ? "The server is the only recogniser, and there is nothing to fall back to if it stops answering."
                : "Nothing on this device can identify a card. Connect this device in Settings to use the server."}
            </span>
            <Row gap={2}>
              <button type="button" className={styles.secondary} onClick={cards.retry}>
                Try again
              </button>
            </Row>
          </Stack>
        </div>
      ) : null}

      <div className={styles.layout}>
        {/* --- The camera ------------------------------------------------- */}
        <div className={styles.cameraColumn}>
          <Panel
            title="Viewfinder"
            headingLevel={2}
            aside={
              <Chip tone={engine === "server" && !blocked ? "accent" : "default"}>
                {engine === "server" ? "Server" : "On device"}
              </Chip>
            }
          >
            <Stack gap={3}>
              {/*
                The preview owns this space and never gives it up. The stage
                keeps a fixed shape whatever the camera turns out to be, and
                everything a capture produces lands in the column beside it — a
                stage that resizes the moment a result appears re-lays-out the
                guide under the card the user is still holding.
              */}
              <div className={styles.stage}>
                <div
                  className={styles.frame}
                  style={{ "--frame-aspect": frameAspect(camera.videoRef.current) } as CSSProperties}
                >
                  <video
                    ref={camera.videoRef}
                    className={cx(styles.video, !live && styles.videoHidden)}
                    playsInline
                    muted
                    onLoadedMetadata={camera.onFrameMetadata}
                    onPlaying={camera.onFrameMetadata}
                  />
                  {live ? (
                    <div
                      className={styles.guide}
                      style={guideStyle(
                        camera.videoRef.current?.videoWidth || 1080,
                        camera.videoRef.current?.videoHeight || 1920,
                      )}
                      aria-hidden="true"
                    >
                      <span className={styles.corner} />
                      <span className={cx(styles.corner, styles.cornerTr)} />
                      <span className={cx(styles.corner, styles.cornerBl)} />
                      <span className={cx(styles.corner, styles.cornerBr)} />
                    </div>
                  ) : null}
                </div>

                {!live ? (
                  <div className={styles.placeholder}>
                    {camera.phase.at === "unsupported" ? (
                      <p className={styles.errorText}>
                        This browser has no camera API. Scanning needs one; everything else in CardLens works
                        without it.
                      </p>
                    ) : camera.phase.at === "denied" ? (
                      <p className={styles.errorText}>
                        Camera blocked ({camera.phase.reason}). Allow it in this site&rsquo;s settings, then
                        start it again.
                      </p>
                    ) : (
                      <p className={styles.muted}>The preview appears here once the camera is running.</p>
                    )}
                  </div>
                ) : null}
              </div>

              <p className={styles.status} role="status">
                {status}
              </p>
              {engineNote ? <p className={styles.muted}>{engineNote}</p> : null}
              {engine === "server" && !hasToken && !blocked ? (
                <p className={styles.muted}>Connect this device in Settings to use the server.</p>
              ) : null}

              <Row gap={2} wrap>
                {live ? (
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={capture}
                    disabled={!canRecognise || !camera.ready || blocked}
                  >
                    Capture
                  </button>
                ) : camera.phase.at === "unsupported" ? null : (
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() => void camera.start()}
                    disabled={camera.phase.at === "starting"}
                  >
                    {camera.phase.at === "starting" ? "Starting camera…" : "Start camera"}
                  </button>
                )}

                <Chip
                  onPress={() => {
                    // Fresh state either way: a stale baseline from before the
                    // toggle would either fire immediately or refuse to.
                    autoState.current = initialAutoState;
                    setAuto((on) => !on);
                  }}
                  pressed={auto}
                  tone={auto ? "accent" : "default"}
                >
                  Auto capture
                </Chip>

                <Chip
                  onPress={() => {
                    setEngineNote(null);
                    setRefused(null);
                    setEngine((e) => (e === "server" ? "device" : "server"));
                  }}
                  pressed={engine === "server"}
                  tone={engine === "server" ? "accent" : "default"}
                >
                  Use the server
                </Chip>

                <Chip
                  onPress={() => setReviewing((r) => !r)}
                  pressed={reviewing}
                  tone={reviewing ? "accent" : "default"}
                >
                  {reviewing ? "Keep scanning" : "Pause and review"}
                </Chip>
              </Row>
            </Stack>
          </Panel>
        </div>

        {/* --- The batch --------------------------------------------------- */}
        <div className={styles.batchColumn}>
          <Panel
            title="This batch"
            headingLevel={2}
            aside={
              <span className={styles.muted}>
                {summary.total > 0
                  ? `${summary.kept} of ${summary.total} ready`
                  : added > 0
                    ? `${added} added this session`
                    : indexNote(cards.state.status, index?.cards.length)}
              </span>
            }
          >
            <Stack gap={4}>
              {summary.total === 0 ? (
                <p className={styles.muted}>
                  Nothing captured yet. Every card you scan lands here as a row, and only the rows you keep
                  are written — in one go, at the end.
                </p>
              ) : (
                <>
                  <ul className={styles.rows} aria-label="Scanned this batch">
                    {queue.map((c) => (
                      <ScanRow
                        key={c.key}
                        capture={c}
                        canPick={index !== null}
                        onChoose={(i) => update(c.key, { choice: i, rejected: false })}
                        onFinish={(finish: CollectFinish) => update(c.key, { finish })}
                        onToggleReject={() => update(c.key, { rejected: !c.rejected })}
                        onPickByHand={() => setPicking(c.key)}
                        onOpenSet={(setId, setName) => push({ name: "set", setId, setName })}
                      />
                    ))}
                  </ul>

                  {summary.unsure > 0 ? (
                    <p className={styles.muted}>
                      {summary.unsure} still need{summary.unsure === 1 ? "s" : ""} a choice — they will be
                      skipped.
                    </p>
                  ) : null}

                  <Row gap={2} wrap>
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={() => void commit()}
                      disabled={summary.kept === 0 || committing}
                    >
                      {committing
                        ? "Adding…"
                        : summary.kept > 0
                          ? `Add ${summary.kept} card${summary.kept === 1 ? "" : "s"}`
                          : "Nothing to add"}
                    </button>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => setQueue([])}
                      disabled={committing}
                    >
                      Discard batch
                    </button>
                  </Row>
                </>
              )}

              {added > 0 ? (
                <p className={styles.muted} role="status">
                  {added} card{added === 1 ? "" : "s"} added this session.
                </p>
              ) : null}
            </Stack>
          </Panel>
        </div>
      </div>

      {picking !== null && index ? (
        <PickBySet
          index={index}
          // The set is usually right even when the card is not — two reprints
          // that confuse the hash are frequently from the same era, and it saves
          // scrolling 174 sets to the one already on screen.
          initialSetId={queue.find((c) => c.key === picking)?.result?.candidates[0]?.card.setId}
          onCancel={() => setPicking(null)}
          onPick={(card) => {
            // Beside the result, never over it: the candidates survive so
            // changing your mind does not mean rescanning the card.
            update(picking, { manual: card, rejected: false, finish: "normal" });
            setPicking(null);
          }}
        />
      ) : null}

      <ScreenReaderOnly>
        {summary.total} captured, {summary.kept} ready to add, {summary.unsure} still undecided.
      </ScreenReaderOnly>
    </Stack>
  );
}

/**
 * The video's own shape, so the guide overlay lines up with the pixels that
 * actually get hashed.
 *
 * The frame box carries the camera's aspect and the video fills it exactly,
 * which makes the percentages `guideStyle` returns — fractions of the FRAME —
 * literally true on screen. v1 draws the same percentages over a letterboxed
 * element, so the bracket a user aligns to is a few percent away from the crop
 * that is hashed.
 */
function frameAspect(video: HTMLVideoElement | null): string {
  if (!video?.videoWidth || !video.videoHeight) return "3 / 4";
  return `${video.videoWidth} / ${video.videoHeight}`;
}

function indexNote(status: "loading" | "ready" | "failed", count: number | undefined): string {
  if (status === "loading") return "Loading the card index…";
  if (status === "failed") return "No card index";
  return `${(count ?? 0).toLocaleString()} cards indexed`;
}
