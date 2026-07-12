import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { WearableInputAdapter } from "../models/input.ts";
import type { CardCatalogProvider, CardPricingProvider } from "../integrations/providers.ts";
import { createInputAdapter, type AppInputAdapter } from "../integrations/meta/index.ts";
import { createPokemonCatalog, createMockCatalog, type MockBehavior } from "../integrations/pokemon/index.ts";
import { Repositories } from "../storage/repositories.ts";

// --- Input ------------------------------------------------------------------
const InputContext = createContext<AppInputAdapter | null>(null);

export function InputProvider({ children, value }: { children: ReactNode; value?: AppInputAdapter }) {
  const adapter = useMemo(() => value ?? createInputAdapter(), [value]);
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
