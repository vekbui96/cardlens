import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { TextInputProvider, TextInputRequest } from "../models/text-input.ts";
import {
  BrowserPromptTextInputProvider,
  CompanionPhoneTextInputProvider,
  UnsupportedTextInputProvider,
  isBrowserTextInputLikely,
  type PromptFn,
} from "../services/text-input/providers.ts";
import { CompanionClient } from "../services/companion/client.ts";
import { TextPromptModal } from "../components/TextPromptModal.tsx";
import { CompanionModal } from "../components/CompanionModal.tsx";

interface Pending {
  kind: "prompt" | "companion";
  request: TextInputRequest;
  resolve: (value: string | null) => void;
}

interface TextEntryValue {
  /** Primary text provider (browser modal on desktop/mobile, unsupported on glasses). */
  provider: TextInputProvider;
  /** Explicit companion provider for the "Use phone" action. */
  companionProvider: TextInputProvider;
  requestText: PromptFn;
  requestCompanion: PromptFn;
  browserSupported: boolean;
  companionSupported: boolean;
  modalOpen: boolean;
}

const TextEntryContext = createContext<TextEntryValue | null>(null);

export function TextEntryProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const open = useCallback((kind: Pending["kind"], request: TextInputRequest): Promise<string | null> => {
    // Resolve any prior pending request as cancelled.
    pendingRef.current?.resolve(null);
    return new Promise<string | null>((resolve) => {
      setPending({ kind, request, resolve });
    });
  }, []);

  const settle = useCallback((value: string | null) => {
    const current = pendingRef.current;
    setPending(null);
    current?.resolve(value);
  }, []);

  const requestText = useCallback<PromptFn>((req) => open("prompt", req), [open]);
  const requestCompanion = useCallback<PromptFn>((req) => open("companion", req), [open]);

  const companionSupported = useMemo(() => new CompanionClient().configured, []);
  const browserSupported = useMemo(() => isBrowserTextInputLikely(), []);

  const value = useMemo<TextEntryValue>(() => {
    const provider: TextInputProvider = browserSupported
      ? new BrowserPromptTextInputProvider(requestText)
      : new UnsupportedTextInputProvider();
    const companionProvider = new CompanionPhoneTextInputProvider(requestCompanion, () => companionSupported);
    return {
      provider,
      companionProvider,
      requestText,
      requestCompanion,
      browserSupported,
      companionSupported,
      modalOpen: pending !== null,
    };
  }, [browserSupported, companionSupported, requestText, requestCompanion, pending]);

  return (
    <TextEntryContext.Provider value={value}>
      {children}
      {pending?.kind === "prompt" ? (
        <TextPromptModal
          request={pending.request}
          onSubmit={(v) => settle(v)}
          onCancel={() => settle(null)}
        />
      ) : null}
      {pending?.kind === "companion" ? (
        <CompanionModal request={pending.request} onSubmit={(v) => settle(v)} onCancel={() => settle(null)} />
      ) : null}
    </TextEntryContext.Provider>
  );
}

export function useTextEntry(): TextEntryValue {
  const ctx = useContext(TextEntryContext);
  if (!ctx) throw new Error("useTextEntry must be used within TextEntryProvider");
  return ctx;
}

/** Screens disable their focus input while a text modal is open. */
export function useScreenInputEnabled(): boolean {
  return !useContext(TextEntryContext)?.modalOpen;
}
