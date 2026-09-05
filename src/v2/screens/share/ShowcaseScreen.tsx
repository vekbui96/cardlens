import { useMemo } from "react";
import { decodeShowcase } from "../../../models/showcase.ts";
import { SetShowcase } from "./SetShowcase.tsx";

/**
 * A shared set, read entirely from the LINK.
 *
 * The ownership is encoded in the URL, so this page needs no server at all
 * beyond the card list — and it is frozen at the moment it was sent. That is
 * the difference from `LiveShowcaseScreen`, and it is a feature: a snapshot is
 * what you show someone when you mean "this is where I was", not "this is
 * where I am".
 *
 * `decodeShowcase` never throws. A payload mangled by a chat client that ate a
 * character yields the printings it could still read, because a showcase of
 * three cards is worth looking at and a blank page is not.
 */
export function ShowcaseScreen({
  setId,
  setName,
  payload,
}: {
  setId: string;
  setName: string;
  payload: string;
}) {
  const showcase = useMemo(() => decodeShowcase(setId, payload), [setId, payload]);
  return <SetShowcase setId={setId} setName={setName} owned={showcase.owned} />;
}
