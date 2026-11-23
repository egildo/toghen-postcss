/**
 * Lightning CSS after the plugin: the guide's "When Lightning CSS runs after the plugin". Vite 8 minifies a production
 * build's CSS with it by default, after PostCSS. Every golden output, and the two forms no golden holds (a chain's
 * empty flags, a `light-dark()` pair), go through Lightning CSS at three settings and must keep what the cascade
 * reads. Lightning CSS is pinned at 1.33.0, so a release that changes any of this fails here first.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule } from 'postcss';
import { Features, transform, type CustomAtRules, type TransformOptions } from 'lightningcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const OUTPUT = fileURLToPath(new URL('./example-output/', import.meta.url));

// Vite 8.3.8's default `build.cssTarget`, 'baseline-widely-available' (chrome111, edge111, firefox114, safari16.4,
// ios16.4), as Vite hands it to Lightning CSS when it minifies.
const version = (major: number, minor = 0) => (major << 16) | (minor << 8);
const VITE = { chrome: version(111), edge: version(111), firefox: version(114), safari: version(16, 4), ios_saf: version(16, 4) };

type Setting = Omit<TransformOptions<CustomAtRules>, 'filename' | 'code'>;
const NONE: Setting = {};
const LOWERED: Setting = { targets: VITE, minify: true };
const EXCLUDED: Setting = { targets: VITE, minify: true, exclude: Features.LightDark };
const SETTINGS: [string, Setting][] = [
  ['with no targets', NONE],
  ["at Vite 8's default targets, minified", LOWERED],
  ["at Vite 8's default targets, minified, with light-dark() excluded", EXCLUDED],
];

function lightning(css: string, setting: Setting) {
  const result = transform({ filename: 'in.css', code: Buffer.from(css), ...setting });
  return { css: Buffer.from(result.code).toString(), warnings: result.warnings.map((warning) => warning.message) };
}

/** The at-rules the plugin writes for the mixins polyfill, which Lightning CSS keeps in place as unknown rules. */
const KNOWN = /^Unknown at rule: @(mixin|apply|contents)$/;

/** Every custom property a sheet declares, and those it declares with an empty value. */
function properties(css: string) {
  const declared = new Set<string>();
  const empty = new Set<string>();
  postcss.parse(css).walkDecls((decl) => {
    if (!decl.prop.startsWith('--')) return;
    declared.add(decl.prop);
    if (decl.value.trim() === '') empty.add(decl.prop);
  });
  return { declared, empty };
}

/** The layers in the order the cascade ranks them, which is the order each full name first appears in. */
function layers(css: string): string[] {
  const names: string[] = [];
  postcss.parse(css).walkAtRules('layer', (rule) => {
    const outer: string[] = [];
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      if (parent.type === 'atrule' && (parent as AtRule).name === 'layer') outer.unshift((parent as AtRule).params);
    }
    for (const name of rule.params.split(',')) {
      const full = [...outer, name.trim()].join('.');
      if (!names.includes(full)) names.push(full);
    }
  });
  return names;
}

// ---- the two forms no golden holds, written by the plugin from synthetic documents ----

const srgb = (v: number) => ({ colorSpace: 'srgb', components: [v, v, v] });
const color = (value: unknown) => ({ $type: 'color', $value: value });
const attribute = (name: string) => ({ 'com.toghen': { css: { selector: `[data-${name}='{context}']` } } });

async function plugin(document: ResolverDocument, options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const input = '@layer tokens { @toghen contexts ds; }';
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'throw', ...options })]).process(input, { from: undefined });
  assert.deepEqual(result.warnings(), []);
  return result.css;
}

// A theme spelled with `lightDark`: each colour it varies is one light-dark() pair in the defaults.
const PAIR = await plugin({
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
} as ResolverDocument);

