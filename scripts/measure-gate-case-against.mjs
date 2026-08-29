/**
 * Is a blanket MIN_MARGIN of 10 the right instrument for two false accepts?
 *
 * `measure-gate-safety.mjs` established the facts: at MAX_DISTANCE 16 /
 * MIN_MARGIN 8 the shipped index leaks 2 false accepts in 121,230 trials, and
 * raising the margin to 10 takes that to 0 at a cost of 9.2 points of
 * auto-accept and 312 cards that no longer clear the gate on a PERFECT capture.
 *
 * This script asks the three questions that table cannot answer:
 *
 *  1. **How much of the "0" is measurement?** The six renders are deterministic
 *     transforms of the same PNG that built the index, so `clean` re-hashes bit
 *     for bit (the parity check proves it). Section DRIFT shows how far each
 *     render actually moves a query from its own entry, and section HEADROOM
 *     shows how many trials the whole zero rests on. Section NOISE then adds
 *     k random bit flips — a crude stand-in for the sensor noise, wear and focus
 *     a real camera contributes and a canvas transform does not — and asks how
 *     many bits of unmodelled degradation each margin survives.
 *
 *  2. **Is the margin doing targeted work?** Section COLLATERAL asks what the
 *     312 cards actually are: does each have a genuine reprint sitting 8-9 bits
 *     away, or an unrelated card it collided with by accident?
 *
 *  3. **Is there a better-targeted rule?** Section RULES evaluates candidates
 *     against the SAME battery and the same two axes, so every row is directly
 *     comparable with the sweep in `phash.ts`:
 *       - `margin(M)`            — the blanket rule, for reference
 *       - `crowd(M,T)`           — margin M, but only onto a card whose own
 *                                  nearest index neighbour is at least T away
 *       - `asym(K,lo,hi)`        — margin `lo` when the top hit is within K bits
 *                                  (a near-lossless capture), `hi` beyond it
 *
 * Nothing here re-renders or re-downloads: it reads the render cache
 * `measure-gate-safety.mjs fetch` already wrote. `fetch` mode is separate and
 * exists only for section CROP, which re-renders the geometric distortions at
 * parameters the shipped battery does not use.
 *
 *   node scripts/measure-gate-case-against.mjs            # analyse the cache
 *   node scripts/measure-gate-case-against.mjs fetch      # alternate crops/tilts
 *   node scripts/measure-gate-case-against.mjs crop       # report on those
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const OUT_DIR = "public/card-index";
/** Written by measure-gate-safety.mjs. Read only — never rewritten here. */
const GATE_DIR = "node_modules/.cache/gate-safety";
const ALT_DIR = "node_modules/.cache/hash-alternatives";
/** This script's own scratch, for the alternate renders only. */
const WORK_DIR = "node_modules/.cache/gate-case-against";

const HASH_BITS = 64;
/**
 * Hardcoded rather than imported from `src/scan/phash.ts`, on purpose: that file
 * is being edited in parallel and the whole point of this script is to compare
 * candidate values, not to inherit one.
 */
const MAX_DISTANCE = 16;
/** The gate as shipped before this session. */
const BASE_MARGIN = 8;
/** The proposed replacement. */
const CANDIDATE_MARGIN = 10;

const RENDERS = ["clean", "resampled", "cropError", "dim", "glare", "tilted", "everything"];
/** Geometric distortions at parameters the shipped battery does NOT use. */
const ALT_RENDERS = ["crop2", "crop4", "cropShift", "cropAsym", "tilt5"];

const argv = process.argv.slice(2);
const MODE = argv.find((a) => !a.startsWith("--")) ?? "analyse";
const RESUME = argv.includes("--resume");

function popcount(n) {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  n = (n + (n >>> 4)) & 0x0f0f0f0f;
  return (n * 0x01010101) >>> 24;
}

