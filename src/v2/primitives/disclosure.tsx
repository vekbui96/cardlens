import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import styles from "./primitives.module.css";
import { cx } from "./layout.tsx";

type Vars = CSSProperties & Record<`--${string}`, string>;

/* --- Rail ----------------------------------------------------------------- */

interface RailHostProps {
  children: ReactNode;
  rail: ReactNode;
  open: boolean;
  /** Named for assistive technology, and for the toggle that opens it. */
  label: string;
}

/**
 * Main content with a side panel on wide windows.
 *
 * **A shut rail takes zero width.** Not a narrow column, not a collapsed strip
 * — zero. This is the whole reason the component exists: while the shut rail
 * still held grid track, the binder beside it lost 33px of pocket, and a
 * 12-pocket page rendered at 92px against a 9-pocket page's 125px. A pocket is
 * a pocket, so a panel that is not open has to cost nothing at all.
 *
 * There is no phone branch here. On a phone the same content belongs in a
 * `Sheet`, from the bottom, where a thumb is — the caller chooses which, because
 * only the caller knows whether the content survives being 320px wide.
 */
export function RailHost({ children, rail, open, label }: RailHostProps) {
  const vars: Vars = {
    "--rail-w": open ? "var(--v2-rail-w)" : "var(--v2-space-0)",
    "--rail-gap": open ? "var(--v2-space-4)" : "var(--v2-space-0)",
  };
  return (
    <div className={styles.railHost} style={vars}>
      <div className={styles.railMain}>{children}</div>
      <aside className={cx(styles.rail, !open && styles.railClosed)} aria-label={label} hidden={!open}>
        {rail}
      </aside>
    </div>
  );
}

/* --- Sheet ---------------------------------------------------------------- */

interface SheetProps {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  label: string;
}

/**
 * A modal panel from the bottom edge — the phone counterpart of `RailHost`.
 *
 * This is the one place in v2 where a focus trap is correct: it is a real
 * modal, so Tab must not walk out of it into a page the user cannot see. Every
 * other surface in the app stays freely tabbable.
 *
 * **Opening focuses the DIALOG, not the first control inside it.** It used to
 * take the first focusable, and in the binder picker that is the search field —
 * so tapping a pocket on a phone raised the software keyboard every single
 * time, over a sheet that already covered 62% of a 390x844 screen (measured).
 * Nobody taps a pocket in order to type; they tap it to pick from the set they
 * are already looking at. A sheet that needs the keyboard immediately can still
 * ask for it, and `PickBySet` does exactly that — one line, in the screen that
 * wants it, rather than as everyone's default.
 */
export function Sheet({ children, open, onClose, label }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  /**
   * Ride above the software keyboard.
   *
   * A fixed element pinned to `bottom: 0` is pinned to the LAYOUT viewport, and
   * iOS does not shrink that when the keyboard comes up — it shrinks the VISUAL
   * viewport and leaves the layout alone. So the bottom of this sheet, and the
   * field the keyboard was raised for, sit underneath it. The difference
   * between the two viewports is exactly how much keyboard there is.
   */
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    const el = sheetRef.current;
    if (!vv || !el) return;
    const apply = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.setProperty("--sheet-lift", `${Math.round(covered)}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    // Remember where focus came from, so closing puts it back rather than
    // dropping the user at the top of the document.
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = focusableWithin(sheetRef.current);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus?.();
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <>
      {/* Presentational: the dialog below it is what assistive tech should see. */}
      <div className={styles.sheetScrim} onClick={close} aria-hidden="true" />
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // Focusable only as a target: the dialog takes focus on open so the
        // trap has somewhere to start and a screen reader hears the label,
        // without raising a keyboard nobody asked for.
        tabIndex={-1}
        ref={sheetRef}
      >
        <div className={styles.sheetHandle} aria-hidden="true" />
        <div className={styles.sheetBody}>{children}</div>
      </div>
    </>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Deliberately NOT filtered on `offsetParent`, which is the usual way to ask
 * "is this visible". jsdom performs no layout, so `offsetParent` is null for
 * everything — the trap would find no targets under test and silently do
 * nothing, which is exactly the state a test is supposed to catch.
 *
 * `hidden` and `[aria-hidden]` are the honest questions anyway: a sheet only
 * contains what it was handed, so the interesting case is content the caller
 * hid on purpose, not content the browser happens not to be painting.
 */
function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("hidden") && el.closest("[aria-hidden='true']") === null,
  );
}
