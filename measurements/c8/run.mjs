// Claim 8: the CSS of `bind: 'chain'` against the resolver, in browsers.
//
// For every document in docs.mjs and every output form, the built plugin writes the tokens of `@toghen contexts ds;`,
// and a page nests up to three elements, each setting one `modifier=context`. A consumer at the innermost element
// reads each token; its computed value must equal `Resolver.valueAt(path, input)`, where `input` is the nearest
// ancestor's context per modifier and the default for a modifier no ancestor sets. No nesting is skipped and the
// oracle is not loosened.
//
// Run from a scratch copy of this folder (see ../README.md), with TOGHEN_ROOT set to the repository, built:
//   TOGHEN_ROOT=/path/to/Toghen node run.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit, firefox } from 'playwright-core';
import { docs } from './docs.mjs';

const root = path.resolve(process.env.TOGHEN_ROOT ?? new URL('../../..', import.meta.url).pathname);
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { Resolver, cssPropertyName } = await load('toghen-lib/dist/index.js');
const { default: toghenPlugin } = await load('toghen-postcss/dist/index.js');
const { default: postcss } = await load('toghen-postcss/node_modules/postcss/lib/postcss.mjs');

const MEDIA = '@media (prefers-color-scheme: dark)';
// layered: the tokens in a `tokens` layer, consumers outside it. flat: no layer. The media forms spell the context
// `scheme=dark` as an at-rule, so the page's colour scheme chooses it and no element can set it.
const forms = [
  { name: 'layered', layered: true },
  { name: 'flat', layered: false },
  { name: 'media-layered', layered: true, media: true },
  { name: 'media-flat', layered: false, media: true },
];

const hex = (v) =>
  '#' +
  v.components
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const expectedOf = (consumer, value) =>
  value === undefined ? consumer.fallback : consumer.kind === 'length' ? `${value.value}${value.unit}` : hex(value);
const readColor = (rgb) =>
  '#' +
  rgb
    .match(/\d+/g)
    .slice(0, 3)
    .map((n) => (+n).toString(16).padStart(2, '0'))
    .join('');

/** Every sequence of up to `depth` elements, outermost first, each one of `pairs`. */
const nestings = (pairs, depth = 3) => {
  let all = [[]];
  for (let n = 1; n <= depth; n++) all = all.concat(all.filter((s) => s.length === n - 1).flatMap((s) => pairs.map((p) => [...s, p])));
  return all;
};

async function build(doc, form) {
  const document = structuredClone(doc.document);
  if (form.media) {
    if (!document.modifiers.scheme) return undefined;
    document.modifiers.scheme.$extensions = { 'com.toghen': { css: { contexts: { dark: { atRule: MEDIA } } } } };
  }
  const resolver = new Resolver(document);
  const system = resolver.resolveContextsToDesignSystem();
  // `prop` reads the head; the consumers through the token layer are written by the plugin from `toghen()`.
  const prop = (k) => (k.kind === 'length' ? 'padding-left' : 'color');
  const consumers = doc.consumers.map((k, i) => ({ ...k, i, prop: prop(k) }));
  const sheet =
    (form.layered ? '@layer tokens { @toghen contexts ds; }\n' : '@toghen contexts ds;\n') +
    consumers
      .map((k) => `.p${k.i} { ${k.prop}: var(${cssPropertyName(`ds.${k.path}`)}${k.fallback ? `, ${k.fallback}` : ''}); }`)
      .join('\n') +
    '\n' +
    consumers
      .filter((k) => !k.plain)
      .map((k) => `.t${k.i} { ${k.prop}: toghen(ds.${k.path}); }`)
      .join('\n');
  const out = await postcss([
    toghenPlugin({ system, references: 'var', bind: 'chain', tokenLayer: 'tokens', onUnresolved: 'throw' }),
  ]).process(sheet, { from: undefined });
  const modifiers = system.getCollection('ds').getModifiers();
  const media = new Set(form.media ? ['scheme'] : []);
  const pairs = modifiers.filter((m) => !media.has(m.name)).flatMap((m) => m.contexts.map((c) => [m.name, c]));
  const cases = nestings(pairs);
  const spans = (n) =>
    consumers
      .flatMap((k) => [
        `<span class="p${k.i}" id="n${n}p${k.i}">x</span>`,
        ...(k.plain ? [] : [`<span class="t${k.i}" id="n${n}t${k.i}">x</span>`]),
      ])
      .join('');
  const body = cases
    .map((seq, n) => seq.reduceRight((inner, [m, c]) => `<div data-${m}="${c}">${inner}</div>`, `<div>${spans(n)}</div>`))
    .join('');
  return {
    css: out.css,
    warnings: out.warnings().map((w) => w.text),
    html: `<style>${out.css}</style><body>${body}`,
    cases,
    consumers,
    resolver,
    modifiers,
    media,
  };
}

