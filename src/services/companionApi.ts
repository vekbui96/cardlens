/**
 * Base URL of the companion server.
 *
 * Relative by default so the Vite dev proxy works; the deployed build sets it to
 * the server's absolute HTTPS origin, because the page is served from GitHub
 * Pages and the server sits behind a Tailscale Funnel.
 */
export function companionBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_COMPANION_API_BASE_URL ?? "/api").replace(/\/$/, "");
}
