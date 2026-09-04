import type { LayoutMode } from "./layoutMode.ts";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { WearableInputAdapter } from "../models/input.ts";
import type { CardCatalogProvider, CardPricingProvider } from "../integrations/providers.ts";
import { createInputAdapter, type AppInputAdapter } from "../integrations/meta/index.ts";
import { createPokemonCatalog, createMockCatalog, type MockBehavior } from "../integrations/pokemon/index.ts";
import { Repositories } from "../storage/repositories.ts";

// --- Input ------------------------------------------------------------------
const InputContext = createContext<AppInputAdapter | null>(null);

/**
 * `wearable={false}` drops the keyboard half of the adapter, leaving only the
 * DevPanel's mock channel.
 *
 * This matters more than it looks. `KeyboardBackedInputAdapter` listens on the
 * document and `preventDefault()`s arrows, Enter and Escape — correct on the
 * glasses, where those keys ARE the four gestures and nothing else wants them.
 * On the web it means any screen that subscribes takes arrow keys away from
 * every `<select>`, text field and native scroll on the page.
 *
 * v1 gets away with it because its web screens pass `enabled: false` to
 * `useWearableInput`, so nothing subscribes and the listener is never attached
 * — discipline, at every call site, forever. v2 turns it off at the source
 * instead, so a v2 screen cannot reintroduce the problem by forgetting a flag.
 */
export function InputProvider({
  children,
  value,
  wearable = true,
}: {
  children: ReactNode;
  value?: AppInputAdapter;
  wearable?: boolean;
}) {
  const adapter = useMemo(() => value ?? createInputAdapter(undefined, { wearable }), [value, wearable]);
  return <InputContext.Provider value={adapter}>{children}</InputContext.Provider>;
}

export function useInputAdapter(): WearableInputAdapter {
  const ctx = useContext(InputContext);
  if (!ctx) throw new Error("useInputAdapter must be used within InputProvider");
  return ctx.adapter;
}

export function useMockInput() {
  const ctx = useContext(InputContext);
  if (!ctx) throw new Error("useMockInput must be used within InputProvider");
  return ctx.mock;
}

// --- Catalog / pricing (with DevPanel simulation) ---------------------------
type Combined = CardCatalogProvider & CardPricingProvider;

interface CatalogContextValue {
  provider: Combined;
  /** Part of query keys — changes when the active provider swaps. */
  sourceKey: string;
  simulation: MockBehavior | null;
  setSimulation: (behavior: MockBehavior | null) => void;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

/** Seed a DevPanel-style simulation from `?sim=fail|empty|slow` (e2e + manual). */
function initialSimulationFromUrl(): MockBehavior | null {
  if (typeof window === "undefined") return null;
  const sim = new URLSearchParams(window.location.search).get("sim");
  if (sim === "fail") return { failNetwork: true };
  if (sim === "empty") return { forceEmpty: true };
  if (sim === "slow") return { latencyMs: 2000 };
  return null;
}

export function CatalogProvider({ children, base }: { children: ReactNode; base?: Combined }) {
  const baseProvider = useMemo(() => base ?? createPokemonCatalog(), [base]);
  const [simulation, setSimulation] = useState<MockBehavior | null>(initialSimulationFromUrl);

  const value = useMemo<CatalogContextValue>(() => {
    const provider = simulation ? createMockCatalog(simulation) : baseProvider;
    const sourceKey = simulation ? `sim:${JSON.stringify(simulation)}` : "base";
    return { provider, sourceKey, simulation, setSimulation };
  }, [baseProvider, simulation]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogContextValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalog must be used within CatalogProvider");
  return ctx;
}

// --- Repositories (local storage) -------------------------------------------
const RepositoriesContext = createContext<Repositories | null>(null);

export function RepositoriesProvider({ children, value }: { children: ReactNode; value?: Repositories }) {
  const repos = useMemo(() => value ?? new Repositories(), [value]);
  return <RepositoriesContext.Provider value={repos}>{children}</RepositoriesContext.Provider>;
}

export function useRepositories(): Repositories {
  const ctx = useContext(RepositoriesContext);
  if (!ctx) throw new Error("useRepositories must be used within RepositoriesProvider");
  return ctx;
}

/**
 * Which shell is rendering. Screens read this to decide between the glasses
 * interaction model (focus ring driven by four gestures) and the web one
 * (scroll and tap), which are genuinely different rather than one being a
 * resized version of the other.
 */
const LayoutModeContext = createContext<LayoutMode>("glasses");

export function LayoutModeProvider({ mode, children }: { mode: LayoutMode; children: ReactNode }) {
  return <LayoutModeContext.Provider value={mode}>{children}</LayoutModeContext.Provider>;
}

export function useLayoutMode(): LayoutMode {
  return useContext(LayoutModeContext);
}

/** Web gets native scrolling and tapping; the focus ring would fight both. */
export function useIsWeb(): boolean {
  return useContext(LayoutModeContext) === "web";
}
