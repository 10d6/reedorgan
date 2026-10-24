// Static checks for the organ, run in CI on every PR. No dependencies.
// Usage: node scripts/check.mjs
//
// 1. index.html is a complete document with a title, loading css/ and js/main.js.
// 2. Every local file the page references exists, and nothing loads from outside
//    Google Fonts.
// 3. Every module under js/ parses.
// 4. Every relative import resolves to a file that exports the imported names.
// 5. Every element id the modules look up exists in the page or is built by a module,
//    and no id appears twice in the page.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const errors = [];
const fail = (msg) => errors.push(msg);
const rel = (p) => relative(root, p);

// ---- 1. the page
const htmlPath = join(root, "index.html");
const html = readFileSync(htmlPath, "utf8");
if (!/^<!doctype html>/i.test(html.trimStart())) fail("index.html: missing <!doctype html> at the top");
for (const tag of ["html", "head", "body"]) {
  if (!new RegExp(`<${tag}[\\s>]`, "i").test(html)) fail(`index.html: missing <${tag}>`);
  if (!new RegExp(`</${tag}>`, "i").test(html)) fail(`index.html: missing </${tag}>`);
}
if (!/<title>[^<]+<\/title>/i.test(html)) fail("index.html: missing or empty <title>");
if (/<script(?![^>]*\ssrc=)[^>]*>\s*\S/i.test(html)) fail("index.html: inline <script> found; code belongs in js/");
if (!/<script type="module" src="js\/main\.js"><\/script>/.test(html)) fail('index.html: should load <script type="module" src="js/main.js">');

// ---- 2. referenced files and external hosts
const allowed = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];
for (const m of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
  const ref = m[1];
  if (/^https?:/.test(ref)) { if (!allowed.some((a) => ref.startsWith(a))) fail(`index.html: external resource not allowed: ${ref}`); }
  else if (!ref.startsWith("#") && !existsSync(join(root, ref))) fail(`index.html: references missing file ${ref}`);
}

// ---- 3. module syntax
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : []; });
const modules = walk(join(root, "js"));
const source = new Map(modules.map((p) => [p, readFileSync(p, "utf8")]));
for (const p of modules) {
  const r = spawnSync(process.execPath, ["--check", p], { encoding: "utf8" });
  if (r.status !== 0) fail(`${rel(p)}: syntax error\n${r.stderr.trim()}`);
  for (const m of source.get(p).matchAll(/https?:\/\/[^\s'"`)]+/g)) {
    if (/^https?:\/\/(www\.)?(fonts\.google|wikisource|patents\.google)/.test(m[0])) continue;
    if (/fetch\(|import\(|src\s*=/.test(source.get(p))) fail(`${rel(p)}: mentions external URL ${m[0]}; only Google Fonts may be loaded`);
  }
}

// ---- 4. imports resolve to real exports
function exportsOf(code) {
  const names = new Set();
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // export const a = 1, b = 2;  (several names in one declaration, on one line)
  for (const m of code.matchAll(/export\s+(?:const|let|var)\s+([^\n]*)/g))
    for (const d of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=/g)) names.add(d[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  return names;
}
for (const p of modules) {
  for (const m of source.get(p).matchAll(/import\s*(?:\{([^}]*)\}\s*from\s*)?['"]([^'"]+)['"]/g)) {
    const [, names, spec] = m;
    if (!spec.startsWith(".")) { fail(`${rel(p)}: imports a package (${spec}); the site has no build step`); continue; }
    const target = resolve(dirname(p), spec);
    if (!source.has(target)) { fail(`${rel(p)}: import '${spec}' doesn't resolve to a module in js/`); continue; }
    const exp = exportsOf(source.get(target));
    for (const part of (names ?? "").split(",")) {
      const n = part.trim().split(/\s+as\s+/)[0];
      if (n && !exp.has(n)) fail(`${rel(p)}: imports '${n}' from '${spec}', which doesn't export it`);
    }
  }
}

// ---- 5. element ids
const markup = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
const staticIds = [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const seen = new Set();
for (const id of staticIds) { if (seen.has(id)) fail(`index.html: duplicate id="${id}"`); seen.add(id); }
const js = [...source.values()].join("\n");
// ids that modules build from templates: id="flow${s}" (s = L/R), id="lv${c}Amt" (c = each rank)
const ranks = ["Bourdon", "Diapason", "Melodia", "Celeste", "Principal"];
const built = new Set();
for (const m of js.matchAll(/id="([A-Za-z]*)\$\{s\}([A-Za-z]*)"/g)) for (const s of ["L", "R"]) built.add(m[1] + s + m[2]);
for (const m of js.matchAll(/id="([A-Za-z]*)\$\{c\}([A-Za-z]*)"/g)) for (const c of ranks) built.add(m[1] + c + m[2]);
const known = new Set([...staticIds, ...built]);
const lookups = [
  ...js.matchAll(/getElementById\('([^']+)'\)/g),
  ...js.matchAll(/\$\('([^']+)'\)/g),
  ...js.matchAll(/bindSlider\('([^']+)'/g),
];
for (const m of lookups) {
  const id = m[1];
  if (!known.has(id)) fail(`a module looks up id "${id}" but no element has it`);
  if (/Amt$/.test(id) && !known.has(id.replace(/Amt$/, "Out"))) fail(`slider "${id}" has no <output id="${id.replace(/Amt$/, "Out")}">`);
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s)\n`);
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log(`✓ index.html and ${modules.length} modules: references, syntax, imports and ${known.size} ids all check out`);
