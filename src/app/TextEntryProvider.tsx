import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { TextInputProvider, TextInputRequest } from "../models/text-input.ts";
import {
  BrowserPromptTextInputProvider,
  CompanionPhoneTextInputProvider,
  OnScreenKeyboardTextInputProvider,
  isBrowserTextInputLikely,
  type PromptFn,
} from "../services/text-input/providers.ts";
import { CompanionClient } from "../services/companion/client.ts";
import { useIsWeb } from "./contexts.tsx";
import { TextPromptModal } from "../components/TextPromptModal.tsx";
import { CompanionModal } from "../components/CompanionModal.tsx";
import { LetterPickerModal } from "../components/LetterPickerModal.tsx";

interface Pending {
  kind: "prompt" | "companion" | "picker";
  request: TextInputRequest;
  resolve: (value: string | null) => void;
}

interface TextEntryValue {
  /** Primary text provider (browser modal on desktop; on-glasses picker on glasses). */
  provider: TextInputProvider;
  /** Explicit companion provider for the "Use phone" action. */
  companionProvider: TextInputProvider;
  requestText: PromptFn;
  requestCompanion: PromptFn;
  requestPicker: PromptFn;
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
  const requestPicker = useCallback<PromptFn>((req) => open("picker", req), [open]);

  /** Switch the active modal (e.g. picker -> companion) keeping the same pending promise. */
  const switchKind = useCallback((kind: Pending["kind"]) => {
    setPending((p) => (p ? { ...p, kind } : p));
  }, []);

  const isWeb = useIsWeb();
  const companionSupported = useMemo(() => new CompanionClient().configured, []);
  const browserSupported = useMemo(() => {
    // ?input=glasses forces the on-screen picker (demo/test on desktop);
    // ?input=keyboard forces the browser prompt.
    const forced = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("input");
    if (forced === "glasses") return false;
    if (forced === "keyboard") return true;
    /**
     * The shell already knows. Web means a phone or a browser window, and both
     * have a keyboard — a phone's is on the screen, but it is a real keyboard.
     *
     * The pointer heuristic below cannot answer this: a touchscreen reports
     * `pointer: coarse`, not `fine`, so it sent every phone to the glasses
     * letter picker — a D-pad speller built for a device with no keyboard at
     * all, on a device holding one. layoutMode's glasses-vs-phone decision is
     * made on shape and is the signal everything else in the app already trusts.
     */
    if (isWeb) return true;
    return isBrowserTextInputLikely();
  }, [isWeb]);

  const value = useMemo<TextEntryValue>(() => {
    // Desktop/mobile with a keyboard -> browser prompt; glasses -> on-screen picker.
    const provider: TextInputProvider = browserSupported
      ? new BrowserPromptTextInputProvider(requestText)
      : new OnScreenKeyboardTextInputProvider(requestPicker);
    const companionProvider = new CompanionPhoneTextInputProvider(requestCompanion, () => companionSupported);
    return {
      provider,
      companionProvider,
      requestText,
      requestCompanion,
      requestPicker,
      browserSupported,
      companionSupported,
      modalOpen: pending !== null,
    };
  }, [browserSupported, companionSupported, requestText, requestCompanion, requestPicker, pending]);

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
      {pending?.kind === "picker" ? (
        <LetterPickerModal
          request={pending.request}
          onSubmit={(v) => settle(v)}
          onCancel={() => settle(null)}
          {...(companionSupported ? { onUsePhone: () => switchKind("companion") } : {})}
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
