/**
 * The Target restock watchlist, as the bot reports it.
 *
 * Shapes mirror the bot's JSON exactly rather than being remapped, so a field
 * added there needs one change here and not a translation layer to keep honest.
 */

/** What a check concluded. `BLOCKED` is PerimeterX, not a stock state. */
export type StockStatus = "IN_STOCK" | "OUT" | "BLOCKED" | "ERROR";

export interface WatchedProduct {
  tcin: string;
  name: string;
  url: string;
  enabled: boolean;
  /**
   * The bot's own canary product, kept permanently in stock so a silent
   * watchlist can be told apart from a broken checker. Not the user's to remove.
   */
  healthCheck: boolean;
  autoCart: boolean;
  lastStatus: string | null;
  lastCheckedAt: string | null;
  lastAlertedAt: string | null;
  createdAt: string | null;
}

export interface BotRuntime {
  startedAt: string | null;
  lastCheckStartedAt: string | null;
  lastCheckFinishedAt: string | null;
  lastCheckDurationSeconds: number | null;
  checksCompleted: number;
  blocked: boolean;
  blockBackoffSeconds: number;
  checkIntervalSeconds: number;
  storeId: string;
  paused: boolean;
  /** False before the Playwright browser has warmed; every check fails until it has. */
  browserReady: boolean;
}

export interface BotState {
  runtime: BotRuntime;
  products: WatchedProduct[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseProduct(value: unknown): WatchedProduct | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const tcin = str(v.tcin);
  if (!tcin) return null;

  return {
    tcin,
    name: str(v.name) || `Target Product ${tcin}`,
    url: str(v.url),
    enabled: Boolean(v.enabled),
    healthCheck: Boolean(v.healthCheck),
    autoCart: Boolean(v.autoCart),
    lastStatus: nullableStr(v.lastStatus),
    lastCheckedAt: nullableStr(v.lastCheckedAt),
    lastAlertedAt: nullableStr(v.lastAlertedAt),
    createdAt: nullableStr(v.createdAt),
  };
}

/**
 * Parse a `/api/target/state` payload.
 *
 * Unrecognisable products are dropped rather than failing the whole screen: one
 * malformed row should not hide the twelve good ones, exactly as collection
 * sync drops bad rows instead of rejecting the batch.
 */
export function parseBotState(value: unknown): BotState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const r = (v.runtime ?? {}) as Record<string, unknown>;
  if (!Array.isArray(v.products)) return null;

  return {
    runtime: {
      startedAt: nullableStr(r.startedAt),
      lastCheckStartedAt: nullableStr(r.lastCheckStartedAt),
      lastCheckFinishedAt: nullableStr(r.lastCheckFinishedAt),
      lastCheckDurationSeconds:
        typeof r.lastCheckDurationSeconds === "number" ? r.lastCheckDurationSeconds : null,
      checksCompleted: num(r.checksCompleted),
      blocked: Boolean(r.blocked),
      blockBackoffSeconds: num(r.blockBackoffSeconds),
      checkIntervalSeconds: num(r.checkIntervalSeconds),
      storeId: str(r.storeId),
      paused: Boolean(r.paused),
      browserReady: Boolean(r.browserReady),
    },
    products: v.products.flatMap((p) => parseProduct(p) ?? []),
  };
}

/** A TCIN, from a bare id or any Target product URL (`/-/A-12345678`). */
export function extractTcin(text: string): string | null {
  const trimmed = text.trim();
  const match = /A-(\d+)/.exec(trimmed);
  if (match) return match[1];
  return /^\d{1,15}$/.test(trimmed) ? trimmed : null;
}

/** How a status should read on screen. `null` is "never checked". */
export function statusLabel(status: string | null): string {
  switch (status) {
    case "IN_STOCK":
      return "In stock";
    case "OUT":
      return "Out of stock";
    case "BLOCKED":
      return "Blocked";
    case "ERROR":
      return "Error";
    default:
      return "Not checked yet";
  }
}
