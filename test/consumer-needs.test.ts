import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, load, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

// Two needs met on top of the component model: a token a mixin does not write, and a mixin that mixes source files.
// Synthetic tokens in the W3C structured shapes.
const px = (value: number) => ({ value, unit: 'px' });
const srgb = (r: number, g: number, b: number) => ({ colorSpace: 'srgb', components: [r, g, b] });
const color = (value: unknown) => ({ $type: 'color', $value: value });
const num = (value: number, extensions?: unknown) => ({
  $type: 'number',
  $value: value,
  ...(extensions ? { $extensions: extensions } : {}),
});
const notWritten = { 'com.toghen': { css: { write: false } } };

function doc(thing: Record<string, unknown>, parts?: unknown): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: { base: { sources: [{ ui: { ...(parts ? { $extensions: { 'com.toghen': { css: { parts } } } } : {}), thing } }] } },
    modifiers: {},
    resolutionOrder: [{ $ref: '#/sets/base' }],
  };
}

const norm = (css: string) => css.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }').trim();

async function run(input: string, document: ResolverDocument, options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn', ...options })]).process(input, { from: undefined });
  return { css: result.css, warnings: result.warnings().map((w) => w.text) };
}

function body(css: string, name: string): string | undefined {
  let found: string | undefined;
  postcss.parse(css).walkAtRules('mixin', (rule) => {
    if (rule.params === name)
      found = norm(rule.toString())
        .replace(/^@mixin \S+ \{ /, '')
        .replace(/ \}$/, '');
  });
  return found;
}

describe("a token with css.write false is not written by its group's mixin", () => {
  const thing = () => ({
    background: color(srgb(0.1, 0.4, 0.9)),
    scale: num(0.6, notWritten),
    minHeight: { $type: 'dimension', $value: px(32) },
  });

  it('leaves the token out of the mixin, still declares its property, and reads it with t() as before', async () => {
    const out = await run(
      '@toghen mixins; :root { @toghen declare ui.thing; } .x { transform: scale(t(ui.thing.scale)); scale: t(ui.thing.scale as value); }',
      doc(thing()),
    );
    assert.deepEqual(out.warnings, []);
    assert.equal(
      body(out.css, '--ui-thing'),
      'background: var(--ui-thing-background, #1a66e6); min-height: var(--ui-thing-min-height, 32px); @contents',
    );
    assert.match(out.css, /--ui-thing-scale: 0\.6/);
    assert.match(out.css, /transform: scale\(var\(--ui-thing-scale, 0\.6\)\)/);
    assert.match(out.css, /; scale: 0\.6;/);
  });

  it('writes the token as before when the flag is absent or not false', async () => {
    const plain = { ...thing(), scale: num(0.6), opacity: num(1, { 'com.toghen': { css: { write: true } } }) };
    const out = await run('@toghen mixins;', doc(plain));
    assert.match(body(out.css, '--ui-thing')!, /scale: var\(--ui-thing-scale, 0\.6\)/);
    assert.match(body(out.css, '--ui-thing')!, /opacity: var\(--ui-thing-opacity, 1\)/);
  });

  it('keeps a key that is no property out of a mixin without refusing the whole group', async () => {
    const out = await run(
      '@toghen mixins;',
      doc({ background: color(srgb(0.1, 0.4, 0.9)), weight: num(2, notWritten), emphasis: num(3, notWritten) }),
    );
    assert.equal(body(out.css, '--ui-thing'), 'background: var(--ui-thing-background, #1a66e6); @contents');
    // without the flag a key that is no property makes the group no mixin
    const bare = await run('@toghen mixins;', doc({ background: color(srgb(0.1, 0.4, 0.9)), emphasis: num(3) }));
    assert.equal(body(bare.css, '--ui-thing'), undefined);
  });

  it('does not set the property of a part token with no twin when that token carries the flag', async () => {
    const withPart = {
      background: color(srgb(0.1, 0.4, 0.9)),
      hover: { outlineWidth: { $type: 'dimension', $value: px(2) }, scale: num(0.9, notWritten) },
    };
    const out = await run('@toghen mixins;', doc(withPart, { state: { hover: ':hover' } }));
    assert.equal(body(out.css, '--ui-thing-hover'), 'outline-width: var(--ui-thing-hover-outline-width, 2px)');
  });
});

describe('a mixin that mixes source files says so', () => {
  const files: Record<string, unknown> = {
    'ds.resolver.json': {
      version: '2025-11-01',
      name: 'ds',
      sets: { base: { sources: [{ $ref: './palette.tokens.json' }, { $ref: './input.tokens.json' }] } },
      modifiers: {},
      resolutionOrder: [{ $ref: '#/sets/base' }],
    },
    'palette.tokens.json': { input: { background: color(srgb(1, 1, 1)) }, ink: color(srgb(0.1, 0.1, 0.1)) },
    'input.tokens.json': {
      input: { minHeight: { $type: 'dimension', $value: px(32) }, color: color('{ink}') },
      solo: { minHeight: { $type: 'dimension', $value: px(8) } },
    },
  };
  const loaded = () => load('ds.resolver.json', { read: async (location) => JSON.stringify(files[location.replace(/^\.\//, '')]) });
  const message =
    '[@toghen/postcss] The mixin "--input" mixes tokens from two files: "palette.tokens.json" defines background, "input.tokens.json" defines minHeight, color. Rename one, or give component groups a namespace.';

  it('warns once, naming the group and the files, and still writes the mixin', async () => {
    const { document, origins } = await loaded();
    const out = await run('@toghen mixins;', document, { origins });
    assert.deepEqual(out.warnings, [message]);
    assert.match(body(out.css, '--input')!, /background: var\(--input-background, #ffffff\); min-height: var\(--input-min-height, 32px\)/);
    assert.equal(body(out.css, '--solo') !== undefined, true);
  });

  it('is a warning whatever onUnresolved says, and never an error', async () => {
    const { document, origins } = await loaded();
    for (const onUnresolved of ['throw', 'ignore', 'warn'] as const) {
      const out = await run('@toghen mixins;', document, { origins, onUnresolved });
      assert.deepEqual(out.warnings, [message], onUnresolved);
    }
  });

  it('checks nothing without origins', async () => {
    const { document } = await loaded();
    assert.deepEqual((await run('@toghen mixins;', document)).warnings, []);
  });

  it("says nothing when the group's tokens come from one file, or a file only overrides one", async () => {
    const { document, origins } = await loaded();
    // `input.color` is also written in a later file (an override in another context): the first origin is its file
    const overridden = new Map(origins);
    overridden.set('input.background', ['input.tokens.json']);
    overridden.set('input.minHeight', ['input.tokens.json', 'dark.tokens.json']);
    overridden.set('input.color', ['input.tokens.json', 'palette.tokens.json']);
    assert.deepEqual((await run('@toghen mixins;', document, { origins: overridden })).warnings, []);
  });

  it('does not count a token the mixin does not write', async () => {
    const { document, origins } = await loaded();
    (document.sets as any).base.sources.at(-1).input = undefined;
    const flagged = structuredClone(document) as any;
    for (const source of flagged.sets.base.sources) {
      if (source.input?.background) source.input.background.$extensions = notWritten;
    }
    assert.deepEqual((await run('@toghen mixins;', flagged, { origins })).warnings, []);
  });
});
