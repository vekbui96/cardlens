import type { Binder } from "../../models/binderLayout.ts";
import { MAX_NAME } from "../../models/binderParse.ts";

const SUFFIX = " copy";

/**
 * The copy's name: "<name> copy", trimmed to what sync will accept.
 *
 * The trim is not cosmetic. `parseBinder` refuses a binder whose name is over
 * `MAX_NAME`, and a refused binder is DROPPED from the push — so the copy of a
 * binder with a 120-character name would save on this device, show on the
 * shelf, and never reach any other. The original's words are cut, never the
 * suffix, so the two stay tellable apart.
 */
export function copyName(name: string): string {
  const room = MAX_NAME - SUFFIX.length;
  return `${name.length > room ? name.slice(0, room).trimEnd() : name}${SUFFIX}`;
}

/**
 * A new binder holding exactly what this one holds, to try a layout on.
 *
 * Kept in the web shell rather than beside the other layout operations in
 * `models/binderLayout.ts`: that file is compiled by the server too, and a
 * client-only action has no business forcing a server deploy.
 *
 * What is NOT copied, and why:
 *
 * - `forTrade`. A binder offered for trade publishes a live link; a copy made
 *   to rearrange must not quietly become a second one.
 * - `showValue`. Each priced binder costs a request per set it spans on the
 *   binders list, so the copy opts in on its own if it wants to.
 * - `deletedAt`. A copy is alive by definition.
 *
 * Both flags are left ABSENT rather than written as `false`, the same "absent
 * means default" this codebase uses for `quantity` and `cover`.
 *
 * Image pockets keep their `imageId`, so the two binders share the server's
 * file. That is safe: the server's sweep deletes only images that NO live
 * binder references, so deleting either binder leaves the other's art intact.
 *
 * A deep copy through JSON — the same shape that crosses sync — so an edit to
 * the copy can never reach into the original's pages. Blank pages are kept
 * (never trimmed automatically).
 */
export function duplicateBinder(binder: Binder, id: string, now: number): Binder {
  const pages = JSON.parse(JSON.stringify(binder.pages)) as Binder["pages"];
  const cover = binder.cover ? (JSON.parse(JSON.stringify(binder.cover)) as Binder["cover"]) : undefined;
  return {
    id,
    name: copyName(binder.name),
    format: binder.format,
    pages,
    ...(cover ? { cover } : {}),
    createdAt: now,
    updatedAt: now,
  };
}