// A conditional reference under `bind: 'chain'`: `t` is `{y}` under scheme=dark and a literal otherwise, `y` varies on
// contrast, so each scheme context declares a flag, empty where it is set.
const CHAINED = await plugin(
  {
    version: '2025-11-01',
    name: 'ds',
    sets: { base: { sources: [{ y: color(srgb(0.1)), t: color(srgb(0.7)) }] } },
    modifiers: {
      scheme: { default: 'light', contexts: { light: [], dark: [{ t: { $value: '{y}' } }] }, $extensions: attribute('scheme') },
      contrast: { default: 'normal', contexts: { normal: [], high: [{ y: { $value: srgb(0.2) } }] }, $extensions: attribute('contrast') },
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/scheme' }, { $ref: '#/modifiers/contrast' }],
  } as ResolverDocument,
  { references: 'var', bind: 'chain' },
);

const GOLDENS = readdirSync(OUTPUT, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.out.css'))
  .sort();
const SHEETS: [string, string][] = [
  ...GOLDENS.map((file): [string, string] => [file, readFileSync(`${OUTPUT}${file}`, 'utf8')]),
  ['a light-dark() modifier', PAIR],
  ["a conditional reference under bind: 'chain'", CHAINED],
];

describe('Lightning CSS after the plugin', () => {
  it('has something to check: the golden files, layers, empty flags and a light-dark() pair', () => {
    assert.ok(GOLDENS.includes('tutorial.out.css') && GOLDENS.includes('tutorial/hover/button.out.css'));
    assert.deepEqual(layers(PAIR), ['tokens', 'tokens.defaults', 'tokens.theme']);
    assert.match(PAIR, /--color-bg: light-dark\(#ffffff, #000000\)/);
    assert.deepEqual([...properties(CHAINED).empty].sort(), ['--scheme--dark', '--scheme--light']);
  });

  for (const [name, setting] of SETTINGS) {
    describe(name, () => {
      for (const [sheet, css] of SHEETS) {
        it(sheet, () => {
          const out = lightning(css, setting);
          const unknown = out.warnings.filter((warning) => !KNOWN.test(warning));
          assert.deepEqual(unknown, []);
          const before = properties(css);
          const after = properties(out.css);
          for (const property of before.declared) assert.ok(after.declared.has(property), `${property} is no longer declared`);
          for (const property of before.empty) assert.ok(after.empty.has(property), `${property} lost its empty value`);
          assert.deepEqual(layers(out.css), layers(css));
          if (css.includes('light-dark(')) {
            const lowered = setting === LOWERED;
            assert.equal(out.css.includes('light-dark('), !lowered, lowered ? 'light-dark() was not lowered' : 'light-dark() was lowered');
          }
        });
      }
    });
  }

  it("lowers a pair at Vite 8's targets into flags it declares only beside a color-scheme in the same sheet", () => {
    const alone = lightning(PAIR, LOWERED).css;
    assert.match(alone, /--color-bg:var\(--lightningcss-light,#fff\)var\(--lightningcss-dark,#000\)/);
    assert.doesNotMatch(alone, /--lightningcss-(light|dark):/);
    const withScheme = lightning(`${PAIR}\n:root { color-scheme: light dark; }`, LOWERED).css;
    assert.match(withScheme, /:root\{--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light dark\}/);
    assert.match(withScheme, /@media \(prefers-color-scheme:dark\)\{:root\{--lightningcss-light: ;--lightningcss-dark:initial\}\}/);
  });

  it("drops the comments of descriptions: 'comment', even with no targets", () => {
    const css = readFileSync(`${OUTPUT}descriptions-comment.out.css`, 'utf8');
    assert.match(css, /\/\*/);
    assert.doesNotMatch(lightning(css, NONE).css, /\/\*/);
  });

  it('reads a number after a dot as a number, so it must never see a path before the plugin does', () => {
    // Not a feature: the guard on the guide's order rule (Toghen first). PostCSS keeps the text.
    for (const [path, printed] of [
      ['a.b.500', 'a.b.5'],
      ['a.b.100', 'a.b.1'],
      ['a.0.c', 'a0.c'],
    ]) {
      assert.equal(lightning(`.a { color: t(${path}); }`, NONE).css, `.a {\n  color: t(${printed});\n}\n`);
    }
  });
});
