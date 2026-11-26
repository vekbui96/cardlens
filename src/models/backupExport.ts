import type { Binder } from "./binderLayout.ts";
import { finishLabel } from "./finishes.ts";
import { cell, ownedToCsv } from "./ownedCsv.ts";
import type { OwnedPrintingRow } from "./ownedSort.ts";

/**
 * Read-only copies of what the collector holds, for the "Back up" section.
 * Nothing here reads or writes storage: the caller hands in the rows and the
 * binders, and gets text back. An unknown price is empty (CSV) or null (JSON),
 * never zero.
 */

export interface BackupCounts {
  owned: number;
  binders: number;
  /** Filled pockets (cards and images) across every binder. */
  slots: number;
}

export function backupCounts(rows: OwnedPrintingRow[], binders: Binder[]): BackupCounts {
  let slots = 0;
  for (const b of binders) for (const p of b.pages) slots += Object.keys(p.slots).length;
  return { owned: rows.length, binders: binders.length, slots };
}

interface BinderRecord {
  binder: string;
  format: string;
  forTrade: boolean;
  page: number;
  slot: number;
  kind: "card" | "image";
  cardId: string;
  name: string;
  number: string;
  finish: string;
  quantity: number;
  condition: string;
  label: string;
}

/** One record per filled pocket, in page then pocket order. Pages and pockets count from 1. */
function binderRecords(binders: Binder[]): BinderRecord[] {
  const out: BinderRecord[] = [];
  for (const b of binders) {
    b.pages.forEach((page, pi) => {
      const keys = Object.keys(page.slots)
        .map(Number)
        .sort((x, y) => x - y);
      for (const k of keys) {
        const s = page.slots[k];
        const base = {
          binder: b.name,
          format: b.format,
          forTrade: b.forTrade === true,
          page: pi + 1,
          slot: k + 1,
        };
        if (s.kind === "card") {
          out.push({
            ...base,
            kind: "card",
            cardId: s.cardId,
            name: s.name ?? "",
            number: s.collectorNumber ?? "",
            finish: finishLabel(s.finish),
            quantity: s.quantity ?? 1,
            condition: s.condition ?? "",
            label: "",
          });
        } else {
          out.push({
            ...base,
            kind: "image",
            cardId: "",
            name: "",
            number: "",
            finish: "",
            quantity: 1,
            condition: "",
            label: s.label ?? "",
          });
        }
      }
    });
  }
  return out;
}

export function bindersToCsv(binders: Binder[]): string {
  const lines = [
    "binder,format,for_trade,page,slot,kind,card_id,name,number,finish,quantity,condition,label",
  ];
  for (const r of binderRecords(binders)) {
    lines.push(
      [
        cell(r.binder),
        cell(r.format),
        r.forTrade ? "yes" : "no",
        String(r.page),
        String(r.slot),
        r.kind,
        cell(r.cardId),
        cell(r.name),
        cell(r.number),
        cell(r.finish),
        String(r.quantity),
        cell(r.condition),
        cell(r.label),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export function ownedToJson(rows: OwnedPrintingRow[]): string {
  const cards = rows.map((r) => ({
    cardId: r.cardId,
    name: r.name,
    set: r.setName,
    number: r.collectorNumber,
    finish: finishLabel(r.finish),
    price: typeof r.price === "number" ? r.price : null,
  }));
  return JSON.stringify({ kind: "cardlens-owned", count: cards.length, cards }, null, 2) + "\n";
}

export function bindersToJson(binders: Binder[]): string {
  const out = binders.map((b) => ({
    name: b.name,
    format: b.format,
    forTrade: b.forTrade === true,
    pages: b.pages.map((page, pi) => ({
      page: pi + 1,
      slots: Object.keys(page.slots)
        .map(Number)
        .sort((x, y) => x - y)
        .map((k) => {
          const s = page.slots[k];
          return s.kind === "card"
            ? {
                slot: k + 1,
                kind: "card",
                cardId: s.cardId,
                name: s.name ?? null,
                number: s.collectorNumber ?? null,
                finish: finishLabel(s.finish),
                quantity: s.quantity ?? 1,
                condition: s.condition ?? null,
              }
            : { slot: k + 1, kind: "image", label: s.label ?? null };
        }),
    })),
  }));
  return JSON.stringify({ kind: "cardlens-binders", count: out.length, binders: out }, null, 2) + "\n";
}

export type BackupKind = "owned-csv" | "owned-json" | "binders-csv" | "binders-json";

export interface BackupFile {
  name: string;
  mime: string;
  text: string;
}

const p2 = (n: number) => String(n).padStart(2, "0");
const day = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/** `cardlens-owned-2026-11-25.csv`, `cardlens-binders-2026-11-25.json`, ... from the local date. */
export function backupFileName(kind: BackupKind, now: Date): string {
  const [what, ext] = kind.split("-");
  return `cardlens-${what}-${day(now)}.${ext}`;
}

export function buildBackupFile(
  kind: BackupKind,
  rows: OwnedPrintingRow[],
  binders: Binder[],
  now: Date,
): BackupFile {
  const name = backupFileName(kind, now);
  switch (kind) {
    case "owned-csv":
      return { name, mime: "text/csv;charset=utf-8", text: "﻿" + ownedToCsv(rows) };
    case "binders-csv":
      return { name, mime: "text/csv;charset=utf-8", text: "﻿" + bindersToCsv(binders) };
    case "owned-json":
      return { name, mime: "application/json", text: ownedToJson(rows) };
    case "binders-json":
      return { name, mime: "application/json", text: bindersToJson(binders) };
  }
}
