/**
 * Text-entry abstraction. On the glasses there is no keyboard (officially
 * unsupported), so the provider reports `isSupported() === false` and the UI
 * falls back to recents / favorites / popular / browse / companion phone.
 */
export interface TextInputRequest {
  title: string;
  placeholder: string;
  initialValue?: string;
}

export interface TextInputProvider {
  /** Human-readable id for diagnostics/dev panel. */
  readonly id: "unsupported" | "browser-prompt" | "companion-phone";
  isSupported(): boolean;
  /** Resolves with the entered string, or null if cancelled/unavailable. */
  requestInput(options: TextInputRequest): Promise<string | null>;
}
