import { useCallback } from "react";
import { useLibrary } from "../app/LibraryProvider.tsx";
import { useTextEntry } from "../app/TextEntryProvider.tsx";

/**
 * Ask for the sync token and hand it to the library — the one "connect this
 * device" flow, shared by the Collection screen's sync row and Home's empty
 * state so a device connected from either looks the same.
 *
 * Cancelling (or an empty answer) does nothing. The token goes straight to
 * `setSyncToken`; it is never logged or kept here.
 */
export function useConnectDevice(): () => Promise<void> {
  const { setSyncToken } = useLibrary();
  const { provider: textProvider } = useTextEntry();
  return useCallback(async () => {
    const token = await textProvider.requestInput({
      title: "Sync token",
      placeholder: "paste from the server .env",
    });
    if (token) setSyncToken(token);
  }, [textProvider, setSyncToken]);
}
