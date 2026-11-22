import { parseLastLook, type LastLookState } from "../models/lastLook.ts";
import { VersionedStore } from "./versioned.ts";

/**
 * The one device-local key behind "Since you last looked" (#110):
 * `cardlens:v1:last-look:v1`. The trailing `:v1` versions this value on its own,
 * so a future shape can migrate on read without bumping the whole namespace
 * (which would wipe the collection).
 *
 * Not synced, not a cache: `evictCaches` only drops `cache:` keys, so this
 * survives a quota squeeze. Every read is corruption-safe and every write is
 * best-effort; a failure here only costs one comparison.
 */
export const LAST_LOOK_KEY = "last-look:v1";

let defaultStore: VersionedStore | null = null;
function store(given?: VersionedStore): VersionedStore {
  if (given) return given;
  defaultStore ??= new VersionedStore();
  return defaultStore;
}

const anything = (_v: unknown): _v is unknown => true;

export function readLastLook(given?: VersionedStore): LastLookState | null {
  try {
    return parseLastLook(store(given).read<unknown>(LAST_LOOK_KEY, anything, null));
  } catch {
    return null;
  }
}

export function writeLastLook(state: LastLookState, given?: VersionedStore): boolean {
  try {
    return store(given).write(LAST_LOOK_KEY, state);
  } catch {
    return false;
  }
}
