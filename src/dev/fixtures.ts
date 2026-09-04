import { Repositories } from "../storage/repositories.ts";
import { emptyBinder, placeSlot, type CardSlot } from "../models/binderLayout.ts";
import type { CollectFinish } from "../models/cards.ts";

/**
 * Named data to develop against, loaded with `?seed=<name>`.
 *
 * Getting a binder with cards in it onto the screen used to mean pasting a
 * localStorage script into a console — slow, unrepeatable, and different every
 * time, so a screenshot never meant the same thing twice. It is also the same
 * data every e2e test needs. One named fixture serves the browser, the tests
 * and the workshop, so all three exercise identical state.
 *
 * DEV AND TEST ONLY. It writes to real storage, so shipping it would put a URL
 * parameter that overwrites a collection into a public build. `seedingAllowed`
 * is the single gate.
 */

/** Written through the repositories, never straight into localStorage. */
function repos() {
  return new Repositories();
}

const IMG = (set: string, n: number) => `https://images.pokemontcg.io/${set}/${n}.png`;

/** A handful of real printings, so art and prices resolve like the real thing. */
const CARDS: Array<[string, CollectFinish, string, number]> = [
  ["base2-4", "holo", "base2", 4],
  ["ecard3-13", "normal", "ecard3", 13],
  ["ex2-6", "holo", "ex2", 6],
  ["ex10-8", "holo", "ex10", 8],
  ["pop3-3", "normal", "pop3", 3],
  ["dp5-23", "normal", "dp5", 23],
  ["pl2-26", "normal", "pl2", 26],
  ["hgss3-28", "normal", "hgss3", 28],
  ["col1-45", "reverse", "col1", 45],
];

function cardSlot(i: number): CardSlot {
  const [cardId, finish, set, n] = CARDS[i % CARDS.length];
  return {
    kind: "card",
    cardId,
    finish,
    name: "Jolteon",
    imageSmall: IMG(set, n),
    collectorNumber: String(n),
  };
}

function ownFirst(count: number) {
  const repo = repos();
  const now = Date.now();
  for (const [cardId, finish, set] of CARDS.slice(0, count)) {
    repo.addOwned(cardId, finish, set, now);
  }
}

/**
 * Each fixture is a whole starting state, not a patch. A fixture that assumed
 * what came before it would only be reproducible in the order you happened to
 * run them.
 */
export const FIXTURES: Record<string, () => void> = {
  /** Nothing at all — the empty states every screen has and nobody demos. */
  empty: () => {},

  /** A collection with some printings held, and no binders. */
  collection: () => ownFirst(5),

  /** Binders worth looking at: a full one, a sparse one, and an empty one. */
  binders: () => {
    ownFirst(5);
    const repo = repos();
    const now = Date.now();

    let full = emptyBinder("fx-full", "Jolteon", "9", now);
    for (let page = 0; page < 3; page++) {
      for (let i = 0; i < 9; i++) full = placeSlot(full, page, i, cardSlot(page * 9 + i), now);
    }
    // A cover, so the shelf has something to show that is not a page mosaic.
    full = { ...full, cover: cardSlot(0) };

    let sparse = emptyBinder("fx-sparse", "Showcase", "12", now);
    sparse = placeSlot(sparse, 2, 6, cardSlot(3), now);

    const bare = emptyBinder("fx-empty", "Destined rivals", "9", now);

    for (const b of [full, sparse, bare]) repo.saveBinder(b);
  },

  /** A binder on offer: copies and conditions, which only trading uses. */
  trade: () => {
    ownFirst(3);
    const repo = repos();
    const now = Date.now();
    let b = emptyBinder("fx-trade", "Trade", "4", now);
    for (let i = 0; i < 4; i++) {
      const slot = cardSlot(i);
      b = placeSlot(b, 0, i, i === 0 ? { ...slot, quantity: 3, condition: "LP" } : slot, now);
    }
    repo.saveBinder({ ...b, forTrade: true, showValue: true });
  },
};

export type FixtureName = keyof typeof FIXTURES;

/**
 * Whether seeding may run at all.
 *
 * `import.meta.env.DEV` is false in the built bundle, so the whole path is
 * dead code a production build drops. The e2e flag is the deliberate exception:
 * Playwright runs a real build in some projects and still needs fixtures.
 */
export function seedingAllowed(env: Record<string, unknown> | undefined = import.meta.env): boolean {
  return Boolean(env?.DEV) || env?.VITE_USE_MOCKS === "true";
}

export function fixtureFromLocation(search?: string): string | null {
  return new URLSearchParams(search ?? window.location.search).get("seed");
}

/**
 * Apply a named fixture. Returns what happened, so a caller can say so rather
 * than failing silently — an unknown name is a typo worth surfacing.
 */
export function applyFixture(name: string | null): "applied" | "unknown" | "not-allowed" | "none" {
  if (!name) return "none";
  if (!seedingAllowed()) return "not-allowed";
  const fixture = FIXTURES[name];
  if (!fixture) return "unknown";
  fixture();
  return "applied";
}
