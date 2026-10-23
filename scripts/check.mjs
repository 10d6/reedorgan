// Checks index.html before it ships. No dependencies; run with `node scripts/check.mjs`.
//
// 1. The page is a complete HTML document with a title.
// 2. Every inline <script> parses as valid JavaScript.
// 3. Every element id is unique, and every getElementById('...') in the
//    script names an id that exists in the markup or is built by the script.
// 4. External resources come only from Google Fonts (the page is meant to be
//    a single self-contained file).

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const file = process.argv[2] ?? "index.html";
const html = readFileSync(file, "utf8");
const errors = [];
const fail = (msg) => errors.push(msg);

// 1. Document shape
if (!/^<!doctype html>/i.test(html.trimStart())) fail("missing <!doctype html> at the top");
for (const tag of ["html", "head", "body"]) {
  if (!new RegExp(`<${tag}[\\s>]`, "i").test(html)) fail(`missing <${tag}>`);
  if (!new RegExp(`</${tag}>`, "i").test(html)) fail(`missing </${tag}>`);
}
if (!/<title>[^<]+<\/title>/i.test(html)) fail("missing or empty <title>");

// 2. Script syntax
const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\ssrc=/i.test(m[1] ?? ""))
  .map((m) => m[2]);
if (scripts.length === 0) fail("no inline <script> found");
const dir = mkdtempSync(join(tmpdir(), "organ-check-"));
try {
  scripts.forEach((code, i) => {
    const path = join(dir, `script-${i}.js`);
    writeFileSync(path, code);
    const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    if (r.status !== 0) fail(`inline script #${i + 1} has a syntax error:\n${r.stderr.trim()}`);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// 3. Element ids
const markup = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
const staticIds = [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const seen = new Set();
for (const id of staticIds) {
  if (seen.has(id)) fail(`duplicate id="${id}"`);
  seen.add(id);
}
const js = scripts.join("\n");
// ids the script builds itself, e.g. id="ao${s}" for s in L/R, or 'stop-'+s.id
const dynamic = [...js.matchAll(/id="([A-Za-z]+)\$\{s\}"/g)].flatMap((m) => [m[1] + "L", m[1] + "R"]);
const known = new Set([...staticIds, ...dynamic]);
for (const m of js.matchAll(/getElementById\('([^']+)'\)/g)) {
  if (!known.has(m[1])) fail(`script looks up id "${m[1]}" but no element has it`);
}

// 4. External resources
const allowed = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];
for (const m of html.matchAll(/\s(?:src|href)="(https?:[^"]+)"/g)) {
  if (!allowed.some((a) => m[1].startsWith(a))) fail(`external resource not allowed: ${m[1]}`);
}

if (errors.length) {
  console.error(`✗ ${file}: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log(`✓ ${file}: document, ${scripts.length} script(s), ${known.size} ids and resources all check out`);
