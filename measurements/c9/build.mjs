// Claim 9: a light-dark() modifier's output after Lightning CSS, in browsers.
//
// Writes the three pages of this folder from the built plugin and Lightning CSS 1.33.0. Each page holds the plugin's
// output for one modifier spelled with `lightDark`, a consumer that reads it with t(), and the app's colour schemes:
// the root follows the system, `.dark` and `.light` are subtrees that choose.
//   native.html             the plugin's output as written;
//   lowered.html            the plugin's output and the app's colour schemes, lowered together at Vite 8's targets;
//   lowered-no-scheme.html  the plugin's output lowered alone; the app's colour schemes in a second sheet, not lowered.
// `run.mjs` in the folder above reads them.
//
// Run from a scratch copy of this folder (see ../README.md), with TOGHEN_ROOT set to the repository, built:
//   TOGHEN_ROOT=/path/to/postcss node build.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'lightningcss';

const root = path.resolve(process.env.TOGHEN_ROOT ?? fileURLToPath(new URL('../..', import.meta.url)));
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { Resolver } = await load('node_modules/@toghen/lib/dist/index.js');
const { default: toghenPlugin } = await load('dist/index.js');
const { default: postcss } = await load('node_modules/postcss/lib/postcss.mjs');

const srgb = (v) => ({ colorSpace: 'srgb', components: [v, v, v] });
const document = {
  version: '2025-11-01',
  name: 'ds',
  sets: { base: { sources: [{ color: { $type: 'color', bg: { $value: srgb(1) }, text: { $value: srgb(0.1) } } }] } },
  modifiers: {
    theme: {
      default: 'day',
      contexts: { day: [], night: [{ color: { bg: { $value: srgb(0) }, text: { $value: srgb(0.9) } } }] },
      $extensions: { 'com.toghen': { css: { lightDark: { light: 'day', dark: 'night' } } } },
    },
  },
  resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
};
const system = new Resolver(document).resolveContextsToDesignSystem();
const input = '@layer tokens { @toghen contexts ds; }\n.c { background-color: t(color.bg); color: t(color.text); }\n';
const tokens = (await postcss([toghenPlugin({ system, onUnresolved: 'throw' })]).process(input, { from: undefined })).css;
const app = ':root { color-scheme: light dark; }\n.dark { color-scheme: dark; }\n.light { color-scheme: light; }\n';

// Vite 8.3.8's `build.cssTarget` default, 'baseline-widely-available' (chrome111, edge111, firefox114, safari16.4,
// ios16.4), as its convertTargets() hands it to Lightning CSS; Vite minifies with it after PostCSS.
const v = (major, minor = 0) => (major << 16) | (minor << 8);
const targets = { chrome: v(111), edge: v(111), firefox: v(114), safari: v(16, 4), ios_saf: v(16, 4) };
const lower = (css) => {
  const r = transform({ filename: 'tokens.css', code: Buffer.from(css), minify: true, targets });
  if (r.warnings.length) throw new Error(JSON.stringify(r.warnings));
  return Buffer.from(r.code).toString();
};

const body = `<body>
<div id="root"><span class="c" id="r">x</span></div>
<div class="dark"><span class="c" id="d">x</span></div>
<div class="light"><span class="c" id="l">x</span></div>
</body></html>
`;
const page = (...sheets) =>
  `<!doctype html><html lang="en"><head>\n${sheets.map((s) => `<style>\n${s.trim()}\n</style>`).join('\n')}\n</head>${body}`;
const here = path.dirname(fileURLToPath(import.meta.url));
writeFileSync(path.join(here, 'native.html'), page(tokens + app));
writeFileSync(path.join(here, 'lowered.html'), page(lower(tokens + app)));
writeFileSync(path.join(here, 'lowered-no-scheme.html'), page(lower(tokens), app));
