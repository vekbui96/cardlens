import type { CardCatalogProvider, CardPricingProvider } from "../providers.ts";
import { MockPokemonProvider, type MockBehavior } from "./MockPokemonProvider.ts";
import { PokemonTcgIoProvider } from "./PokemonTcgIoProvider.ts";

export { PokemonTcgIoProvider } from "./PokemonTcgIoProvider.ts";
export { MockPokemonProvider } from "./MockPokemonProvider.ts";
export type { MockBehavior } from "./MockPokemonProvider.ts";
export { PokemonGameProvider } from "./PokemonGameProvider.ts";

type Combined = CardCatalogProvider & CardPricingProvider;

function readEnv(name: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env;
  const value = env?.[name];
  return typeof value === "string" ? value : undefined;
}

export function shouldUseMocks(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  return Boolean(env?.VITEST) || env?.MODE === "test" || readEnv("VITE_USE_MOCKS") === "true";
}

/** The primary catalog+pricing provider, chosen from env (mock vs real). */
export function createPokemonCatalog(): Combined {
  if (shouldUseMocks()) return new MockPokemonProvider();
  const baseUrl = readEnv("VITE_API_BASE_URL");
  const apiKey = readEnv("VITE_POKEMONTCG_API_KEY"); // usually unset in browser; use the proxy instead
  return new PokemonTcgIoProvider({
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  });
}

/** A mock provider for DevPanel simulations (empty/slow/fail) regardless of env. */
export function createMockCatalog(behavior?: MockBehavior): MockPokemonProvider {
  return new MockPokemonProvider(behavior);
}
