import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./V2Shell.module.css";

interface Props {
  children: ReactNode;
  /**
   * Changing this resets the boundary. The router passes the current screen
   * key, so navigating away from a screen that threw actually leaves it —
   * without that, a single bad screen wedges the whole app until a reload.
   */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches a screen that throws, and renders the failure INSIDE the shell.
 *
 * That placement is the point. v1's boundary wraps the entire app, so a screen
 * that throws takes the header with it — including, once v2 ships, the version
 * switch. The most likely thing to break during a rebuild is a v2 screen, and
 * the thing a user most needs at that moment is the control that puts them back
 * on v1. So the boundary goes below the header, never above it.
 */
export class V2ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept: the stack is the only record of what happened on someone else's
    // device, and this is a rebuild where screens are expected to throw.
    console.error("[v2] screen threw", error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={styles.error} role="alert">
        <h1 className={styles.errorTitle}>This screen broke</h1>
        <p className={styles.errorDetail}>{error.message || String(error)}</p>
        <button type="button" className={styles.button} onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
