/**
 * The browser's `theme-color`, while v2 is on screen (#126).
 *
 * `index.html` says `#000000` because the glasses display is additive and black
 * is transparent there; that must stay the document's value. v2 is a lit dark
 * theme with a lifted header, so on a phone a black address bar or status bar
 * sits on top of a header that is not black. While the v2 shell is mounted the
 * meta follows the header's surface colour; leaving v2 (the version switch)
 * puts the previous value back.
 *
 * The colour is passed in rather than written here: it is `--v2-surface`, read
 * from the shell's computed style, so tokens.css stays the only place it lives.
 */
const SELECTOR = "meta[name=theme-color]";

export function followThemeColor(doc: Document, colour: string): () => void {
  const meta = doc.querySelector<HTMLMetaElement>(SELECTOR);
  const next = colour.trim();
  if (!meta || !next) return () => undefined;
  const previous = meta.content;
  meta.content = next;
  return () => {
    meta.content = previous;
  };
}
