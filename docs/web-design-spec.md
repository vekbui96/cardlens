# Web design spec — phone and desktop

The visual contract for the **web shell only**. The Meta Ray-Ban Display shell is out of scope and must not change; see [Isolation contract](#isolation-contract).

Status: **spec.** Nothing here is built. Numbers quoted were measured; estimates say so.

---

## 1. The brief, grounded

**Subject:** a master-set collection tracker. One person works through a set in collector-number order, marking which _printings_ of each card they hold, and watching what the pile is worth.

**Audience:** one collector, who already knows the domain. Nothing needs explaining; things need finding.

**The page's job:** answer "what am I missing" faster than flipping the binder would.

**The material to design from** is the hobby's own: nine-pocket binder pages, catalogue numbers, foil patterns, the ritual of filling a page. Not "dark analytics dashboard".

### What this deliberately is not

Current AI-generated design clusters around three looks, and the web shell shipped on 2026-08-01 is squarely the second: near-black ground, one bright accent, hairline borders. It is competent and it is a default. The other two — cream + high-contrast serif + terracotta, and broadsheet rules with zero radius — are equally off the table.

Where this spec spends its freedom is stated in [§5 Signature](#5-signature-the-binder-page). Everything else stays quiet.

---

## 2. Direction

**Quiet ground, loud cards.** Pokémon card art is the most colourful thing that will ever be on this screen, nine at a time. The interface's job is to not compete. Every chrome decision below is subordinate to that.

**The ground is the card back.** Not neutral black — a deep blue-black derived from the material collectors actually look at all day. It gives the art a cooler surround than pure black and gives elevation somewhere to sit.

**Numbers are the second subject.** Collector numbers, ratios, prices. They are catalogue data and they must align in a column. That decision drives the type system more than the headings do.

---

## 3. Tokens

Scoped to `[data-shell="web"]`. Names extend the existing `--cl-*` namespace.

### Colour

| Token                 | Value                    | Role                                             |
| --------------------- | ------------------------ | ------------------------------------------------ |
| `--cl-bg`             | `#080B13`                | Ground. Deep blue-black, card-back derived       |
| `--cl-surface`        | `#111726`                | Panels, sheet, filter bar                        |
| `--cl-surface-raised` | `#1A2133`                | Rows, chips, inputs                              |
| `--cl-line`           | `rgba(255,255,255,0.07)` | Hairlines                                        |
| `--cl-fg`             | `#E9EDF7`                | Primary text, very slightly cool                 |
| `--cl-fg-muted`       | `#8A94AD`                | Secondary                                        |
| `--cl-fg-dim`         | `#5C667D`                | Catalogue numbers, captions                      |
| `--cl-accent`         | `#5B8CFF`                | Interactive: selected chip, focus, held printing |
| `--cl-gold`           | `#F2B544`                | **Reserved.** Completion and money, nothing else |
| `--cl-error`          | `#FF7A7A`                | Failure only                                     |

**Two accents, two meanings, no overlap.** Blue means _you can act on this_. Gold means _this is finished, or this is worth something_ — which in this hobby is one idea, not two. Anything that is neither stays greyscale.

Blue and gold sit on the blue–yellow axis, which is preserved under the common red–green deficiencies, so the two never rely on hue alone to be told apart. State is still always paired with a glyph or label regardless.

### Type

Three roles. The split exists because catalogue numbers must align and headings must not look like the glasses' shouty caps.

| Role    | Face                                     | Use                                       |
| ------- | ---------------------------------------- | ----------------------------------------- |
| Display | **Bricolage Grotesque** (variable)       | Set names, the value figure, page markers |
| Body    | System UI stack                          | Everything readable                       |
| Data    | **Geist Mono** (or system mono fallback) | Collector numbers, ratios, prices         |

Mono for collector numbers is not a stylistic tic — they are identifiers of ragged width (`101a`, `TG01`, `SV001`) that need to line up down a column, exactly as they do in a binder index.

**Scale** (web only; the glasses keep theirs):

| Token             | Size                | Weight               |
| ----------------- | ------------------- | -------------------- |
| `--cl-fs-display` | 30px / 36px desktop | 600, tight `-0.03em` |
| `--cl-fs-title`   | 20px                | 600, `-0.02em`       |
| `--cl-fs-body`    | 15px                | 400                  |
| `--cl-fs-small`   | 13px                | 500                  |
| `--cl-fs-data`    | 13px                | 500, `tabular-nums`  |

Sentence case throughout. No uppercase headings anywhere on web.

**Cost, stated honestly.** Two self-hosted variable subsets are an estimated 30–45 KB woff2 combined — not measured. Against a shipped entry of 129.6 KB JS + 174.5 KB vendor + 15.3 KB CSS, that is real. Load them `font-display: swap`, subset to Latin, and preload only the display face. **If that cost is rejected, the fallback is the system stack plus `ui-monospace` for data** — the layout below does not depend on the faces.

### Space, radius, motion

- Spacing: 4 / 8 / 12 / 20 / 32
- Radius: 10px controls, 14px panels, 6px card art
- Motion: 140ms `cubic-bezier(.4,0,.2,1)`; one 420ms gold sweep on page completion; everything suppressed under `prefers-reduced-motion`

---

## 4. Layout

### Phone (390–768px)

Three columns, because a binder page is three across.

```
┌───────────────────────────────────────┐
│ ‹ Back   Pitch Black          47/219  │  app bar, ratio in mono
├───────────────────────────────────────┤
│ ●All   IR   SIR   Full Art   Hyper →  │  rarity, scrolls
│               [ Missing ]  [ Value ]  │  toggles, own row
├───────────────────────────────────────┤
│  PAGE 1                001–009   3/9  │  ← page marker
│   ┌─────┐  ┌─────┐  ┌─────┐           │
│   │ art │  │ art │  │ art │           │
│   └─────┘  └─────┘  └─────┘           │
│    001      002      003              │
│   ┌─────┐  ┌─────┐  ┌─────┐           │
│   │ art │  │ art │  │ art │           │
│   └─────┘  └─────┘  └─────┘           │
│    004      005      006              │
│           … 007–009 …                 │
├───────────────────────────────────────┤
│  PAGE 2  ✦ complete    010–018   9/9  │  ← gold
```

### Desktop (≥1000px)

Nine columns. One binder page per row — the structure becomes literal at width, which is where it pays off most.

```
┌─────────────────────────────────────────────────────────────────┐
│ ‹ Back   Pitch Black                                   47/219   │
├─────────────────────────────────────────────────────────────────┤
│ ●All  IR  SIR  Full Art  Hyper        [ Missing ]  [ By value ] │
├─────────────────────────────────────────────────────────────────┤
│ PAGE 1   001–009                                          3/9   │
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐                            │
│ └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘                            │
│ PAGE 2 ✦ complete   010–018                               9/9   │
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐                            │
│ └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘                            │
└─────────────────────────────────────────────────────────────────┘
```

Card sheet stays a right-hand side panel at ≥1000px and a bottom sheet below — already shipped, keep.

---

## 5. Signature: the binder page

**The grid is divided into nine-card pages, numbered, with the collector-number range and a held count. When all nine are held the marker turns gold.**

This is the one place boldness is spent. Everything else stays quiet.

Why it earns its place rather than decorating:

- **It is true.** Measured: Pitch Black is 13 pages + 3, Perfect Order 13 + 7, Phantasmal Flames 14 + 4. The collection physically lives in nine-pocket pages.
- **It is useful.** CLAUDE.md already notes the collector number is "how you find your place in a binder". A page marker is that, made structural.
- **It rewards the actual goal.** Master-setting is filling pages. The gold marker is the smallest possible acknowledgement of the thing the user is really doing.

**Numbering is legitimate here** specifically because the content _is_ an ordered sequence and the order carries information the reader needs. That is the only condition under which numbered markers belong.

### The constraint, stated up front

Page markers are only meaningful when the list is in unbroken collector-number order. **Suppress them entirely** when a rarity filter, "missing only", or "by value" is active — a "Page 3" over a filtered subset is a lie. In those modes the grid is a plain responsive grid with no dividers.

This is a real limitation, not a detail to discover during implementation.

---

## 6. Components

**Card tile.** Art at 5:7, 6px radius, 1px inset hairline so busy art does not bleed into the ground. Held cards full opacity; missing at 0.4 — dimmed, never hidden, because a grid with holes cannot be scanned. Complete cards get a 2px gold inset ring. Number bottom-left in mono `--cl-fg-dim`; held ratio bottom-right, gold when complete. Hover (pointer only): lift 2px, opacity to 1.

**Page marker.** Full-row. Display face, 13px, letterspaced `0.08em`, `--cl-fg-muted`. Range and count in mono. Complete: text and rule go `--cl-gold`, prefixed `✦`, with a single left-to-right sweep on the transition into complete — the only celebratory motion in the app.

**Filter bar.** Sticky, translucent + blurred. Rarity chips scroll on their own row; the two toggles sit below on phone, inline at desktop. Selected chip is solid `--cl-accent`. 44px minimum height — a hit-target floor, not a visual choice.

**Card sheet.** Art + name + number/rarity + headline price. One row per printing, 56px minimum, checkbox left, label, price right in mono. Held rows get a 12%-accent fill, not just a border — down a column of twelve the block of colour is what reads. `Done` pinned outside the scroll region. Hand-marked printings the set data does not list keep a dashed border and stay removable.

**Value panel.** Display-face figure in `--cl-gold`. Movement percentage beside it with sign and label. Per-set rows: name, priced ratio in mono, value in gold. Unpriced count stated plainly, never hidden.

---

## 7. Copy

Plain, active, consistent. The vocabulary is the signposting.

| Instead of                             | Write                                                        |
| -------------------------------------- | ------------------------------------------------------------ |
| "No cards found" (empty set, filtered) | "Nothing missing here" / "No Illustration Rares in this set" |
| "Error loading data"                   | "Couldn't load this set" + `Try again`                       |
| "Submit"                               | The verb that happens: `Done`, `Try again`                   |
| "0 printings priced"                   | "No prices for this set yet"                                 |

An action keeps its name across the flow. Empty states say what to do next; errors say what happened and how to fix it, without apologising.

---

## 8. Isolation contract

**The display version does not change.** Enforced structurally, already in place:

- `src/styles/tokens.css` is the glasses' palette and scale and is **not edited by this spec**.
- Everything here lands in `src/styles/web-theme.css` under `[data-shell="web"]`, or in `src/web/**`.
- `GlassesFrame` stamps `data-shell` as `web` / `glasses` / `preview`; the cascade cannot reach the other two.
- `e2e/shell-isolation.spec.ts` asserts the glasses keep `#000000` and the 22px scale, and that no web-only token resolves there. **Extend it with the new tokens (`--cl-gold`, `--cl-fs-display`, `--cl-line`) before shipping any of this.**

Why they cannot share: the Meta display is additive. Black is transparent, so an elevated surface glows as a grey rectangle in the wearer's vision; shadows and blur do not render; the type scale is sized for glance distance, hands-free. Opposite requirements, not a skin.

---

## 9. Quality floor

Responsive to 360px with no horizontal overflow · visible keyboard focus on every control · `prefers-reduced-motion` respected · 44px minimum touch targets · state never carried by colour alone · art `loading="lazy"` with width/height hints to stop layout shift.

---

## 10. Decisions this spec is asking for

1. **Webfonts, or system stack?** Estimated 30–45 KB. The layout works either way.
2. **Gold for completion** — or keep a single accent and express completion with weight and glyph only?
3. **Nine-column desktop** locks card art fairly small at 1440px (≈120px). One binder page per row is the point; the alternative is a free-flowing grid that abandons the signature at desktop.
4. Page markers are suppressed under any filter (§5). Acceptable, or should filtered views get a different structure?
