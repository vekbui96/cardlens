import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CardLens's own card list, read by the server from the card index that ships
 * with the app (`public/card-index/`).
 *
 * The photo engine answers in TCGdex ids; this is what decides whether a
 * translated id is real. It is the same file the device and the Python
 * recogniser read, so "the server knows this card" and "the app can file this
 * card" are one fact, not two lists that drift. The service runs from a full
 * checkout (`D:\services\cardlens`), so the files are always beside it, and a
 * card-index rebuild ships with an ordinary server deploy.
 */

export interface IndexCard {
  id: string;
  name: string;
  number: string;
  setId: string;
  setName: string;
}

const DEFAULT_DIR = fileURLToPath(new URL("../public/card-index/", import.meta.url));

export class CardIndexLookup {
  private loading: Promise<Map<string, IndexCard>> | null = null;

  constructor(private readonly dir: string = process.env.CARD_INDEX_DIR ?? DEFAULT_DIR) {}

  /**
   * The id → card map, loaded once. A failed load is not cached, so a missing
   * file found at boot does not stay broken until the next restart.
   */
  load(): Promise<Map<string, IndexCard>> {
    this.loading ??= (async () => {
      const latest = JSON.parse(await readFile(join(this.dir, "latest.json"), "utf8")) as { version: string };
      const cards = JSON.parse(
        await readFile(join(this.dir, `cards-${latest.version.replace(/[^A-Za-z0-9]/g, "")}.json`), "utf8"),
      ) as IndexCard[];
      return new Map(cards.map((c) => [c.id, c]));
    })().catch((err: unknown) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }
}