/** What each consumer must read in each nesting, for a page in `scheme`. */
function expectations(b, scheme) {
  return b.cases.map((seq) => {
    const input = {};
    for (const m of b.media) input[m] = scheme === 'dark' ? 'dark' : b.modifiers.find((x) => x.name === m).default;
    for (const [m, c] of seq) input[m] = c;
    return b.consumers.map((k) => {
      let value;
      try {
        value = b.resolver.valueAt(k.path, input);
      } catch {
        value = undefined;
      }
      return expectedOf(k, value);
    });
  });
}

async function measure(page, b, scheme) {
  await page.setContent(b.html);
  const got = await page.evaluate(
    ({ n, consumers }) => {
      const read = (id, prop) => {
        const s = getComputedStyle(document.getElementById(id));
        return prop === 'padding-left' ? s.paddingLeft : s.color;
      };
      return Array.from({ length: n }, (_, i) =>
        consumers.map((k) => ({ p: read(`n${i}p${k.i}`, k.prop), t: k.plain ? undefined : read(`n${i}t${k.i}`, k.prop) })),
      );
    },
    { n: b.cases.length, consumers: b.consumers.map(({ i, prop, plain }) => ({ i, prop, plain })) },
  );
  const want = expectations(b, scheme);
  let ok = 0,
    readings = 0,
    good = 0;
  const bad = [];
  got.forEach((row, n) => {
    let fine = true;
    row.forEach((r, j) => {
      const k = b.consumers[j];
      for (const [how, v] of [
        ['var()', r.p],
        ['tokenLayer', r.t],
      ]) {
        if (v === undefined) continue;
        readings++;
        const seen = k.kind === 'length' ? v : readColor(v);
        if (seen === want[n][j]) good++;
        else {
          fine = false;
          bad.push(`${k.path} via ${how}, page ${scheme}, nesting ${JSON.stringify(b.cases[n])}: expected ${want[n][j]}, got ${seen}`);
        }
      }
    });
    if (fine) ok++;
  });
  return { ok, total: got.length, good, readings, bad };
}

const built = [];
for (const [name, doc] of Object.entries(docs)) {
  for (const form of forms) {
    const b = await build(doc, form);
    if (b) built.push({ name, form, b });
  }
}
for (const { name, form, b } of built) if (form.name === 'layered') console.log(`-- ${name}: warnings ${JSON.stringify(b.warnings)}`);

let failed = 0;
for (const [engineName, engine] of Object.entries({ chromium, webkit, firefox })) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    console.log(`== ${engineName} UNAVAILABLE ${e.message.split('\n')[0]}`);
    continue;
  }
  console.log(`== ${engineName} ${browser.version()}`);
  for (const { name, form, b } of built) {
    const total = { ok: 0, total: 0, good: 0, readings: 0, bad: [] };
    for (const scheme of ['light', 'dark']) {
      const page = await (await browser.newContext({ colorScheme: scheme })).newPage();
      const r = await measure(page, b, scheme);
      for (const k of ['ok', 'total', 'good', 'readings']) total[k] += r[k];
      total.bad.push(...r.bad);
      await page.context().close();
    }
    if (total.ok !== total.total) failed++;
    console.log(
      `${name.padEnd(20)} ${form.name.padEnd(14)} ${total.ok}/${total.total} nestings (${total.good}/${total.readings} readings; both page colour schemes)`,
    );
    for (const line of total.bad.slice(0, 4)) console.log(`    MISMATCH ${line}`);
  }
  await browser.close();
}
console.log(failed === 0 ? 'ALL MATCH' : `${failed} document/form/engine rows with mismatches`);
