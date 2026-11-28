import type { CollectFinish } from "../../../models/cards.ts";
import { planAdd, type AddEntry } from "../addmany/applyPlan.ts";

/** What marking a trade done would change in the collection. */
export interface TradePlan {
  /** Given printings that are owned: turned off. */
  remove: AddEntry[];
  /** Received printings not owned yet: turned on. */
  add: AddEntry[];
}

const key = (e: AddEntry): string => `${e.cardId}|${e.finish}`;

/**
 * Which printings a finished trade turns off and on. Only owned given printings
 * are removed and only unowned received ones are added, each printing once, so
 * Undo (the exact inverse) never touches a card the trade did not change. A
 * printing on both sides is left alone: it would leave and come back.
 */
export function planTrade(
  give: readonly AddEntry[],
  get: readonly AddEntry[],
  isOwnedFinish: (cardId: string, finish: CollectFinish) => boolean,
): TradePlan {
  const received = new Set(get.map(key));
  const given = new Set(give.map(key));
  const seen = new Set<string>();
  const remove: AddEntry[] = [];
  for (const e of give) {
    const k = key(e);
    if (seen.has(k) || received.has(k)) continue;
    seen.add(k);
    if (isOwnedFinish(e.cardId, e.finish)) remove.push(e);
  }
  const add = planAdd(
    get.filter((e) => !given.has(key(e))),
    isOwnedFinish,
  );
  return { remove, add };
}
