import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The camera, and the four ways there isn't one.
 *
 * Kept out of the screen because the lifecycle is the part that goes wrong
 * silently: a stream left open holds the camera indicator lit and the sensor
 * warm, and a `<video>` that lost its `srcObject` reports `videoWidth === 0`,
 * at which point every capture reads a 0x0 frame and queues nothing at all.
 */

export type CameraPhase =
  | { at: "idle" }
  | { at: "starting" }
  | { at: "live" }
  /** Blocked by the user or the OS. `reason` is the DOMException name. */
  | { at: "denied"; reason: string }
  /** No `getUserMedia` at all — an old browser, or an insecure origin. */
  | { at: "unsupported" };

export interface Camera {
  phase: CameraPhase;
  videoRef: React.RefObject<HTMLVideoElement>;
  /**
   * The video has real dimensions. Capturing before this reads a 0x0 frame,
   * which fails by producing nothing rather than by throwing.
   */
  ready: boolean;
  start: () => Promise<void>;
  /** Wire to the element's own events; it is the only thing that knows. */
  onFrameMetadata: () => void;
}

export function useCamera(): Camera {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<CameraPhase>({ at: "idle" });
  const [ready, setReady] = useState(false);

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
        // The rear camera, and as much resolution as is offered: the art window
        // is a fraction of the frame, so this is what the hash actually sees.
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        audio: false,
      });
      stream.current = media;
      if (videoRef.current) {
        videoRef.current.srcObject = media;
        await videoRef.current.play().catch(() => {});
      }
      setPhase({ at: "live" });
    } catch (err) {
      setPhase({ at: "denied", reason: err instanceof Error ? err.name : "unknown" });
    }
  }, []);

  const onFrameMetadata = useCallback(() => {
    setReady((videoRef.current?.videoWidth ?? 0) > 0);
  }, []);

  return { phase, videoRef, ready, start, onFrameMetadata };
}