function readShippedIndex() {
  const latest = JSON.parse(readFileSync(`${OUT_DIR}/latest.json`, "utf8"));
  const cards = JSON.parse(readFileSync(`${OUT_DIR}/cards-${latest.version}.json`, "utf8"));
  const bin = readFileSync(`${OUT_DIR}/index-${latest.version}.bin`);
  const words = new Uint32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  return { latest, cards, words };
}

/** Identical to measure-gate-safety.mjs's, so the two scripts cannot disagree. */
function nearestTwo(index, n, q0, q1, skip) {
  let d1 = HASH_BITS + 1;
  let d2 = HASH_BITS + 1;
  let at = -1;
  for (let j = 0, jb = 0; j < n; j++, jb += 2) {
    if (j === skip) continue;
    let d = popcount(q0 ^ index[jb]);
    if (d < d2) {
      d += popcount(q1 ^ index[jb + 1]);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        at = j;
      } else if (d < d2) d2 = d;
    }
  }
  return { d1, d2, at };
}

function readRenderCache(latest, n) {
  const prog = JSON.parse(readFileSync(`${GATE_DIR}/progress.json`, "utf8"));
  if (prog.version !== latest.version) throw new Error(`cache is for index ${prog.version} — re-fetch`);
  if (prog.count !== n) throw new Error(`cache holds ${prog.count} of ${n} cards`);
  if (prog.renders.join(",") !== RENDERS.join(",")) throw new Error("cache render list does not match");
  if (prog.missing.reduce((a, b) => a + b, 0) !== 0) throw new Error("cache has cards without art");
  const rb = readFileSync(`${GATE_DIR}/renders.u32`);
  return new Uint32Array(rb.buffer, rb.byteOffset, n * RENDERS.length * 2);
}

