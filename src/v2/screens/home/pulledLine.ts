/**
 * The confirmation Home shows once a "Connect this device" has brought rows in.
 * A pure function of the count, taken from the collection size, so no sync code
 * is involved. Zero gets its own honest wording rather than "Pulled 0 cards".
 */
export function pulledLine(count: number): string {
  if (count <= 0) return "Connected, but nothing has arrived from your other device yet.";
  return count === 1
    ? "Pulled 1 card from your other device."
    : `Pulled ${count.toLocaleString()} cards from your other device.`;
}
