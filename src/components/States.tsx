import styles from "./States.module.css";

export function LoadingState({ label = "Finding cards…" }: { label?: string }) {
  return (
    <div className={styles.center} role="status" aria-live="polite">
      <div className={styles.spinner} aria-hidden="true" />
      <p className={styles.big}>{label}</p>
    </div>
  );
}

export function ErrorState({
  message = "Couldn’t load prices",
  onRetry,
  retryFocused = true,
}: {
  message?: string;
  onRetry?: () => void;
  retryFocused?: boolean;
}) {
  return (
    <div className={styles.center} role="alert">
      <p className={styles.big}>{message}</p>
      {onRetry ? (
        <button
          type="button"
          className={`${styles.action} ${retryFocused ? styles.actionFocused : ""}`}
          aria-selected={retryFocused}
          onClick={onRetry}
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title = "No cards found",
  hint = "Check the spelling or search by Pokémon",
}: {
  title?: string;
  hint?: string;
}) {
  return (
    <div className={styles.center} role="status">
      <p className={styles.big}>{title}</p>
      <p className={styles.hint}>{hint}</p>
    </div>
  );
}
