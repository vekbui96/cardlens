import { useState } from "react";
import {
  Card,
  CardArt,
  Chip,
  Grid,
  Meter,
  Money,
  Panel,
  RailHost,
  Row,
  Sheet,
  Stack,
} from "../primitives/index.ts";
import { FIXTURES, seedingAllowed } from "../../dev/fixtures.ts";
import styles from "./Workshop.module.css";

/**
 * Every primitive, in every state it has.
 *
 * This is the foundation's own proof. Phase 0 builds no screens, so without a
 * page like this the primitives would go unexercised until nine streams found
 * their edges independently — and the first three would each work around the
 * same bug in a different way.
 *
 * It renders inside the real shell, on the real tokens, against the real
 * fixtures. A gallery mounted outside the app is a gallery that eventually
 * disagrees with the app.
 */
export function Workshop() {
  return (
    <Stack gap={6}>
      <header>
        <h1 className={styles.h1}>Workshop</h1>
        <p>
          The v2 vocabulary. Everything a screen may use, and nothing it may not. Adding a primitive means
          adding it here, in every state, in the same commit.
        </p>
      </header>

      <Fixtures />
      <Palette />
      <TypeScale />
      <Layout />
      <Surfaces />
      <Art />
      <Data />
      <Disclosure />
    </Stack>
  );
}

/* --- Fixtures ------------------------------------------------------------- */

function Fixtures() {
  const allowed = seedingAllowed();
  return (
    <Panel title="Fixtures" tone="raised">
      <Stack gap={3}>
        <p>
          Named starting states, written through the real repositories. Loading one replaces what is in
          storage and reloads the page.
        </p>
        {allowed ? (
          <Row gap={2} wrap>
            {Object.keys(FIXTURES).map((name) => (
              <Chip
                key={name}
                onPress={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.set("seed", name);
                  window.location.assign(url.toString());
                }}
              >
                {name}
              </Chip>
            ))}
          </Row>
        ) : (
          <p>Seeding is off in this build — it only runs in dev and under e2e.</p>
        )}
      </Stack>
    </Panel>
  );
}

/* --- Tokens --------------------------------------------------------------- */

const SURFACES = ["bg", "surface", "surface-raised", "surface-sunken", "border", "border-strong"];
const INK = ["fg", "fg-muted", "fg-dim", "accent", "accent-strong", "price", "warn", "error", "gold"];

function Palette() {
  return (
    <Panel title="Colour">
      <Stack gap={4}>
        <Swatches label="Surfaces" names={SURFACES} />
        <Swatches label="Ink and semantics" names={INK} />
        <p>
          Semantic colour is never the only carrier of meaning. Gold means complete, and the label beside it
          says &ldquo;complete&rdquo; too — green against gold is exactly the pair deuteranopia collapses.
        </p>
      </Stack>
    </Panel>
  );
}

function Swatches({ label, names }: { label: string; names: string[] }) {
  return (
    <Stack gap={2}>
      <h3 className={styles.h3}>{label}</h3>
      <Row gap={2} wrap>
        {names.map((n) => (
          <div key={n} className={styles.swatch}>
            <span className={styles.swatchChip} style={{ background: `var(--v2-${n})` }} />
            <code className={styles.swatchName}>--v2-{n}</code>
          </div>
        ))}
      </Row>
    </Stack>
  );
}

const TYPE = ["display", "title", "heading", "body", "small", "tiny"];

function TypeScale() {
  return (
    <Panel title="Type">
      <Stack gap={2}>
        {TYPE.map((t) => (
          <div key={t} style={{ fontSize: `var(--v2-fs-${t})` }}>
            {t} — Jolteon VMAX 023/203
          </div>
        ))}
      </Stack>
    </Panel>
  );
}

/* --- Layout --------------------------------------------------------------- */

function Layout() {
  return (
    <Panel title="Stack · Row · Grid">
      <Stack gap={4}>
        <Stack gap={2}>
          <h3 className={styles.h3}>Row, wrapping, gap 2</h3>
          <Row gap={2} wrap>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <Box key={n}>{n}</Box>
            ))}
          </Row>
        </Stack>

        <Stack gap={2}>
          <h3 className={styles.h3}>Row, grow — equal shares</h3>
          <Row gap={2} grow>
            <Box>one</Box>
            <Box>two</Box>
            <Box>three</Box>
          </Row>
        </Stack>

        <Stack gap={2}>
          <h3 className={styles.h3}>Grid, min=pocket</h3>
          <p>
            <code>auto-fill</code>, so a grid holding one item leaves the other tracks empty rather than
            stretching that item across the window.
          </p>
          <Grid min="pocket" gap={3}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Box key={n}>{n}</Box>
            ))}
          </Grid>
        </Stack>
      </Stack>
    </Panel>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className={styles.box}>{children}</div>;
}

/* --- Surfaces ------------------------------------------------------------- */

function Surfaces() {
  const [selected, setSelected] = useState(false);
  return (
    <Panel title="Panel · Card">
      <Stack gap={4}>
        <Row gap={3} wrap>
          <Panel title="Default" headingLevel={3}>
            A bounded region.
          </Panel>
          <Panel title="Raised" headingLevel={3} tone="raised">
            Lifted, with a shadow.
          </Panel>
          <Panel title="Quiet" headingLevel={3} tone="quiet">
            No border, no padding — grouping only.
          </Panel>
        </Row>

        <Stack gap={2}>
          <h3 className={styles.h3}>Card</h3>
          <p>
            A Card with no <code>onPress</code> and no <code>href</code> renders inert — no pointer, no hover,
            nothing that suggests a press it does not perform.
          </p>
          <Row gap={3} wrap>
            <Card onPress={() => setSelected((s) => !s)} selected={selected}>
              Pressable {selected ? "(selected)" : ""}
            </Card>
            <Card href="#/dev/workshop">A link</Card>
            <Card>Inert</Card>
          </Row>
        </Stack>
      </Stack>
    </Panel>
  );
}

