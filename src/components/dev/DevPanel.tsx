import { useCallback, useState } from "react";
import type { WearableInputEvent } from "../../models/input.ts";
import type { MockBehavior } from "../../integrations/pokemon/index.ts";
import { useMockInput, useCatalog } from "../../app/contexts.tsx";
import { useWearableInput } from "../../hooks/useWearableInput.ts";
import { clearAllStorage } from "../../storage/versioned.ts";
import styles from "./DevPanel.module.css";

/**
 * Windows-friendly test surface. Lets you drive the entire app without glasses:
 * simulated Neural Band input, network/state simulation, storage reset, and an
 * input event log. Hidden in production (VITE_ENABLE_DEV_PANEL=false).
 */
export function DevPanel({ onScaleChange }: { onScaleChange?: (scale: number) => void }) {
  const mock = useMockInput();
  const { simulation, setSimulation } = useCatalog();
  const [log, setLog] = useState<string[]>([]);
  const [focusText, setFocusText] = useState("");

  useWearableInput(
    useCallback((e: WearableInputEvent) => {
      setLog((prev) => [`${clock()}  ${e.type}`, ...prev].slice(0, 8));
      // Read the currently focused option's text for the "focus target" readout.
      requestAnimationFrame(() => {
        const el = document.querySelector('[aria-selected="true"]');
        setFocusText(el?.textContent?.trim().slice(0, 48) ?? "");
      });
    }, []),
  );

  const sim = simulation ?? {};

  return (
    <aside className={styles.panel} aria-label="Developer panel">
      <h2 className={styles.h}>Dev Panel</h2>

      <div className={styles.group}>
        <span className={styles.label}>Simulated input</span>
        <div className={styles.pad}>
          <button className={styles.btn} onClick={() => mock.swipeUp()} aria-label="Swipe up">
            ↑
          </button>
          <div className={styles.padRow}>
            <button className={styles.btn} onClick={() => mock.swipeLeft()} aria-label="Swipe left">
              ←
            </button>
            <button
              className={`${styles.btn} ${styles.select}`}
              onClick={() => mock.select()}
              aria-label="Select"
            >
              ●
            </button>
            <button className={styles.btn} onClick={() => mock.swipeRight()} aria-label="Swipe right">
              →
            </button>
          </div>
          <button className={styles.btn} onClick={() => mock.swipeDown()} aria-label="Swipe down">
            ↓
          </button>
          <button className={`${styles.btn} ${styles.back}`} onClick={() => mock.back()} aria-label="Back">
            Back ✕
          </button>
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.label}>Network / state</span>
        <div className={styles.toggles}>
          <Toggle on={!!sim.failNetwork} onClick={() => toggle(setSimulation, sim, "failNetwork")}>
            Offline / API failure
          </Toggle>
          <Toggle on={!!sim.latencyMs} onClick={() => toggleLatency(setSimulation, sim)}>
            Slow network
          </Toggle>
          <Toggle on={!!sim.forceEmpty} onClick={() => toggle(setSimulation, sim, "forceEmpty")}>
            Empty search
          </Toggle>
          <button className={styles.linkBtn} onClick={() => setSimulation(null)}>
            Reset simulation
          </button>
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.label}>Preview size</span>
        <div className={styles.toggles}>
          {[0.75, 1, 1.25].map((s) => (
            <button key={s} className={styles.linkBtn} onClick={() => onScaleChange?.(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.label}>Storage</span>
        <button
          className={styles.linkBtn}
          onClick={() => {
            clearAllStorage();
            location.reload();
          }}
        >
          Clear local storage
        </button>
      </div>

      <div className={styles.group}>
        <span className={styles.label}>Focus target</span>
        <div className={styles.focus}>{focusText || "—"}</div>
      </div>

      <div className={styles.group}>
        <span className={styles.label}>Input log</span>
        <ol className={styles.logList}>
          {log.length === 0 ? <li className={styles.logEmpty}>No events yet</li> : null}
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </div>
    </aside>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`${styles.toggle} ${on ? styles.toggleOn : ""}`} aria-pressed={on} onClick={onClick}>
      {on ? "● " : "○ "}
      {children}
    </button>
  );
}

type SimSetter = (b: MockBehavior | null) => void;

function toggle(setSim: SimSetter, sim: MockBehavior, key: "failNetwork" | "forceEmpty") {
  setSim({ ...sim, [key]: !sim[key] });
}
function toggleLatency(setSim: SimSetter, sim: MockBehavior) {
  setSim({ ...sim, latencyMs: sim.latencyMs ? 0 : 2000 });
}

function clock(): string {
  const d = new Date();
  return d.toLocaleTimeString("en-US", { hour12: false });
}
