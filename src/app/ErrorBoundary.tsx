import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./ErrorBoundary.module.css";

/**
 * Catch a render error and say what it was.
 *
 * Without one of these, React unmounts the entire tree when any component
 * throws — the app becomes a blank white page with nothing in the console once
 * it is reloaded, and the only report available is "it crashed". That is
 * exactly what happened, and it is unreproducible by design: the information
 * needed to fix it is destroyed at the moment it appears.
 *
 * So this shows the error, keeps it copyable, and leaves a way out that is not
 * "close the app". It also persists the last crash, because the first thing
 * anyone does with a broken screen is reload it.
 *
 * Shared with the glasses deliberately. They have no console, no URL bar and no
 * developer tools, so a crash there is even more invisible than on a phone.
 */

const LAST_CRASH_KEY = "cardlens:v1:last-crash";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    const stack = info.componentStack ?? "";
    this.setState({ stack });
    // Console first: on a desktop this is the fastest route to a fix, and it
    // costs nothing when nobody is looking.
    console.error("[cardlens] render error", error, stack);
    try {
      localStorage.setItem(
        LAST_CRASH_KEY,
        JSON.stringify({
          at: new Date().toISOString(),
          message: error.message,
          stack: error.stack?.slice(0, 2000) ?? "",
          componentStack: stack.slice(0, 2000),
          url: window.location.href,
          userAgent: navigator.userAgent,
        }),
      );
    } catch {
      // A crash report that cannot be saved must not itself crash.
    }
  }

  private details(): string {
    const { error, stack } = this.state;
    return [
      `message: ${error?.message ?? "unknown"}`,
      `url: ${window.location.href}`,
      `agent: ${navigator.userAgent}`,
      "",
      error?.stack ?? "",
      "",
      stack,
    ].join("\n");
  }

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className={styles.wrap} role="alert">
        <h1 className={styles.title}>Something broke</h1>
        <p className={styles.message}>{this.state.error.message || "Unknown error"}</p>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              // Home, not just reload: whatever screen threw will throw again.
              window.location.hash = "#/";
              window.location.reload();
            }}
          >
            Go home
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void navigator.clipboard?.writeText(this.details())}
          >
            Copy details
          </button>
        </div>

        {/* Shown, not hidden behind the copy button: on a phone with no console
            this text is the entire bug report. */}
        <pre className={styles.stack}>{this.details()}</pre>
      </div>
    );
  }
}

/** The last crash this device saw, for a diagnostics view or a bug report. */
export function lastCrash(): unknown {
  try {
    const raw = localStorage.getItem(LAST_CRASH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
