import { useCallback, useEffect, useRef, useState } from "react";
import {
  addressKey,
  parseAddressKey,
  type BinderAddress,
  type BinderSlot,
} from "../../models/binderLayout.ts";

/**
 * Dragging a card from one pocket to another.
 *
 * Pointer events rather than HTML5 drag-and-drop, because the phone is a real
 * target here and `dragstart` never fires on touch. One implementation covers
 * mouse, pen and finger; the alternative is two, and the touch one would be
 * this file anyway.
 *
 * Drop targets are found with `elementFromPoint` against `[data-pocket]`, not
 * with a handler per pocket. A 12-pocket spread is 24 targets that would each
 * need to track enter/leave and reconcile against a drag that can be cancelled
 * mid-flight; hit-testing once per move is both less code and less state.
 *
 * It lives under `src/features/` rather than in either shell because BOTH build
 * a binder now: v1's `web/binders/WebBinderScreen.tsx` and v2's
 * `v2/screens/binder/`. v2 may not depend on `src/web/`, so the alternative was
 * a second copy — and the three traps below (a handler reading state instead of
 * a ref, the browser's own image drag, and `touch-action` applied after the
 * gesture has been claimed as a pan) each cost a day to find once. Two copies
 * would drift, and the copy that drifted would fail silently.
 *
 * The only contract with a screen is the `[data-pocket]` attribute, whose value
 * is `addressKey(address)`. Anything carrying one is a drop target.
 */

/** Where the thing being dragged came from. */
export type DragSource =
  | { kind: "address"; at: BinderAddress }
  /**
   * A card picked up from the search results, which is not IN the binder yet.
   *
   * Dropping one REPLACES what is in the target pocket rather than swapping —
   * there is nowhere to swap back to. That matches placeSlot, which documents
   * placing onto a full pocket as replacement because that is what putting a
   * card into an occupied sleeve physically does.
   */
  | { kind: "new" };

export interface DragState {
  source: DragSource;
  /** What is being dragged, for the ghost and for the drop. */
  slot: BinderSlot;
  /** Viewport coordinates of the pointer, for the ghost. */
  x: number;
  y: number;
  /** `data-pocket` of whatever is under the pointer, or null. */
  over: string | null;
}

/**
 * How far the pointer must move before a press becomes a drag.
 *
 * A mouse gets 5px: a click is a press that did not move, and anything past a
 * few pixels of hand tremor was meant as a drag. A finger gets a LONG PRESS
 * instead — see below.
 */
const MOUSE_THRESHOLD = 5;
/**
 * A finger has to hold still for this long before it is dragging.
 *
 * On touch, a press that moves is how you SCROLL, and the pages are most of the
 * screen. Starting a drag on movement would mean the binder could not be
 * scrolled at all — every attempt would pick up whatever pocket the thumb
 * landed on. So the gesture is: hold, then move. Moving first scrolls, and
 * cancels the pending drag.
 */
const TOUCH_HOLD_MS = 320;
const TOUCH_SLOP = 10;