/* --- CardArt -------------------------------------------------------------- */

const SAMPLE = "https://images.pokemontcg.io/base2/4.png";

function Art() {
  return (
    <Panel title="CardArt">
      <Stack gap={4}>
        <p>
          One component, sized entirely by its container. There is no width prop — the same element below is
          drawn at three sizes by changing only the box around it.
        </p>
        <Row gap={4} align="start" wrap>
          {(["tile", "pocket", "hero"] as const).map((detail) => (
            <Stack key={detail} gap={2}>
              <code className={styles.swatchName}>{detail}</code>
              <div className={styles[detail]}>
                <CardArt src={SAMPLE} name="Jolteon" detail={detail} />
              </div>
            </Stack>
          ))}
        </Row>

        <Stack gap={2}>
          <h3 className={styles.h3}>States</h3>
          <Row gap={4} align="start" wrap>
            <Labelled label="With art">
              <CardArt src={SAMPLE} name="Jolteon" detail="pocket" />
            </Labelled>
            <Labelled label="No art — face down">
              <CardArt name="Jolteon VMAX" detail="pocket" />
            </Labelled>
            <Labelled label="Empty pocket">
              <CardArt name="" empty />
            </Labelled>
            <Labelled label="Decorative (aria-hidden)">
              <CardArt src={SAMPLE} name="Jolteon" detail="pocket" decorative />
            </Labelled>
          </Row>
        </Stack>
      </Stack>
    </Panel>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap={2}>
      <code className={styles.swatchName}>{label}</code>
      <div className={styles.pocket}>{children}</div>
    </Stack>
  );
}

/* --- Data ----------------------------------------------------------------- */

function Data() {
  const [pressed, setPressed] = useState(false);
  return (
    <Panel title="Meter · Chip · Money">
      <Stack gap={4}>
        <Stack gap={3}>
          <h3 className={styles.h3}>Meter</h3>
          <Meter value={0} label="Base set" detail="0 / 102" />
          <Meter value={0.42} label="Base set" detail="43 / 102" />
          <Meter value={1} label="Base set" detail="102 / 102 · complete" />
          <Meter value={Number.NaN} label="An empty set" detail="0 / 0" />
          <Meter value={0.6} label="No text row" labelHidden />
        </Stack>

        <Stack gap={2}>
          <h3 className={styles.h3}>Chip</h3>
          <Row gap={2} wrap>
            <Chip>9-pocket</Chip>
            <Chip tone="accent">For trade</Chip>
            <Chip tone="warn">3 unpriced</Chip>
            <Chip tone="gold">Complete</Chip>
            <Chip onPress={() => setPressed((p) => !p)} pressed={pressed}>
              Toggles
            </Chip>
          </Row>
        </Stack>

        <Stack gap={2}>
          <h3 className={styles.h3}>Money</h3>
          <p>
            The absent cases are the point. An unpriced card and a free card are not the same card, so nothing
            here ever renders <code>$0.00</code>.
          </p>
          <Row gap={4} wrap>
            <Labelled2 label="Has a price">
              <Money value={412.5} />
            </Labelled2>
            <Labelled2 label="undefined">
              <Money value={undefined} />
            </Labelled2>
            <Labelled2 label="Zero">
              <Money value={0} />
            </Labelled2>
            <Labelled2 label="Loading">
              <Money value={undefined} loading />
            </Labelled2>
            <Labelled2 label="Custom absent">
              <Money value={undefined} absentLabel="Not for sale" />
            </Labelled2>
          </Row>
        </Stack>
      </Stack>
    </Panel>
  );
}

function Labelled2({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap={1}>
      <code className={styles.swatchName}>{label}</code>
      {children}
    </Stack>
  );
}

/* --- Disclosure ----------------------------------------------------------- */

function Disclosure() {
  const [railOpen, setRailOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <Panel title="Rail · Sheet">
      <Stack gap={4}>
        <p>
          A shut rail takes <strong>zero</strong> width. Toggle it and watch the grid below keep its column
          size — while a shut rail still held track, a 12-pocket binder page rendered its pockets at 92px
          against a 9-pocket page&rsquo;s 125px.
        </p>
        <Row gap={2}>
          <Chip onPress={() => setRailOpen((o) => !o)} pressed={railOpen}>
            {railOpen ? "Close rail" : "Open rail"}
          </Chip>
          <Chip onPress={() => setSheetOpen(true)}>Open sheet</Chip>
        </Row>

        <RailHost open={railOpen} label="Workshop rail" rail={<RailBody />}>
          <Grid min="pocket" gap={3}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <CardArt key={n} src={SAMPLE} name="Jolteon" detail="tile" decorative />
            ))}
          </Grid>
        </RailHost>

        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} label="Workshop sheet">
          <Stack gap={3}>
            <h3 className={styles.h3}>A sheet</h3>
            <p>
              Escape closes it, focus is trapped inside while it is open, and closing returns focus to
              whatever opened it.
            </p>
            <Chip onPress={() => setSheetOpen(false)}>Close</Chip>
          </Stack>
        </Sheet>
      </Stack>
    </Panel>
  );
}

function RailBody() {
  return (
    <Stack gap={3}>
      <h3 className={styles.h3}>Rail</h3>
      <p>The same content a phone would show in a Sheet.</p>
      <Row gap={2} wrap>
        <Chip>Filter</Chip>
        <Chip>Sort</Chip>
      </Row>
    </Stack>
  );
}
