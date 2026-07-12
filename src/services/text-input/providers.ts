import type { TextInputProvider, TextInputRequest } from "../../models/text-input.ts";

export type PromptFn = (req: TextInputRequest) => Promise<string | null>;

/**
 * On the glasses there is NO keyboard (officially unsupported). This provider
 * reports unsupported so the UI relies on recents/favorites/popular/browse and
 * the companion phone.
 */
export class UnsupportedTextInputProvider implements TextInputProvider {
  readonly id = "unsupported" as const;
  isSupported(): boolean {
    return false;
  }
  async requestInput(): Promise<string | null> {
    return null;
  }
}

/**
 * Desktop / mobile browser input. Delegates to an in-app modal (injected) rather
 * than window.prompt, so it fits the focus model and is Playwright-drivable.
 */
export class BrowserPromptTextInputProvider implements TextInputProvider {
  readonly id = "browser-prompt" as const;
  constructor(private readonly promptFn: PromptFn) {}
  isSupported(): boolean {
    return true;
  }
  requestInput(options: TextInputRequest): Promise<string | null> {
    return this.promptFn(options);
  }
}

/**
 * Companion-phone bridge. Delegates to an injected flow that shows a session code
 * / QR and resolves when the phone submits text through the relay server.
 */
export class CompanionPhoneTextInputProvider implements TextInputProvider {
  readonly id = "companion-phone" as const;
  constructor(
    private readonly companionFn: PromptFn,
    private readonly available: () => boolean,
  ) {}
  isSupported(): boolean {
    return this.available();
  }
  requestInput(options: TextInputRequest): Promise<string | null> {
    return this.companionFn(options);
  }
}

/**
 * Heuristic: a physical/virtual keyboard is usable when the browser exposes a
 * fine or coarse pointer with typical input. We cannot reliably detect the
 * glasses, so we treat text input as available in normal browsers and ALWAYS also
 * surface no-typing paths + companion in the UI.
 */
export function isBrowserTextInputLikely(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(pointer: fine)").matches || window.matchMedia("(any-pointer: fine)").matches;
}