/** Probe every distorted render of every card against the shipped index. */
function probeAll(index, R, n, renderNames, perCard, quiet) {
  const probes = renderNames.map((name, r) => ({ name, r })).filter((e) => e.name !== "clean");
  const d1s = new Int32Array(probes.length * n);
  const d2s = new Int32Array(d1s.length);
  const hitAt = new Int32Array(d1s.length);
  /** Distance from the query to its OWN index entry: how far the render moved it. */
  const drift = new Int32Array(d1s.length);
  for (let e = 0; e < probes.length; e++) {
    const started = Date.now();
    for (let i = 0; i < n; i++) {
      const b = i * perCard + probes[e].r * 2;
      const hit = nearestTwo(index, n, R[b], R[b + 1], -1);
      const at = e * n + i;
      d1s[at] = hit.d1;
      d2s[at] = hit.d2;
      hitAt[at] = hit.at;
      drift[at] = popcount(R[b] ^ index[i * 2]) + popcount(R[b + 1] ^ index[i * 2 + 1]);
    }
    if (!quiet)
      console.log(`  probed ${probes[e].name.padEnd(11)} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  return { probes, d1s, d2s, hitAt, drift };
}

// ---------------------------------------------------------------------------
// Candidate rules. Each takes one trial and answers "auto-accept?".
// ---------------------------------------------------------------------------

const RULES = {
  /** The blanket rule. */
  margin: (M) => ({
    label: `margin>=${M}`,
    ok: (d1, d2) => d1 <= MAX_DISTANCE && d2 - d1 >= M,
  }),
  /**
   * Margin M, but refuse when the card being matched INTO has a near twin of
   * its own in the index. Hamming obeys the triangle inequality, so
   * margin <= (distance from the hit to its nearest rival) always — which means
   * this can only ever be a WEAKER condition than raising the margin to T, and
   * is therefore cheaper by construction. The question is whether it still
   * catches the leaks.
   */
  crowd: (M, T, nearestOther) => ({
    label: `margin>=${M} & hitCrowd>=${T}`,
    ok: (d1, d2, hit) => d1 <= MAX_DISTANCE && d2 - d1 >= M && nearestOther[hit] >= T,
  }),
  /**
   * Asymmetric on distance: a query that landed within K bits of a catalog
   * image is a near-lossless capture and has not drifted far enough to have
   * crossed to a twin; one that landed further has. Both shipped leaks sat at
   * distance 4.
   */
  asym: (K, lo, hi) => ({
    label: `margin>=${lo} if d<=${K} else >=${hi}`,
    ok: (d1, d2) => d1 <= MAX_DISTANCE && d2 - d1 >= (d1 <= K ? lo : hi),
  }),
  /**
   * Both ideas at once, and the reason they compose: the distance clause is
   * what protects the crowding axis (a perfect capture is at distance 0, so it
   * is never subjected to the strict branch), and the crowding clause is a
   * cheaper way to be strict than raising the margin, because margin <= the
   * hit's own nearest-rival distance always holds.
   */
  combo: (K, lo, T, nearestOther) => ({
    label: `margin>=${lo}; if d>${K} also hitCrowd>=${T}`,
    ok: (d1, d2, hit) => d1 <= MAX_DISTANCE && d2 - d1 >= lo && (d1 <= K || nearestOther[hit] >= T),
  }),
};

/** Both axes for one rule: distorted-query safety, and clean-capture crowding. */
function scoreRule(rule, ctx) {
  const { n, probes, d1s, d2s, hitAt, nearestOther } = ctx;
  let accepted = 0;
  let wrong = 0;
  const wrongRows = [];
  for (let e = 0; e < probes.length; e++) {
    for (let i = 0; i < n; i++) {
      const at = e * n + i;
      if (!rule.ok(d1s[at], d2s[at], hitAt[at])) continue;
      if (hitAt[at] === i) accepted++;
      else {
        wrong++;
        wrongRows.push({ e, i, d1: d1s[at], d2: d2s[at], hit: hitAt[at] });
      }
    }
  }
  // The crowding axis is the same rule applied to a perfect capture: distance 0
  // to itself, runner-up at its nearest other neighbour, top hit is itself.
  let matched = 0;
  for (let i = 0; i < n; i++) if (rule.ok(0, nearestOther[i], i)) matched++;
  return { accepted, wrong, wrongRows, matched, trials: probes.length * n };
}

// ---------------------------------------------------------------------------
// ANALYSE
// ---------------------------------------------------------------------------

function analyse() {
  const { latest, cards, words: index } = readShippedIndex();
  const n = cards.length;
  const perCard = RENDERS.length * 2;
  const R = readRenderCache(latest, n);

  console.log(`${n.toLocaleString()} cards, index ${latest.version}, render cache verified complete\n`);

  const nearestOther = new Int32Array(n);
  const nearestOtherAt = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const { d1, at } = nearestTwo(index, n, index[i * 2], index[i * 2 + 1], i);
    nearestOther[i] = d1;
    nearestOtherAt[i] = at;
  }

  const { probes, d1s, d2s, hitAt, drift } = probeAll(index, R, n, RENDERS, perCard);
  const ctx = { n, probes, d1s, d2s, hitAt, nearestOther };
  const trials = probes.length * n;

  // -- DRIFT ---------------------------------------------------------------
  console.log("\n=== DRIFT: how far each render moves a query from its OWN index entry ===");
  console.log("Every query is a deterministic canvas transform of the very PNG that built the");
  console.log("index entry it is being scored against. `clean` is the control: it must be 0.");
  const driftRows = [];
  for (let e = 0; e < probes.length; e++) {
    const v = [];
    for (let i = 0; i < n; i++) v.push(drift[e * n + i]);
    v.sort((a, b) => a - b);
    driftRows.push({
      render: probes[e].name,
      "drift p50": v[Math.floor(n * 0.5)],
      "drift p90": v[Math.floor(n * 0.9)],
      "drift max": v[n - 1],
      "queries landing 0 bits from own entry": v.filter((x) => x === 0).length,
    });
  }
  console.table(driftRows);
  let cleanDrift = 0;
  for (let i = 0; i < n; i++) {
    if (R[i * perCard] !== index[i * 2] || R[i * perCard + 1] !== index[i * 2 + 1]) cleanDrift++;
  }
  console.log(`clean: ${cleanDrift} of ${n} queries differ from the index at all (parity control)`);

  // -- HEADROOM ------------------------------------------------------------
  console.log("\n=== HEADROOM: every wrong top-1 hit that came anywhere near the gate ===");
  const nearMisses = [];
  for (let e = 0; e < probes.length; e++) {
    for (let i = 0; i < n; i++) {
      const at = e * n + i;
      if (hitAt[at] === i || d1s[at] > MAX_DISTANCE) continue;
      const m = d2s[at] - d1s[at];
      if (m >= 5) nearMisses.push({ e, i, d1: d1s[at], m, hit: hitAt[at], drift: drift[at] });
    }
  }
  nearMisses.sort((a, b) => b.m - a.m || a.d1 - b.d1);
  console.log(
    `${nearMisses.length} wrong top-1 hits achieved a margin of 5 or more, out of ${trials.toLocaleString()} trials.`,
  );
  console.table(
    nearMisses.slice(0, 14).map((w) => ({
      render: probes[w.e].name,
      query: cards[w.i].id,
      "filed as": cards[w.hit].id,
      "same name": cards[w.i].name === cards[w.hit].name,
      distance: w.d1,
      margin: w.m,
      "truth sat at": w.drift,
      "hit's own nearest rival": nearestOther[w.hit],
    })),
  );

  // -- the (distance, margin) joint shape of a wrong hit --------------------
  console.log("\n=== Where a WRONG top-1 hit sits: max margin achieved, by distance ===");
  const byD1 = [];
  for (let d = 0; d <= MAX_DISTANCE; d++)
    byD1.push({ distance: d, wrongHits: 0, maxMargin: -1, atMargin8plus: 0 });
  for (let e = 0; e < probes.length; e++) {
    for (let i = 0; i < n; i++) {
      const at = e * n + i;
      if (hitAt[at] === i || d1s[at] > MAX_DISTANCE) continue;
      const row = byD1[d1s[at]];
      row.wrongHits++;
      const m = d2s[at] - d1s[at];
      if (m > row.maxMargin) row.maxMargin = m;
      if (m >= BASE_MARGIN) row.atMargin8plus++;
    }
  }
  console.table(byD1.filter((r) => r.wrongHits > 0));

  // -- and where a CORRECT accept sits, so the cost of a distance rule is visible
  console.log("\n=== Where a CORRECT auto-accept sits at margin 8: share by distance ===");
  const correctByD1 = [];
  for (let e = 0; e < probes.length; e++) {
    const row = { render: probes[e].name, "d<=2": 0, "d<=4": 0, "d<=6": 0, total: 0 };
    for (let i = 0; i < n; i++) {
      const at = e * n + i;
      if (d1s[at] > MAX_DISTANCE || d2s[at] - d1s[at] < BASE_MARGIN || hitAt[at] !== i) continue;
      row.total++;
      if (d1s[at] <= 2) row["d<=2"]++;
      if (d1s[at] <= 4) row["d<=4"]++;
      if (d1s[at] <= 6) row["d<=6"]++;
    }
    correctByD1.push(row);
  }
  console.table(correctByD1);

  // -- COLLATERAL ----------------------------------------------------------
  //
  // A margin of 10 exists to stop a query crossing to a card that looks like it.
  // Where the two cards are the same card reprinted, refusing is right. Where
  // the rival is an unrelated card the hash happened to land near, the refusal
  // buys nothing a scan would ever have got wrong.
  console.log("\n=== COLLATERAL: what the cards in each crowding band are ===");
  const bands = [
    [0, 1],
    [1, 4],
    [4, 8],
    [8, 10],
    [10, 12],
    [12, 16],
  ];
  const bandRows = [];
  for (const [lo, hi] of bands) {
    let count = 0;
    let sameName = 0;
    let sameSet = 0;
    for (let i = 0; i < n; i++) {
      if (nearestOther[i] < lo || nearestOther[i] >= hi) continue;
      count++;
      const rival = cards[nearestOtherAt[i]];
      if (rival.name === cards[i].name) sameName++;
      if (rival.setId === cards[i].setId) sameSet++;
    }
    bandRows.push({
      "nearest rival": hi === lo + 1 ? `exactly ${lo}` : `${lo}-${hi - 1} bits`,
      cards: count,
      "rival is the SAME card name": `${((sameName / count) * 100).toFixed(1)}%`,
      "rival is in the same set": `${((sameSet / count) * 100).toFixed(1)}%`,
    });
  }
  console.table(bandRows);

  console.log("The 312 cards margin 10 gives up on a perfect capture — a sample of what they are:");
  const sample = [];
  for (let i = 0; i < n && sample.length < 12; i++) {
    if (nearestOther[i] < 8 || nearestOther[i] >= 10) continue;
    if (i % 23 !== 0) continue;
    sample.push({
      card: `${cards[i].id} ${cards[i].name}`,
      "loses to": `${cards[nearestOtherAt[i]].id} ${cards[nearestOtherAt[i]].name}`,
      bits: nearestOther[i],
      "same name": cards[i].name === cards[nearestOtherAt[i]].name,
    });
  }
  console.table(sample);

  // -- RULES ---------------------------------------------------------------
  console.log("\n=== RULES: candidates against the same 121,230 trials and the same crowding pass ===");
  const baseline = scoreRule(RULES.margin(BASE_MARGIN), ctx);
  const candidates = [
    RULES.margin(8),
    RULES.margin(9),
    RULES.margin(10),
    RULES.margin(11),
    RULES.crowd(8, 9, nearestOther),
    RULES.crowd(8, 10, nearestOther),
    RULES.crowd(8, 11, nearestOther),
    RULES.crowd(8, 12, nearestOther),
    RULES.asym(0, 8, 10),
    RULES.asym(2, 8, 10),
    RULES.asym(3, 8, 10),
    RULES.asym(4, 8, 10),
    RULES.asym(2, 8, 11),
    RULES.asym(2, 8, 12),
    RULES.asym(2, 7, 10),
    RULES.asym(2, 6, 10),
    RULES.combo(2, 8, 10, nearestOther),
    RULES.combo(2, 8, 11, nearestOther),
    RULES.combo(2, 8, 12, nearestOther),
    RULES.combo(4, 8, 11, nearestOther),
  ];
  const ruleRows = [];
  const detail = new Map();
  for (const rule of candidates) {
    const s = scoreRule(rule, ctx);
    detail.set(rule.label, s);
    ruleRows.push({
      rule: rule.label,
      autoAccepted: `${((s.accepted / s.trials) * 100).toFixed(1)}%`,
      falseAccepts: s.wrong,
      "MATCHED (clean)": `${((s.matched / n) * 100).toFixed(1)}%`,
      "cards lost vs margin 8": baseline.matched - s.matched,
      "accepts lost vs margin 8": baseline.accepted - s.accepted,
    });
  }
  console.table(ruleRows);

  // -- per render, for the three that reach zero -----------------------------
  console.log("\n=== PER RENDER: where each zero-leak rule spends its refusals ===");
  const finalists = [
    RULES.margin(BASE_MARGIN),
    RULES.margin(CANDIDATE_MARGIN),
    RULES.asym(2, 8, 10),
    RULES.combo(2, 8, 11, nearestOther),
  ];
  const perRender = [];
  for (let e = 0; e < probes.length; e++) {
    const row = { render: probes[e].name };
    for (const rule of finalists) {
      let ok = 0;
      let bad = 0;
      for (let i = 0; i < n; i++) {
        const at = e * n + i;
        if (!rule.ok(d1s[at], d2s[at], hitAt[at])) continue;
        if (hitAt[at] === i) ok++;
        else bad++;
      }
      row[rule.label] = `${((ok / n) * 100).toFixed(1)}%${bad ? ` (${bad} WRONG)` : ""}`;
    }
    perRender.push(row);
  }
  console.table(perRender);

  // -- NOISE ---------------------------------------------------------------
  //
  // The battery's renders are exact functions of the index's own bytes. A real
  // capture also carries sensor noise, wear, dust, focus and a colour cast, none
  // of which any canvas transform here produces. Flipping k bits of the query
  // hash is a crude stand-in — it does not model the real perturbation, but it
  // does answer "how many bits of unmodelled degradation does this gate
  // survive", which is the only thing the 0 is being asked to promise.
  console.log("\n=== NOISE: false accepts after k random bit flips per query ===");
  console.log("Not a camera model. A sensitivity test: how far is each gate from its first leak?");
  const noiseRules = [
    RULES.margin(8),
    RULES.margin(10),
    RULES.margin(11),
    RULES.asym(2, 8, 10),
    RULES.combo(2, 8, 11, nearestOther),
  ];
  const noiseRows = [];
  for (const k of [1, 2, 3]) {
    const row = { "bits flipped": k };
    const totals = new Map(noiseRules.map((r) => [r.label, 0]));
    const SEEDS = 3;
    for (let seed = 1; seed <= SEEDS; seed++) {
      let state = seed * 0x9e3779b9;
      const rnd = () => {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const nd1 = new Int32Array(probes.length * n);
      const nd2 = new Int32Array(nd1.length);
      const nhit = new Int32Array(nd1.length);
      for (let e = 0; e < probes.length; e++) {
        for (let i = 0; i < n; i++) {
          const b = i * perCard + probes[e].r * 2;
          let q0 = R[b];
          let q1 = R[b + 1];
          for (let f = 0; f < k; f++) {
            const bit = Math.floor(rnd() * HASH_BITS);
            if (bit < 32) q0 ^= 1 << bit;
            else q1 ^= 1 << (bit - 32);
          }
          const hit = nearestTwo(index, n, q0, q1, -1);
          const at = e * n + i;
          nd1[at] = hit.d1;
          nd2[at] = hit.d2;
          nhit[at] = hit.at;
        }
      }
      for (const rule of noiseRules) {
        const s = scoreRule(rule, { n, probes, d1s: nd1, d2s: nd2, hitAt: nhit, nearestOther });
        totals.set(rule.label, totals.get(rule.label) + s.wrong);
      }
    }
    for (const rule of noiseRules) row[rule.label] = (totals.get(rule.label) / SEEDS).toFixed(1);
    noiseRows.push(row);
    console.log(`  k=${k} done`);
  }
  console.log("false accepts, mean of 3 seeds, out of 121,230 trials:");
  console.table(noiseRows);
}

// ---------------------------------------------------------------------------
// FETCH — alternate geometric renders, for the CROP section
// ---------------------------------------------------------------------------

function pageHarness() {
  function grab(canvas) {
    return canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, 245, 342);
  }
  function zoom(bmp, pct) {
    const canvas = new OffscreenCanvas(245, 342);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const dx = 245 * pct;
    const dy = 342 * pct;
    ctx.drawImage(bmp, -dx, -dy, 245 + dx * 2, 342 + dy * 2);
    return grab(canvas);
  }

  const SCANS = {
    // The shipped battery uses exactly 3%. These bracket it.
    crop2: (bmp) => zoom(bmp, 0.02),
    crop4: (bmp) => zoom(bmp, 0.04),
    // A quad detector that is the right SIZE but off-centre — the shipped
    // cropError is a pure symmetric zoom and can never produce this.
    cropShift: (bmp) => {
      const canvas = new OffscreenCanvas(245, 342);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 245 * 0.03, 342 * 0.02, 245, 342);
      return grab(canvas);
    },
    // Detection error that is not the same on both axes.
    cropAsym: (bmp) => {
      const canvas = new OffscreenCanvas(245, 342);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const dx = 245 * 0.035;
      const dy = 342 * 0.012;
      ctx.drawImage(bmp, -dx, -dy * 2, 245 + dx * 2, 342 + dy * 2);
      return grab(canvas);
    },
    tilt5: (bmp) => {
      const canvas = new OffscreenCanvas(245, 342);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.translate(122, 171);
      ctx.rotate((5 * Math.PI) / 180);
      ctx.scale(1.02, 1);
      ctx.translate(-122, -171);
      ctx.drawImage(bmp, 0, 0, 245, 342);
      return grab(canvas);
    },
  };

  return {
    async hashAll(dataUrl, order) {
      const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const rect = window.PHash.artRect(245, 342);
      const out = [];
      for (const name of order) {
        const img = SCANS[name](bmp);
        const h = window.PHash.perceptualHash(img.data, 245, 342, rect);
        out.push(h[0], h[1]);
      }
      bmp.close();
      return out;
    },
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const at = i++;
        out[at] = await fn(items[at], at);
      }
    }),
  );
  return out;
}

async function fetchStage() {
  const { build } = await import("esbuild");
  const { chromium } = await import("@playwright/test");
  const { latest, cards } = readShippedIndex();
  const plan = JSON.parse(readFileSync(`${ALT_DIR}/subset.json`, "utf8"));
  const urls = plan.subset.map((c, i) => {
    if (c.ordinal !== i || c.id !== cards[i].id) throw new Error(`subset.json row ${i} is out of line`);
    return c.url;
  });
  const n = cards.length;
  const perCard = ALT_RENDERS.length * 2;

  let done = 0;
  const words = new Uint32Array(n * perCard);
  const missing = new Uint8Array(n);
  mkdirSync(WORK_DIR, { recursive: true });
  if (RESUME && existsSync(`${WORK_DIR}/progress.json`)) {
    const prog = JSON.parse(readFileSync(`${WORK_DIR}/progress.json`, "utf8"));
    if (prog.version === latest.version && prog.renders.join(",") === ALT_RENDERS.join(",")) {
      const rb = readFileSync(`${WORK_DIR}/renders.u32`);
      words.set(new Uint32Array(rb.buffer, rb.byteOffset, prog.count * perCard));
      missing.set(Uint8Array.from(prog.missing ?? []), 0);
      done = prog.count;
      console.log(`Resuming from ${done.toLocaleString()} of ${n.toLocaleString()}`);
    }
  }

  const bundled = await build({
    entryPoints: ["src/scan/phash.ts"],
    bundle: true,
    format: "iife",
    globalName: "PHash",
    write: false,
    target: "es2022",
  });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await page.addScriptTag({ content: `window.HX = (${pageHarness.toString()})();` });

  const save = (count) => {
    writeFileSync(`${WORK_DIR}/renders.u32`, Buffer.from(words.buffer, 0, count * perCard * 4));
    writeFileSync(
      `${WORK_DIR}/progress.json`,
      JSON.stringify({
        version: latest.version,
        count,
        renders: ALT_RENDERS,
        missing: Array.from(missing.subarray(0, count)),
      }),
    );
  };

  const CHUNK = 60;
  const started = Date.now();
  const startedAt = done;
  for (let at = done; at < n; at += CHUNK) {
    const images = await mapLimit(urls.slice(at, at + CHUNK), 8, async (url) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(String(res.status));
          const buf = Buffer.from(await res.arrayBuffer());
          return `data:${res.headers.get("content-type") ?? "image/png"};base64,${buf.toString("base64")}`;
        } catch {
          if (attempt === 3) return null;
          await new Promise((r) => setTimeout(r, attempt * 500));
        }
      }
      return null;
    });
    const part = await page.evaluate(
      async ({ sources, order }) => {
        const out = [];
        for (const src of sources) out.push(src ? await window.HX.hashAll(src, order) : null);
        return out;
      },
      { sources: images, order: ALT_RENDERS },
    );
    for (let k = 0; k < part.length; k++) {
      const i = at + k;
      if (!part[k]) missing[i] = 1;
      else words.set(part[k], i * perCard);
    }
    done = Math.min(at + CHUNK, n);
    if (at % (CHUNK * 20) === 0 || done === n) {
      save(done);
      const rate = (done - startedAt) / ((Date.now() - started) / 1000);
      console.log(`  ${done.toLocaleString()}/${n.toLocaleString()}  ${rate.toFixed(1)} cards/s`);
    }
  }
  save(done);
  await browser.close();
  console.log(`\nDone. ${missing.reduce((a, b) => a + b, 0)} cards without art.`);
}

// ---------------------------------------------------------------------------
// CROP — does the zero survive a distortion the battery does not contain?
// ---------------------------------------------------------------------------

function cropReport() {
  const { latest, cards, words: index } = readShippedIndex();
  const n = cards.length;
  const prog = JSON.parse(readFileSync(`${WORK_DIR}/progress.json`, "utf8"));
  if (prog.version !== latest.version) throw new Error("alternate render cache is for another index");
  const covered = prog.count;
  const perCard = ALT_RENDERS.length * 2;
  const rb = readFileSync(`${WORK_DIR}/renders.u32`);
  const A = new Uint32Array(rb.buffer, rb.byteOffset, covered * perCard);
  const missing = prog.missing.reduce((a, b) => a + b, 0);
  console.log(`${covered.toLocaleString()} of ${n.toLocaleString()} cards rendered, ${missing} without art`);

  const nearestOther = new Int32Array(n);
  for (let i = 0; i < n; i++) nearestOther[i] = nearestTwo(index, n, index[i * 2], index[i * 2 + 1], i).d1;

  const rules = [
    RULES.margin(8),
    RULES.margin(10),
    RULES.margin(11),
    RULES.asym(2, 8, 10),
    RULES.combo(2, 8, 11, nearestOther),
    RULES.combo(2, 8, 12, nearestOther),
  ];
  const rows = [];
  const leaks = [];
  for (let r = 0; r < ALT_RENDERS.length; r++) {
    const counts = new Map(rules.map((x) => [x.label, { ok: 0, bad: 0 }]));
    for (let i = 0; i < covered; i++) {
      if (prog.missing[i]) continue;
      const b = i * perCard + r * 2;
      const hit = nearestTwo(index, n, A[b], A[b + 1], -1);
      for (const rule of rules) {
        if (!rule.ok(hit.d1, hit.d2, hit.at)) continue;
        const cell = counts.get(rule.label);
        if (hit.at === i) cell.ok++;
        else {
          cell.bad++;
          if (rule.label === `margin>=${CANDIDATE_MARGIN}`) {
            leaks.push({ render: ALT_RENDERS[r], i, hit: hit.at, d1: hit.d1, d2: hit.d2 });
          }
        }
      }
    }
    const row = { render: ALT_RENDERS[r] };
    for (const rule of rules) {
      const c = counts.get(rule.label);
      row[rule.label] = `${((c.ok / covered) * 100).toFixed(1)}% / ${c.bad} wrong`;
    }
    rows.push(row);
    console.log(`  scored ${ALT_RENDERS[r]}`);
  }
  console.log("\n=== CROP: geometric distortions the shipped battery does not contain ===");
  console.log("accept% / false accepts, per render, over the cards rendered.");
  console.table(rows);
  if (leaks.length) {
    console.log(`\nFalse accepts that a blanket margin of ${CANDIDATE_MARGIN} does NOT stop:`);
    console.table(
      leaks.slice(0, 20).map((w) => ({
        render: w.render,
        query: `${cards[w.i].id} ${cards[w.i].name}`,
        "filed as": `${cards[w.hit].id} ${cards[w.hit].name}`,
        distance: w.d1,
        margin: w.d2 - w.d1,
        "query's own nearest rival": nearestOther[w.i],
      })),
    );
  } else {
    console.log(`\nNo false accepts at margin ${CANDIDATE_MARGIN} under any alternate render.`);
  }
}

if (MODE === "fetch") await fetchStage();
else if (MODE === "crop") cropReport();
else if (MODE === "analyse") analyse();
else throw new Error(`unknown mode ${MODE} — use analyse | fetch | crop`);
