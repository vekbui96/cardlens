import { useEffect } from "react";
import { useSetPrintings } from "../../hooks/useSetPrintings.ts";
import { finishLabel } from "../../models/finishes.ts";
import type { CollectFinish } from "../../models/cards.ts";
import type { IndexedCard } from "../../scan/cardIndex.ts";
import styles from "./ScanScreen.module.css";

/**
 * The printings a scanned card actually exists in.
 *
 * Recognition is artwork-only and always will be: `normal` and `reverse holo`
 * share their art down to the pixel, so the hash cannot separate them and the
 * question has to be asked. It was previously asked as a fixed Normal/Reverse
 * pair, which is wrong in both directions — it offers a reverse for cards that
 * have none, and hides the Poké Ball, Master Ball, tinsel and energy foils that
 * three 2025-26 sets introduced between them. Marking one of those meant
 * scanning the card and then going to find it in the set list anyway.
 *
 * One component per row rather than a lookup hoisted into the screen, because
 * the answer is per SET and a batch spans several. React Query keys on the set,
 * so ten rows from one set still cost one request.
 */
export function ScanFinishes({
  card,
  value,
  onChange,
}: {
  card: IndexedCard;
  value: CollectFinish;
  onChange: (finish: CollectFinish) => void;
}) {
  const { index } = useSetPrintings(card.setId, card.setName);
  const known = index?.byNumber[card.number];
  /**
   * Normal and reverse until the oracle answers.
   *
   * Not an empty list: printings arrive over the network and a row with no
   * finishes at all cannot be committed, so a slow or absent server would make
   * scanned cards silently unaddable — the exact failure the on-device index
   * exists to avoid on the recognition half.
   */
  const finishes = known?.length ? known : (["normal", "reverse"] as CollectFinish[]);

  // A card with no reverse printing must not stay marked as one. Anything the
  // user picked themselves is in this list by construction, so this can only
  // correct a default that turned out not to exist.
  useEffect(() => {
    if (known?.length && !known.includes(value)) onChange(known[0]);
  }, [known, value, onChange]);

  return (
    <>
      {finishes.map((f) => (
        <button
          key={f}
          type="button"
          className={`${styles.chip} ${value === f ? styles.chipOn : ""}`}
          aria-pressed={value === f}
          onClick={() => onChange(f)}
        >
          {finishLabel(f)}
        </button>
      ))}
    </>
  );
}
