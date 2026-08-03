import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useRepositories } from "../app/contexts.tsx";
import { companionBase } from "../services/companionApi.ts";
import { fetchJson } from "../services/http.ts";
import { parseBotState, type BotState } from "../models/target.ts";

const KEY = ["target-bot-state"];

/**
 * The watchlist refreshes on its own because the bot moves without us: it
 * sweeps every ~60s and a restock is the whole point of the screen. Half the
 * sweep interval means a change is visible within a sweep without polling a
 * browser-driven backend harder than it works.
 */
const REFETCH_MS = 30_000;

/**
 * A check drives a real browser through PerimeterX, with a re-warm and retry on
 * failure. The shared default of 8s would abort a call that was going to work.
 */
const CHECK_TIMEOUT_MS = 90_000;

/** A cart test is a check plus the add, the checkout click and the cleanup. */
const CART_TIMEOUT_MS = 120_000;

export interface CartTestResult {
  ok: boolean;
  detail: string;
  /** Items the cleanup pass removed — should be 1 after a successful add. */
  removed: number;
  /** PNG data URI showing where the flow stopped, or null if none was taken. */
  screenshot: string | null;
}

export class TargetAuthError extends Error {
  constructor() {
    super("Sync token missing or rejected");
    this.name = "TargetAuthError";
  }
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/**
 * Read and drive the Target restock bot.
 *
 * Its own token, NOT the collection one: these routes reach a browser that can
 * put things in a real Target cart, and the collection token is deliberately
 * spread across every syncing device. Held in React state so entering it
 * re-renders the screen straight into the connected view.
 */
export function useTargetBot() {
  const repo = useRepositories();
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState(() => repo.getTargetSettings().token);
  const base = companionBase();

  const setToken = useCallback(
    (value: string) => setTokenState(repo.setTargetSettings({ token: value.trim() }).token),
    [repo],
  );

  const query = useQuery<BotState>({
    queryKey: KEY,
    enabled: Boolean(token),
    refetchInterval: REFETCH_MS,
    // The bot is on a home server; a transient blip should not blank a screen
    // that already has good data.
    retry: 1,
    queryFn: async ({ signal }) => {
      const raw = await fetchJson(`${base}/target/state`, {
        headers: authHeaders(token),
        signal,
        timeoutMs: 15_000,
      });
      const parsed = parseBotState(raw);
      if (!parsed) throw new Error("Unrecognisable response from the bot");
      return parsed;
    },
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: KEY });
  }, [queryClient]);

  const post = useCallback(
    async (path: string, body?: unknown, timeoutMs?: number) => {
      if (!token) throw new TargetAuthError();
      return fetchJson(`${base}/target${path}`, {
        method: "POST",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(timeoutMs ? { timeoutMs } : {}),
      });
    },
    [base, token],
  );

  const add = useMutation({
    mutationFn: (input: { target: string; name?: string }) =>
      // Adding resolves the real product title and a first status through the
      // bot's browser, so it is as slow as a check.
      post("/watchlist", input, CHECK_TIMEOUT_MS),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (tcin: string) => {
      if (!token) throw new TargetAuthError();
      return fetchJson(`${base}/target/watchlist/${tcin}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async (input: { tcin: string; enabled?: boolean; autoCart?: boolean }) => {
      if (!token) throw new TargetAuthError();
      const { tcin, ...patch } = input;
      return fetchJson(`${base}/target/watchlist/${tcin}`, {
        method: "PATCH",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
    },
    onSuccess: invalidate,
  });

  const checkNow = useMutation({
    mutationFn: (tcin: string) => post(`/watchlist/${tcin}/check`, undefined, CHECK_TIMEOUT_MS),
    onSuccess: invalidate,
  });

  /**
   * Carts the item for real, then empties the cart again.
   *
   * The only way to prove the cart path works, since it needs the hard Target
   * login and a restock cannot be scheduled. Longer timeout than a check: it
   * walks the product page, the add, the cart, the checkout click and the
   * cleanup.
   */
  const testCart = useMutation({
    mutationFn: (tcin: string) =>
      post(`/watchlist/${tcin}/testcart`, undefined, CART_TIMEOUT_MS) as Promise<CartTestResult>,
    onSuccess: invalidate,
  });

  const setPaused = useMutation({
    mutationFn: (paused: boolean) => post("/pause", { paused }),
    onSuccess: invalidate,
  });

  return {
    hasToken: Boolean(token),
    setToken,
    state: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: invalidate,
    add,
    remove,
    update,
    checkNow,
    testCart,
    setPaused,
  };
}
