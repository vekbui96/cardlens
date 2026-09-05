import { useShare } from "./useShare.ts";
import { ShareGone, ShareLoading } from "./ShareFrame.tsx";
import { SetShowcase } from "./SetShowcase.tsx";

/**
 * A shared set that keeps up to date.
 *
 * The snapshot showcase carries its data in the link, so what you sent is what
 * they see, forever. This one carries only an id and re-reads the collection —
 * which is the whole difference: mark a card and everyone holding the link
 * sees it.
 *
 * A binder share opened on this route renders as gone rather than as an empty
 * set. It is a real id, but it is not this page's kind of share, and quietly
 * drawing nothing would look like a bug in the link.
 */
export function LiveShowcaseScreen({ shareId }: { shareId: string }) {
  const query = useShare(shareId);

  if (query.isLoading) return <ShareLoading what="this set" />;
  if (query.isError || query.data?.kind !== "set") {
    return <ShareGone onRetry={() => void query.refetch()} />;
  }

  const share = query.data;
  return (
    <SetShowcase setId={share.setId} setName={share.setName} owned={share.owned} live updatedAt={share.at} />
  );
}
