import { finishLabel } from "./finishes.ts";
import type { OwnedPrintingRow } from "./ownedSort.ts";

/**
 * One cell. Quoted when it holds a comma, quote or line break (quotes doubled).
 * A cell that starts with = + - @ (or a tab / CR) is prefixed with an apostrophe
 * so a spreadsheet shows it as text instead of running it as a formula.
 */
export function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The owned printings as CSV, in the order given. An unpriced row has an empty
 * price cell: unknown is not zero.
 */
export function ownedToCsv(rows: OwnedPrintingRow[]): string {
  const lines = ["name,set,number,finish,price"];
  for (const r of rows) {
    lines.push(
      [
        cell(r.name),
        cell(r.setName),
        cell(r.collectorNumber),
        cell(finishLabel(r.finish)),
        typeof r.price === "number" ? r.price.toFixed(2) : "",
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** `cardlens-2026-11-18.csv`, from the local date. */
export function csvFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `cardlens-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.csv`;
}
