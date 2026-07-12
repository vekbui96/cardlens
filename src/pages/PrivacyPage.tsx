import styles from "./CompanionPage.module.css";

/** Concise privacy page. Full policy is in docs/privacy.md. */
export function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.card} style={{ maxWidth: 560 }}>
        <h1 className={styles.title}>Privacy</h1>
        <p className={styles.hint}>
          CardLens stores your <strong>favorites</strong>, <strong>recent searches</strong>,{" "}
          <strong>recently viewed cards</strong>, and cached card/price data{" "}
          <strong>locally on your device</strong> only. This data never leaves your device and can be cleared
          anytime from your browser or the developer panel.
        </p>
        <p className={styles.hint}>
          CardLens uses <strong>no camera, microphone, or location</strong>, requires{" "}
          <strong>no account</strong>, and includes <strong>no analytics</strong>. Card data and prices are
          fetched from the public pokemontcg.io API (prices via TCGplayer). No personal identifiers are sent.
        </p>
        <p className={styles.hint}>
          The optional phone companion links your glasses and phone with a short-lived, one-time code and
          transmits only the search text you type. Sessions expire automatically and are not stored
          permanently.
        </p>
        <p className={styles.privacy}>
          CardLens is an independent project, not affiliated with Nintendo, The Pokémon Company, TCGplayer, or
          Meta.
        </p>
      </div>
    </main>
  );
}
