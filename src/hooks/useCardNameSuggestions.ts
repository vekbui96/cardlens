import { useEffect, useMemo, useRef, useState } from "react";
import { loadCardNames, resetCardNames } from "../services/cardNameIndex.ts";
import { rankNames, MAX_SUGGESTIONS, type NameRow, type Suggestion } from "../models/cardNames.ts";

/**
 * Card-name suggestions for a search box, shared by both UI versions.
 *
 * The names are fetched ONCE, on the first focus of any search box, and never
 * before — Home and the binder shelf pay nothing for a feature they do not
 * have. After that every keystroke is answered from memory.
 *
 * **No request is ever made per keystroke.** That is not a performance note: a
 * search here costs a call to a catalog that fails about a quarter of the time
 * in bursts and rate-limits, which is why this app searches on submit only.
 * See `docs/card-name-autofill.md`.
 */

export interface CardNameSuggestions {
  suggestions: Suggestion[];
  /** Call when the field is focused. Starts the one fetch, if it has not run. */
  prime: () => void;
}

export function useCardNameSuggestions(query: string, limit = MAX_SUGGESTIONS): CardNameSuggestions {
  const [rows, setRows] = useState<NameRow[] | null>(null);
  const asked = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function prime() {
    if (asked.current) return;
    asked.current = true;
    loadCardNames().then(
      (loaded) => {
        if (alive.current) setRows(loaded);
      },
      () => {
        /*
         * Autofill is an enhancement and its absence must be invisible: the
         * box keeps working exactly as it did before. Allow a later focus to
         * try again rather than caching the failure for the session — this
         * file comes off the same host as the app, so a failure here is
         * usually a blip rather than a verdict.
         */
        asked.current = false;
        resetCardNames();
      },
    );
  }

  const suggestions = useMemo(() => (rows ? rankNames(query, rows, limit) : []), [rows, query, limit]);

  return { suggestions, prime };
}
