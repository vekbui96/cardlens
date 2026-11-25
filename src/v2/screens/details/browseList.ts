import type { PokemonCardSummary } from "../../../models/cards.ts";

/**
 * The list a card was opened from, so card details can step to its neighbours.
 *
 * ## Session state, not stored data
 *
 * The ids and a label live in `sessionStorage` (one tab, gone when it closes,
 * never synced), so a refresh on a card keeps its arrows. The summaries that
 * travelled with a tap are held in memory only: they let the next card's header
 * paint at once, and the screen refetches by id anyway.
 *
 * ## One entry per card
 *
 * Everything owned lists printings, so a card held as normal and reverse is two
 * rows next to each other. Stepping from it must reach the next CARD, not the
 * same card again, so repeated ids collapse to their first place.
 */

export interface BrowseList {
  /** What the list is, in words: "Search results", "Everything owned". */
  label: string;
  cardIds: string[];
}

export interface BrowseEntry {
  cardId: string;
  summary?: PokemonCardSummary;
}

export interface Neighbours {
  /** 1-based position, as it is shown. */
  position: number;
  total: number;
  previous?: BrowseEntry;
  next?: BrowseEntry;
}

// v2: lists remembered before lists were cleared on leaving their screens are dropped.
const KEY = "cardlens:v2:browse-list";

const summaries = new Map<string, PokemonCardSummary>();

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** Remember the list about to be left, in the order it is shown. */
export function rememberBrowseList(label: string, entries: BrowseEntry[]): void {
  summaries.clear();
  for (const e of entries) if (e.summary && !summaries.has(e.cardId)) summaries.set(e.cardId, e.summary);
  const list: BrowseList = { label, cardIds: unique(entries.map((e) => e.cardId)) };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private mode or a full quota: the arrows simply do not appear.
  }
}

/** Forget the remembered list (and its in-memory summaries). */
export function clearBrowseList(): void {
  summaries.clear();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/**
 * Screens a remembered list may outlive: the lists it comes from (Search,
 * Everything owned) and card details itself. Landing anywhere else (Home, the
 * Want list, a link) ends the list, so a card opened from there is not offered
 * stale Previous/Next arrows.
 */
export function keepsBrowseList(screenName: string): boolean {
  return (
    screenName === "details" ||
    screenName === "results" ||
    screenName === "owned" ||
    screenName === "collection"
  );
}

/** The remembered list, or null. Corruption-safe: anything malformed is no list. */
export function readBrowseList(): BrowseList | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrowseList>;
    if (typeof parsed.label !== "string" || !Array.isArray(parsed.cardIds)) return null;
    const cardIds = parsed.cardIds.filter((id): id is string => typeof id === "string");
    return { label: parsed.label, cardIds: unique(cardIds) };
  } catch {
    return null;
  }
}

function entry(cardId: string | undefined): BrowseEntry | undefined {
  if (cardId === undefined) return undefined;
  const summary = summaries.get(cardId);
  return summary ? { cardId, summary } : { cardId };
}

/**
 * Where `cardId` sits in `list`. Null when it is not there (a card opened from
 * a link, or from a screen that keeps no list) or the list has only that card:
 * there is nowhere to step to, so no controls are drawn.
 */
export function neighbours(list: BrowseList | null, cardId: string): Neighbours | null {
  if (!list) return null;
  const ids = unique(list.cardIds);
  const index = ids.indexOf(cardId);
  if (index < 0 || ids.length < 2) return null;
  const result: Neighbours = { position: index + 1, total: ids.length };
  const previous = entry(ids[index - 1]);
  const next = entry(ids[index + 1]);
  if (previous) result.previous = previous;
  if (next) result.next = next;
  return result;
}

const SWIPE_BLOCKERS = "a,button,input,select,textarea,summary,[role=button],[data-no-swipe]";

/**
 * Whether a touch that began on `target` belongs to something else: a control,
 * or a region the finger can scroll sideways (printings list, wide price table).
 * Such a drag must not step to another card. Walks up to, not past, `boundary`.
 */
export function swipeStartsOnScroller(target: EventTarget | null, boundary: Element): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== boundary) {
    if (el.matches(SWIPE_BLOCKERS)) return true;
    const x = getComputedStyle(el).overflowX;
    if (x === "auto" || x === "scroll") return true;
    el = el.parentElement;
  }
  return false;
}

/** A swipe has to be this long, in CSS pixels, to count. */
export const SWIPE_MIN = 60;

/**
 * Which way a finished touch steps: 1 = next (finger moved left), -1 =
 * previous (moved right), 0 = not a swipe. Mostly-vertical movement is a
 * scroll and never steps.
 */
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 2) return 0;
  return dx < 0 ? 1 : -1;
}
