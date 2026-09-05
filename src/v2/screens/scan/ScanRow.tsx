import { Chip, Row, Stack, cx } from "../../primitives/index.ts";
import { RowFinishes } from "./RowFinishes.tsx";
import { chosenOf, type Capture } from "./batch.ts";
import type { CollectFinish } from "../../../models/cards.ts";
import styles from "./scan.module.css";

/**
 * One capture, and the decision it is still waiting for.
 *
 * The order inside the row is the argument: the number band sits directly UNDER
 * the question and ABOVE the candidates, because you read the number and then
 * choose. Rendered below the buttons it would arrive after the decision it
 * exists to inform.
 */
export function ScanRow({
  capture,
  canPick,
  onChoose,
  onFinish,
  onToggleReject,
  onPickByHand,
  onOpenSet,
}: {
  capture: Capture;
  /** The index is what "Pick by set" reads; without it there is nothing to browse. */
  canPick: boolean;
  onChoose: (index: number) => void;
  onFinish: (finish: CollectFinish) => void;
  onToggleReject: () => void;
  onPickByHand: () => void;
  onOpenSet: (setId: string, setName: string) => void;
}) {
  const chosen = chosenOf(capture);
  const result = capture.result;

  /*
   * The card's own number, for a row the scanner could not settle.
   *
   * Declared once and placed by each branch that needs it. Two branches want
   * it: with candidates, they are reprints with identical artwork and the
   * printed number is usually the only thing separating them; with none, this
   * is what makes "Pick by set" a lookup rather than a guess.
   *
   * Shown, never read. Nothing here parses it, so it cannot file the wrong
   * card — which is the failure OCR would introduce and the reason this stops
   * short of it.
   */
  const numberBand = capture.numberBand ? (
    <img
      className={styles.numberBand}
      src={capture.numberBand}
      alt="The bottom of the scanned card, where its collector number is printed"
      data-testid="number-band"
    />
  ) : null;

  return (
    <li className={cx(styles.row, capture.rejected && styles.rowRejected)} data-testid="scan-row">
      {/* Evidence, not card art: this is what the camera saw, and the row's
          own text names the card. */}
      <img className={styles.thumb} src={capture.thumb} alt="" />

      <Stack gap={2}>
        {capture.manual ? (
          <>
            <span className={styles.name}>{capture.manual.name}</span>
            <span className={styles.sub}>
              {capture.manual.setName} · {capture.manual.number} · named by hand
            </span>
          </>
        ) : capture.tokenRejected ? (
          <>
            <span className={styles.warnText}>The server refused this device — nothing identified this</span>
            <span className={styles.sub}>{capture.note}</span>
            {numberBand}
          </>
        ) : !result ? (
          <span className={styles.sub}>{capture.note ?? "Recognising…"}</span>
        ) : result.candidates.length === 0 ? (
          <>
            <span className={styles.sub}>No match found</span>
            {numberBand}
          </>
        ) : chosen && result.confident ? (
          <>
            <span className={styles.name}>{chosen.card.name}</span>
            <span className={styles.sub}>
              {chosen.card.setName} · {chosen.card.number} · {chosen.distance} bits
              {result.runnerUp && chosen.distance !== null
                ? `, ${result.runnerUp.distance - chosen.distance} clear`
                : ""}
            </span>
          </>
        ) : (
          <>
            <span className={styles.sub}>{capture.choice === null ? "Which one?" : "Chosen"}</span>
            {numberBand}
            <div className={styles.candidates} role="group" aria-label="Which card is this?">
              {result.candidates.map((cand, i) => (
                <button
                  key={cand.card.id}
                  type="button"
                  className={cx(styles.candidate, capture.choice === i && styles.candidateOn)}
                  aria-pressed={capture.choice === i}
                  onClick={() => onChoose(i)}
                >
                  <span className={styles.candidateName}>{cand.card.name}</span>
                  <span className={styles.candidateSub}>
                    {cand.card.setName} · {cand.card.number} · {cand.distance} bits
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {/*
          Which recogniser answered, per row and not just per session. The
          engine can change mid-batch — one timeout falls this card back to the
          device and the next one reaches the server again — so a single banner
          would describe the wrong rows.
        */}
        {capture.via ? (
          <Row gap={2} wrap>
            <Chip tone={capture.failedOver ? "warn" : "default"}>
              {capture.via === "server" ? "Server" : "On device"}
            </Chip>
            {capture.note ? <span className={styles.via}>{capture.note}</span> : null}
          </Row>
        ) : null}

        <Row gap={2} wrap>
          {/*
            Only once a card is chosen: printings are per card, and offering
            finishes for a row that has not been identified is asking which
            variant of nothing this is.
          */}
          {chosen ? <RowFinishes card={chosen.card} value={capture.finish} onChange={onFinish} /> : null}
          <Chip
            onPress={onToggleReject}
            pressed={capture.rejected}
            tone={capture.rejected ? "warn" : "default"}
          >
            Reject
          </Chip>
          {/*
            The way out when the right card is not among the three offered —
            the whole of what the accept gate refuses, plus anything the camera
            never saw properly.
          */}
          {canPick ? (
            <Chip onPress={onPickByHand} tone={capture.manual ? "accent" : "default"}>
              {capture.manual ? "Change" : "Pick by set"}
            </Chip>
          ) : (
            // Inert rather than a dead button: the repair path genuinely is not
            // available without the index, and a control that looks pressable
            // and is not is how a UI lies.
            <Chip tone="warn">Pick by set needs the card index</Chip>
          )}
          {chosen ? (
            <Chip onPress={() => onOpenSet(chosen.card.setId, chosen.card.setName)}>Open set</Chip>
          ) : null}
        </Row>
      </Stack>
    </li>
  );
}
