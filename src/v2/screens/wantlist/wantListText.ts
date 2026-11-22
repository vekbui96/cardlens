import { missingLine } from "../../../web/sets/missingListText.ts";
import { pricePart, sumWant, type WantSet } from "./wantList.ts";

export interface WantListSection {
  setName: string;
  /** Already narrowed and sorted by the screen's filters. */
  want: WantSet;
}

/**
 * The Want list screen as plain text for pasting into a chat: what is on screen,
 * grouped by set, a line per set and a total. Same card lines as the set
 * screen's "Copy missing list". USD only, an unpriced card says so, and a set
 * with nothing left to show is left out. `notLoaded` names sets that could not
 * be loaded so a partial list never passes for a full one.
 */
export function wantListText(
  sections: readonly WantListSection[],
  notLoaded = 0,
): { text: string; count: number } {
  const open = sections.filter((s) => s.want.missing > 0);
  const totals = sumWant(open.map((s) => s.want));
  if (totals.missing === 0) return { text: "", count: 0 };
  const blocks = open.map(({ setName, want }) => {
    const head = `${setName}: ${want.missing} missing, ${pricePart(want.priced, want.unpriced, want.total)}`;
    const lines = want.cards.map((c) =>
      missingLine(c.name ?? `Card ${c.collectorNumber}`, c.collectorNumber, c.finish, c.price),
    );
    return [head, ...lines].join("\n");
  });
  const total = `Total: ${totals.missing} missing across ${totals.sets} ${totals.sets === 1 ? "set" : "sets"}, ${pricePart(totals.priced, totals.unpriced, totals.total)}`;
  const note =
    notLoaded > 0
      ? [`Not included: ${notLoaded} ${notLoaded === 1 ? "set" : "sets"} could not be loaded`]
      : [];
  return { text: [...blocks, total, ...note].join("\n\n"), count: totals.missing };
}
