import styles from "./MenuRow.module.css";

export function MenuRow({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
}
