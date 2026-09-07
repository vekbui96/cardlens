import type { Combobox } from "../hooks/useCombobox.ts";
import type { Suggestion } from "../models/cardNames.ts";

/**
 * The suggestion listbox, shared by both UI versions.
 *
 * Only the class names differ between v1 and v2, so those are a prop and the
 * markup is not written twice. What must not be duplicated is the ARIA: a
 * `listbox` of `option`s, each with `aria-selected`, and ids that match the
 * `aria-activedescendant` the input is pointing at. Two copies of that is two
 * chances to get it subtly wrong, and the person who notices is the one using
 * a screen reader.
 *
 * `onMouseDown` rather than `onClick`: a click blurs the input first, and the
 * blur would close the list out from under the pointer. Preventing the default
 * on mousedown keeps focus in the field, which is also where it should stay —
 * choosing a name is not finishing with the box.
 */
export function NameSuggestList({
  combobox,
  suggestions,
  classes,
}: {
  combobox: Combobox;
  suggestions: Suggestion[];
  classes: { list: string; option: string; optionActive: string; count?: string };
}) {
  return (
    <>
      {/*
        Announced without moving focus. A blind user typing gets told the list
        changed under them; a sighted one already sees it.
      */}
      <div aria-live="polite" role="status" className={classes.count ?? ""}>
        {combobox.open
          ? `${suggestions.length} ${suggestions.length === 1 ? "suggestion" : "suggestions"}`
          : ""}
      </div>

      {combobox.open ? (
        <ul className={classes.list} id={combobox.listId} role="listbox" aria-label="Card name suggestions">
          {suggestions.map((s, i) => (
            <li
              key={s.name}
              id={combobox.optionId(i)}
              role="option"
              aria-selected={i === combobox.highlighted}
              className={`${classes.option} ${i === combobox.highlighted ? classes.optionActive : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                combobox.choose(i);
              }}
            >
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