export function useBinderDrag(onDrop: (source: DragSource, slot: BinderSlot, to: BinderAddress) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);

  /**
   * The drop handler, held in a ref rather than in the effect's deps.
   *
   * It closes over the binder, so it is a new function on every render — and
   * the binder re-renders on every pointermove while a card is being carried.
   * In the deps that would tear down and re-attach three document listeners
   * sixty times a second, for a callback that is only ever read once, at the
   * end.
   */
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  });

  /**
   * The press that has not yet become a drag.
   *
   * A ref rather than state: it changes on every pointermove and none of it
   * belongs on screen, so rendering for it would re-render the whole binder
   * sixty times a second while the user is only deciding whether to scroll.
   */
  const pending = useRef<{
    source: DragSource;
    slot: BinderSlot;
    x: number;
    y: number;
    pointerId: number;
    touch: boolean;
    timer: number | null;
  } | null>(null);

  /**
   * Set for the whole of a drag and cleared one frame after it ends.
   *
   * A pointerup after a drag still fires the button's `click`, which would
   * select the pocket the card was dropped on — so the screen checks this and
   * swallows that one click. Read by the caller through `consumeClick`.
   */
  const dragged = useRef(false);

  /**
   * The live drag, for the event handlers. `drag` state is only for rendering.
   *
   * The handlers CANNOT read the state. They are attached once and would close
   * over whatever `drag` was at the time; keying the effect on `drag` instead
   * makes it worse, because React does not commit until after the current burst
   * of events. A quick flick — pointerdown, four moves and a pointerup inside
   * one frame, which is exactly what a real mouse produces and what
   * `page.mouse.move(..., { steps })` produces in a test — then runs entirely
   * against `drag === null`, and the drop is silently dropped. Found by the e2e
   * drag test, which failed while the same gesture worked by hand.
   */
  const dragRef = useRef<DragState | null>(null);

  const clearPending = useCallback(() => {
    if (pending.current?.timer !== null && pending.current?.timer !== undefined) {
      window.clearTimeout(pending.current.timer);
    }
    pending.current = null;
  }, []);

  const begin = useCallback((x: number, y: number) => {
    const p = pending.current;
    if (!p) return;
    if (p.timer !== null) window.clearTimeout(p.timer);
    p.timer = null;
    dragged.current = true;
    const started: DragState = { source: p.source, slot: p.slot, x, y, over: null };
    dragRef.current = started;
    setDrag(started);
  }, []);

  /**
   * Begin tracking a press. Call from `onPointerDown` on anything draggable.
   *
   * Returns nothing and never prevents the default: at this point the press is
   * still probably a tap or the start of a scroll, and stealing it here is what
   * makes a page feel broken.
   */
  const onPointerDown = useCallback(
    (event: React.PointerEvent, source: DragSource, slot: BinderSlot) => {
      // Secondary buttons open context menus and select text; they are not
      // drags, and treating them as one loses the user their right-click.
      if (event.button !== 0) return;
      const touch = event.pointerType !== "mouse";
      clearPending();
      pending.current = {
        source,
        slot,
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        touch,
        timer: touch
          ? window.setTimeout(() => {
              const p = pending.current;
              if (p) begin(p.x, p.y);
            }, TOUCH_HOLD_MS)
          : null,
      };
    },
    [begin, clearPending],
  );

  /**
   * Document-level listeners, live only while something is pressed or dragging.
   *
   * On the document rather than the element, because a drag routinely leaves
   * the pocket it started on within the first few pixels — which is the whole
   * point — and listeners on the source would stop firing exactly then.
   */
  useEffect(() => {
    /** What `data-pocket` is under a point, or null. */
    const targetAt = (x: number, y: number) => {
      // The ghost sits under the pointer, so it would be the top element at
      // every hit test. It is `pointer-events: none` in CSS for this reason.
      const el = document.elementFromPoint(x, y);
      return el?.closest("[data-pocket]")?.getAttribute("data-pocket") ?? null;
    };

    const move = (event: PointerEvent) => {
      const p = pending.current;
      if (p && !dragRef.current) {
        if (event.pointerId !== p.pointerId) return;
        const dx = Math.abs(event.clientX - p.x);
        const dy = Math.abs(event.clientY - p.y);
        if (p.touch) {
          // Moved before the hold completed: this is a scroll, so let go of it
          // entirely. The alternative — starting a drag anyway — is how a list
          // becomes impossible to scroll.
          if (dx > TOUCH_SLOP || dy > TOUCH_SLOP) clearPending();
          return;
        }
        if (dx <= MOUSE_THRESHOLD && dy <= MOUSE_THRESHOLD) return;
        begin(event.clientX, event.clientY);
        // Falls through: the move that STARTS a drag is also a move within it,
        // and a gesture short enough to be one event must still land.
      }
      const live = dragRef.current;
      if (!live) return;
      const next = {
        ...live,
        x: event.clientX,
        y: event.clientY,
        over: targetAt(event.clientX, event.clientY),
      };
      dragRef.current = next;
      setDrag(next);
      // Only once a drag is actually running: this is what stops the page
      // scrolling under a finger that is carrying a card.
      event.preventDefault();
    };

    const up = (event: PointerEvent) => {
      clearPending();
      const live = dragRef.current;
      if (!live) return;
      const to = parseAddressKey(targetAt(event.clientX, event.clientY));
      dragRef.current = null;
      setDrag(null);
      if (to) onDropRef.current(live.source, live.slot, to);
      // One frame, so the click that follows this pointerup is swallowed and
      // the next real click is not.
      requestAnimationFrame(() => {
        dragged.current = false;
      });
    };

    const cancel = () => {
      clearPending();
      dragRef.current = null;
      setDrag(null);
      requestAnimationFrame(() => {
        dragged.current = false;
      });
    };

    /*
     * Refuse the scroll while a card is being carried.
     *
     * `touch-action: none` on the body is set when a drag starts, and that is
     * TOO LATE: the browser decides whether a gesture is a pan on the first
     * move, and once it has, it takes the pointer away and sends pointercancel
     * — which killed the drag on its first frame. Confirmed by logging
     * pointercancel arriving immediately after the first pointermove, with the
     * scroll position already 5px further on.
     *
     * A non-passive touchmove that calls preventDefault is what actually stops
     * it, and it is safe precisely because a touch drag begins with a HOLD: the
     * finger has not moved, so no scroll is in progress to interrupt.
     */
    const touchMove = (event: TouchEvent) => {
      if (dragRef.current) event.preventDefault();
    };
    /*
     * The browser's own image drag, which would otherwise win.
     *
     * Every pocket is an `<img>`, and an image is `draggable` by default: press
     * on one with a mouse, move, and the browser starts a NATIVE drag — it puts
     * up a translucent copy, stops sending pointermove, and the pocket drag
     * dies on its first frame with no error anywhere.
     *
     * Cancelled here rather than by putting `draggable={false}` on each image,
     * because the images live in three components (the pocket, the cover, the
     * picker's card list) and a fourth would only have to remember.
     */
    const noNativeDrag = (event: DragEvent) => {
      if (pending.current || dragRef.current) event.preventDefault();
    };
    document.addEventListener("dragstart", noNativeDrag);
    document.addEventListener("touchmove", touchMove, { passive: false });
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    // A drag that survives the Escape key is a drag with no way out.
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("dragstart", noNativeDrag);
      document.removeEventListener("touchmove", touchMove);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", key);
    };
    // Attached ONCE. Everything they read lives in a ref, so there is nothing
    // to re-subscribe for and no window in which a handler holds a stale drag.
  }, [begin, clearPending]);

  /**
   * Stop the page moving under a card that is being carried.
   *
   * `preventDefault` on pointermove is not enough on touch: once the browser
   * has decided a gesture is a scroll it stops asking, and sends pointercancel
   * instead. Taking `touch-action` away for the duration is what actually keeps
   * the binder still. Set on the body rather than in the stylesheet because it
   * must apply only while a drag is running — a pocket that permanently
   * refused touch-action could not be scrolled past on a phone.
   */
  useEffect(() => {
    if (!drag) return;
    const body = document.body;
    const touchAction = body.style.touchAction;
    const userSelect = body.style.userSelect;
    body.style.touchAction = "none";
    body.style.userSelect = "none";
    return () => {
      body.style.touchAction = touchAction;
      body.style.userSelect = userSelect;
    };
  }, [drag]);

  /** Clean up a timer left running by an unmount mid-press. */
  useEffect(() => clearPending, [clearPending]);

  /**
   * True exactly once, for the click that a completed drag leaves behind.
   *
   * The pocket's own onClick still fires after pointerup, and without this a
   * card dropped into a pocket would also SELECT that pocket and open the
   * picker on it — which is not what dropping something means.
   */
  const consumeClick = useCallback(() => dragged.current, []);

  return { drag, onPointerDown, consumeClick, isDragging: drag !== null };
}

/** The `data-pocket` value for an address, so callers need not import both. */
export { addressKey };
