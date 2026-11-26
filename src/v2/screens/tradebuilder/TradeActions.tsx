import { useEffect, useRef, useState } from "react";
import { copyLink } from "../../../web/handOverLink.ts";
import { Chip } from "../../primitives/index.ts";
import { summaryLines, summaryText, type TradeLine } from "./summaryText.ts";
import styles from "./tradebuilder.module.css";

/** Draw the summary lines on a canvas and download it as a PNG. False when the browser cannot. */
export async function saveSummaryImage(lines: readonly string[]): Promise<boolean> {
  try {
    const pad = 24;
    const lineHeight = 28;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const font = "18px system-ui, sans-serif";
    ctx.font = font;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 320);
    canvas.width = Math.ceil(widest + pad * 2);
    canvas.height = pad * 2 + lineHeight * (lines.length + 1);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111111";
    ctx.textBaseline = "top";
    ctx.font = `bold 22px system-ui, sans-serif`;
    ctx.fillText("CardLens trade", pad, pad);
    ctx.font = font;
    lines.forEach((l, i) => ctx.fillText(l, pad, pad + lineHeight * (i + 1)));
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cardlens-trade.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/**
 * "Copy as text" and "Save as image" for the finished trade. Both wait until
 * each side has a card. When the clipboard refuses, the text goes on screen in
 * a selectable box.
 */
export function TradeActions({ give, get }: { give: readonly TradeLine[]; get: readonly TradeLine[] }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [image, setImage] = useState<"idle" | "saved" | "failed">("idle");
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const ready = give.length > 0 && get.length > 0;
  const settle = (set: () => void) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(set, 2500);
  };

  const onCopy = async () => {
    const t = summaryText(give, get);
    setText(t);
    const ok = await copyLink(t);
    setCopy(ok ? "copied" : "failed");
    if (ok) settle(() => setCopy("idle"));
  };
  const onSave = async () => {
    const ok = await saveSummaryImage(summaryLines(give, get));
    setImage(ok ? "saved" : "failed");
    if (ok) settle(() => setImage("idle"));
  };

  return (
    <div className={styles.actions}>
      <div className={styles.actionRow}>
        <Chip onPress={() => void onCopy()} disabled={!ready}>
          {copy === "copied" ? "Copied" : "Copy as text"}
        </Chip>
        <Chip onPress={() => void onSave()} disabled={!ready}>
          {image === "saved" ? "Image saved" : "Save as image"}
        </Chip>
      </div>
      {!ready ? <p className={styles.meta}>Add a card to both sides to copy or save the trade.</p> : null}
      {image === "failed" ? (
        <p className={styles.meta} role="alert">
          Could not save an image here. Use Copy as text instead.
        </p>
      ) : null}
      {copy === "failed" ? (
        <div role="alert">
          <p className={styles.meta}>Copy failed: select and copy the trade below.</p>
          <textarea
            className={styles.field}
            readOnly
            rows={10}
            value={text}
            aria-label="Trade summary"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      ) : null}
    </div>
  );
}
