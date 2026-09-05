import type { SetValue } from "../../../models/value.ts";

/**
 * Sets shown before the value panel is asked to open.
 *
 * Five, because the panel answers "what is it worth, and what is carrying it",
 * and past the fifth set the tail is a long run of small numbers that answers
 * neither. `bySet` is every set the collection touches — nineteen on the
 * author's device — and printing all of them pushed the set-progress list, which
 * is what this screen is actually for, most of a phone screen down.
 */
export const TOP_SETS = 5;

export interface ValueFold {
  /** The rows the list renders right now. */
  shown: SetValue[];
  /** The rows folded away. Non-empty even while expanded — see below. */
  hidden: SetValue[];
  /** What the folded rows are worth, together. */
  hiddenValue: number;
  /** Their display names, in the same order. */
  hiddenNames: string[];
}

/**
 * What the panel shows, and what it is holding back.
 *
 * `hidden` is computed from the unexpanded list whether or not the panel is
 * open, because it is what the EXPANDER has to say. A "show more" that does not
 * name what is behind it makes the reader open it to find out whether they
 * needed to — and this panel's whole discipline is that a total never quietly
 * omits part of itself. Hiding five sets worth $400 behind the words "show
 * more" is the same lie as a total that leaves them out.
 */
export function foldValue(
  bySet: readonly SetValue[],
  setNames: Record<string, string>,
  expanded: boolean,
): ValueFold {
  const hidden = bySet.slice(TOP_SETS);
  return {
    shown: expanded ? [...bySet] : bySet.slice(0, TOP_SETS),
    hidden,
    hiddenValue: hidden.reduce((sum, s) => sum + s.value, 0),
    hiddenNames: hidden.map((s) => setLabel(s.setId, setNames)),
  };
}

/**
 * A set's name, or its id.
 *
 * The id is a real answer, not a placeholder: the set list can be absent
 * (offline, or a set the catalog no longer lists) while the collection still
 * holds cards from it, and `base2` names the row better than a blank does.
 */
export function setLabel(setId: string, setNames: Record<string, string>): string {
  return setNames[setId] ?? setId;
}
