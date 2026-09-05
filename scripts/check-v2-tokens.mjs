#!/usr/bin/env node
/**
 * Fail the build if anything in `src/v2/` hard-codes a value that belongs in
 * `src/v2/tokens.css`.
 *
 * Nine screens are being built in parallel against one vocabulary. The thing
 * that actually goes wrong is not a missing primitive — it is four streams each
 * picking their own grey, their own 14px, their own not-quite-8px gap, and the
 * result reading as four apps. A convention nobody can check is a convention
 * that decays, so this checks it.
 *
 * WHAT IT FLAGS: colours (hex, rgb(), hsl()) and absolute lengths (px, rem) and
 * times (ms, s). Those are the values a token exists for.
 *
 * WHAT IT ALLOWS, on purpose: `%`, `ch`, `em`, `vh`, `vw`, `fr`, `deg` and bare
 * `0`. Those are relative to something the code can already see — a font size,
 * a container, the viewport — so they are self-explanatory where they are
 * written, and tokenising them would add a layer without adding a decision.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const V2 = join(ROOT, "src", "v2");

/** The one file allowed to contain raw values — it is where they are defined. */
const TOKENS = join(V2, "tokens.css");

const RULES = [
  { name: "hex colour", re: /#[0-9a-fA-F]{3,8}\b/g },
  { name: "rgb()/hsl() colour", re: /\b(?:rgba?|hsla?)\s*\(/g },
  { name: "px length", re: /(?<![\w-])\d*\.?\d+px\b/g },
  { name: "rem length", re: /(?<![\w-])\d*\.?\d+rem\b/g },
  { name: "duration", re: /(?<![\w-])\d*\.?\d+m?s\b/g },
];

/**
 * Lines exempted with an explicit note. There is always a case the rule did
 * not anticipate, and a comment saying which is better than a rule people
 * route around by moving the value somewhere it is not checked.
 *
 * Accepted on the offending line OR the line above it. Both, because Prettier
 * decides which: a comment written after `@media (min-width: 1000px) {` is
 * moved onto the next line by `format`, which used to put it off the only line
 * this checked — so the sanctioned escape hatch did not survive the sanctioned
 * formatter, and the one stream that tried it had to find another way out.
 */
const ALLOW = /v2-tokens-allow/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const failures = [];

/**
 * In a `.tsx` file the only place a raw value can do damage is an inline
 * style — everything else on the line is prose, and prose is FULL of these
 * numbers because explaining why a rule exists means quoting the value it
 * outlaws ("92px against 125px"). Scanning it would either delete those
 * explanations or teach everyone to write the checker a lie.
 */
const STYLE_CONTEXT = /style\s*=|style\s*:|\bcssText\b/;

for (const path of walk(V2)) {
  if (path === TOKENS) continue;
  if (!/\.(css|tsx?)$/.test(path)) continue;

  const isCss = path.endsWith(".css");
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  let inBlockComment = false;

  lines.forEach((line, i) => {
    // Comments describe values all the time — "was 92px against 125px" is the
    // reason a rule exists, and flagging it would delete the explanation.
    const openedHere = line.includes("/*");
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      return;
    }
    if (openedHere && !line.includes("*/")) {
      inBlockComment = true;
      return;
    }
    const code = line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
    if (!code.trim() || ALLOW.test(line) || ALLOW.test(lines[i - 1] ?? "")) return;
    if (!isCss && !STYLE_CONTEXT.test(code)) return;

    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      const found = code.match(rule.re);
      if (found) {
        failures.push({
          file: relative(ROOT, path).split(sep).join("/"),
          line: i + 1,
          rule: rule.name,
          text: found.join(", "),
          source: line.trim(),
        });
      }
    }
  });
}

if (failures.length === 0) {
  console.log("v2 tokens: ok");
  process.exit(0);
}

console.error(`\nv2 raw values (${failures.length}) — these belong in src/v2/tokens.css:\n`);
for (const f of failures) {
  console.error(`  ${f.file}:${f.line}  ${f.rule}: ${f.text}`);
  console.error(`    ${f.source}`);
}
console.error(
  "\nAdd a token and use it. If a value genuinely cannot be one, put a\n" +
    "`v2-tokens-allow` comment on that line or the line above it, saying why.\n",
);
process.exit(1);
