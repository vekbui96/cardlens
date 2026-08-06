import { useQuery } from "@tanstack/react-query";
import { Screen } from "../../components/Screen.tsx";
import { LoadingState, ErrorState } from "../../components/States.tsx";
import { ShowcaseView } from "./ShowcaseScreen.tsx";
import { companionBase } from "../../services/companionApi.ts";
import { fetchJson } from "../../services/http.ts";
import { canonicalFinish } from "../../models/finishes.ts";
import type { ShowcasePrinting } from "../../models/showcase.ts";
import { useNavigation } from "../../app/NavigationProvider.tsx";
import styles from "./ShowcaseScreen.module.css";

/**
 * A shared set that keeps up to date.
 *
 * The snapshot showcase carries its data in the link, so what you sent is
 * frozen at the moment you sent it. This one carries only an id and re-reads
 * the collection, which is the whole difference: mark a card and everyone
 * holding the link sees it.
 *
 * No token. The id IS the credential (16 random bytes, see server/shareStore),
 * because the recipient is by definition someone who has no account here.
 */

/**
 * Polled rather than pushed.
 *
 * A collection changes when a human marks a card, which is minutes apart at
 * best — a socket would hold an open connection per viewer through a Tailscale
 * Funnel to answer "nothing yet" all day. Refetching on focus is what actually
 * makes it feel live: you look at the page, it is current.
 */
const POLL_MS = 60_000;

interface LiveShare {
  setId: string;
  setName: string;
  owned: ShowcasePrinting[];
  at: number;
}

function parseShare(value: unknown): LiveShare | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.setId !== "string" || typeof v.setName !== "string") return null;
  if (!Array.isArray(v.owned)) return null;

  const owned = v.owned.flatMap((row): ShowcasePrinting[] => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    if (typeof r.collectorNumber !== "string" || typeof r.finish !== "string") return [];
    // Canonicalised here as everywhere else, so a legacy finish from an old
    // client does not become a second key the UI never looks under.
    return [
      {
        collectorNumber: r.collectorNumber,
        finish: canonicalFinish(r.finish),
        ...(typeof r.at === "number" ? { at: r.at } : {}),
      },
    ];
  });

  return {
    setId: v.setId,
    setName: v.setName,
    owned,
    at: typeof v.at === "number" ? v.at : Date.now(),
  };
}

export function LiveShowcaseScreen({ shareId }: { shareId: string }) {
  const { openSets } = useNavigation();
  const base = companionBase();

  const query = useQuery<LiveShare>({
    queryKey: ["live-share", shareId],
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    // A revoked or mistyped link is a permanent answer, not a blip worth
    // retrying three times while the visitor waits.
    retry: (count, err) => !(err instanceof Error && err.message.includes("Not found")) && count < 1,
    queryFn: async ({ signal }) => {
      const raw = await fetchJson(`${base}/share/${encodeURIComponent(shareId)}`, { signal });
      const parsed = parseShare(raw);
      if (!parsed) throw new Error("Unrecognisable response");
      return parsed;
    },
  });

  if (query.isLoading) {
    return (
      <Screen title="Shared set" canGoBack>
        <LoadingState label="Loading shared set…" />
      </Screen>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Screen
        title="Shared set"
        headerLeft={
          <button type="button" className={styles.brand} onClick={openSets}>
            CardLens
          </button>
        }
        canGoBack
      >
        {/* Revoked and never-existed read the same on purpose — the server does
            not distinguish them, so neither can this. */}
        <ErrorState
          message="This link is no longer shared"
          onRetry={() => void query.refetch()}
          retryFocused={false}
        />
      </Screen>
    );
  }

  return (
    <ShowcaseView
      setId={query.data.setId}
      setName={query.data.setName}
      owned={query.data.owned}
      live
      updatedAt={query.data.at}
    />
  );
}
