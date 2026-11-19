import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clampBox, dragBox, type CropBox, type CropHandle } from "../../scan/cropBox.ts";
import styles from "./PhotoCrop.module.css";

/**
 * Draw a box around the card in a photo the server could not find it in.
 *
 * Web layout only (phone/browser): a finger drags the box or one of its four
 * 44px corner handles; the keyboard nudges it (arrows move, Shift+arrows
 * resize). The box is in fractions of the photo (`cropBox.ts`), so it means
 * the same region on this preview and on the full-size upload that is cut.
 */
export interface PhotoCropProps {
  /** What is shown to drag over: the row's preview of the photo. */
  src: string;
  initial: CropBox;
  /** One line above the photo saying why this is open. */
  prompt: string;
  onCancel: () => void;
  onConfirm: (box: CropBox) => void;
}

const HANDLES: Exclude<CropHandle, "move">[] = ["nw", "ne", "se", "sw"];
const HANDLE_LABEL: Record<Exclude<CropHandle, "move">, string> = {
  nw: "top-left",
  ne: "top-right",
  se: "bottom-right",
  sw: "bottom-left",
};
const NUDGE = 0.02;

export function PhotoCrop({ src, initial, prompt, onCancel, onConfirm }: PhotoCropProps) {
  const [box, setBox] = useState<CropBox>(() => clampBox(initial));
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: CropHandle; x: number; y: number; start: CropBox } | null>(null);

  const begin = (handle: CropHandle) => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: box };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const rect = frame.current?.getBoundingClientRect();
    if (!d || !rect || rect.width === 0 || rect.height === 0) return;
    setBox(dragBox(d.start, d.handle, (e.clientX - d.x) / rect.width, (e.clientY - d.y) / rect.height));
  };
  const end = () => {
    drag.current = null;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-NUDGE, 0],
      ArrowRight: [NUDGE, 0],
      ArrowUp: [0, -NUDGE],
      ArrowDown: [0, NUDGE],
    };
    const s = step[e.key];
    if (!s) return;
    e.preventDefault();
    setBox((b) => (e.shiftKey ? dragBox(b, "se", s[0], s[1]) : dragBox(b, "move", s[0], s[1])));
  };

  const pct = (v: number) => `${v * 100}%`;
  return (
    <div className={styles.crop} data-testid="photo-crop">
      <p className={styles.prompt}>{prompt}</p>
      <div className={styles.frame} ref={frame}>
        <img className={styles.photo} src={src} alt="The uploaded photo" draggable={false} />
        <div
          className={styles.box}
          style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }}
          role="slider"
          tabIndex={0}
          aria-label="Crop area. Drag to move, drag a corner to resize; arrow keys move, Shift and arrows resize"
          aria-valuetext={`${Math.round(box.w * 100)}% by ${Math.round(box.h * 100)}% of the photo`}
          onKeyDown={onKey}
          onPointerDown={begin("move")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          data-testid="crop-box"
        >
          {HANDLES.map((h) => (
            <span
              key={h}
              className={`${styles.handle} ${styles[h]}`}
              aria-hidden="true"
              onPointerDown={begin(h)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              data-testid={`crop-handle-${h}`}
              title={`Drag the ${HANDLE_LABEL[h]} corner`}
            />
          ))}
        </div>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => onConfirm(box)}
          data-testid="crop-identify"
        >
          Identify this
        </button>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
