import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, cssPropertyName, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

// `bind: 'chain'`: see reference.md, "`bind` (option)". Every document here is synthetic and spells its values in the
// W3C structured shapes.
const srgb = (r: number, g: number, b: number) => ({ colorSpace: 'srgb', components: [r / 255, g / 255, b / 255] });
const px = (value: number) => ({ value, unit: 'px' });
const color = (value: unknown) => ({ $type: 'color', $value: value });

type Contexts = Record<string, object | null>;
const attribute = (name: string) => ({ 'com.toghen': { css: { selector: `[data-${name}='{context}']` } } });

/** A modifier: its default, then each context with the tokens it overrides (`null` defines nothing). */
function modifier(name: string, def: string, contexts: Contexts, extensions: object = attribute(name)) {
  return {
    default: def,
    contexts: Object.fromEntries(Object.entries(contexts).map(([context, tokens]) => [context, tokens ? [tokens] : []])),
    $extensions: extensions,
  };
}

function world(sources: object, modifiers: Record<string, ReturnType<typeof modifier>>): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: { base: { sources: [sources] } },
    modifiers,
    resolutionOrder: [{ $ref: '#/sets/base' }, ...Object.keys(modifiers).map((m) => ({ $ref: `#/modifiers/${m}` }))],
  } as ResolverDocument;
}

const flat = (css: string) => css.replace(/\s+/g, ' ').trim();

async function run(
  css: string,
  document: ResolverDocument,
  options: Partial<ToghenPluginOptions> = {},
  tweak: (system: ReturnType<Resolver['resolveContextsToDesignSystem']>) => void = () => {},
) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  tweak(system);
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn', ...options })]).process(css, { from: undefined });
  return { css: flat(result.css), raw: result.css, warnings: result.warnings().map((w) => w.text) };
}

const CHAIN = { references: 'var', bind: 'chain' } as const;

// `alert` is a fixed red in the dark scheme and otherwise follows `base`, which contrast changes; `copy` is a pure alias.
const twoAxes = (copy = false) =>
  world(
    { tone: { base: color(srgb(17, 17, 17)), alert: color('{tone.base}'), ...(copy ? { copy: color('{tone.alert}') } : {}) } },
    {
      scheme: modifier('scheme', 'light', { light: null, dark: { tone: { alert: { $value: srgb(170, 0, 0) } } } }),
      contrast: modifier('contrast', 'normal', { normal: null, high: { tone: { base: { $value: srgb(34, 34, 34) } } } }),
    },
  );

// The conditional reference of the reference's worked example: `t` is `{y}` under scheme=dark and a literal otherwise;
// `y` varies on contrast. Top-level tokens, so the properties are `--y` and `--t`.
const conditional = (under: 'dark' | 'light' = 'dark') =>
  world(
    { y: color(srgb(17, 17, 17)), t: color(srgb(170, 170, 170)) },
    {
      scheme: modifier(
        'scheme',
        'light',
        under === 'dark'
          ? { light: null, dark: { t: { $value: '{y}' } } }
          : { light: { t: { $value: '{y}' } }, dark: { t: { $value: srgb(0, 170, 0) } } },
      ),
      contrast: modifier('contrast', 'normal', { normal: null, high: { y: { $value: srgb(34, 34, 34) } } }),
    },
  );

// Two literal links and a base; `light` and `neutral` define nothing.
const twoLinks = () =>
  world(
    { button: { bg: color(srgb(230, 230, 230)) } },
    {
      scheme: modifier('scheme', 'light', { light: null, dark: { button: { bg: { $value: srgb(51, 51, 51) } } } }),
      tone: modifier('tone', 'neutral', { neutral: null, primary: { button: { bg: { $value: srgb(26, 102, 230) } } } }),
    },
  );

describe("bind: 'chain' — what is written", () => {
  it('writes a link per link, a head that composes them, and a base that is a reference as the last fallback (layered)', async () => {
    const out = await run('@layer tokens { @toghen contexts ds; }', twoAxes(), CHAIN);
    const head = 'var(--tone-alert--scheme, var(--tone-base))';
    assert.equal(
      out.css,
      [
        '@layer tokens { @layer defaults, scheme, contrast;',
        `@layer defaults { :root { --tone-base: #111111; --tone-alert: ${head} } }`,
        '@layer scheme {',
        // `light` defines nothing, so it resets the link: a light island inside a dark panel must not inherit its red.
        `[data-scheme='light'] { --tone-alert--scheme: initial; --tone-alert: ${head} }`,
        `[data-scheme='dark'] { --tone-alert--scheme: #aa0000; --tone-alert: ${head} } }`,
        // `contrast` is a modifier the token depends on only through its base: it has no link, so it writes the head alone.
        '@layer contrast {',
        `[data-contrast='normal'] { --tone-base: #111111; --tone-alert: ${head} }`,
        `[data-contrast='high'] { --tone-base: #222222; --tone-alert: ${head} } } }`,
      ].join(' '),
    );
    assert.deepEqual(out.warnings, []);
  });

  it('writes a token with two links and a base, sparse contexts resetting their link, in the order the resolver makes them win', async () => {
    const out = await run('@toghen contexts ds;', twoLinks(), CHAIN);
    const head = 'var(--button-bg--tone, var(--button-bg--scheme, #e6e6e6))';
    assert.equal(
      out.css,
      [
        `:root { --button-bg: ${head} }`,
        `[data-scheme='light'] { --button-bg--scheme: initial; --button-bg: ${head} }`,
        `[data-scheme='dark'] { --button-bg--scheme: #333333; --button-bg: ${head} }`,
        `[data-tone='neutral'] { --button-bg--tone: initial; --button-bg: ${head} }`,
        `[data-tone='primary'] { --button-bg--tone: #1a66e6; --button-bg: ${head} }`,
      ].join(' '),
    );
  });

  it('writes a link in the defaults when its modifier has a default context that defines it', async () => {
    const d = world(
      { button: { bg: color(srgb(230, 230, 230)) } },
      {
        scheme: modifier('scheme', 'dark', { light: null, dark: { button: { bg: { $value: srgb(51, 51, 51) } } } }),
        tone: modifier('tone', 'neutral', { neutral: null, primary: { button: { bg: { $value: srgb(26, 102, 230) } } } }),
      },
    );
    const out = await run('@toghen contexts ds;', d, CHAIN);
    assert.match(
      out.css,
      /^:root \{ --button-bg--scheme: #333333; --button-bg: var\(--button-bg--tone, var\(--button-bg--scheme, #e6e6e6\)\) \}/,
    );
  });

  it('writes a pure alias of a chained token as the alias it is, in the blocks of every modifier it depends on through', async () => {
    const out = await run('@toghen contexts ds;', twoAxes(true), CHAIN);
    // `copy` has no link, and depends on scheme and contrast through `alert`.
    assert.match(
      out.css,
      /\[data-scheme='dark'\] \{ --tone-alert--scheme: #aa0000; --tone-alert: var\(--tone-alert--scheme, var\(--tone-base\)\); --tone-copy: var\(--tone-alert\) \}/,
    );
    assert.match(
      out.css,
      /\[data-contrast='high'\] \{ --tone-base: #222222; --tone-alert: var\(--tone-alert--scheme, var\(--tone-base\)\); --tone-copy: var\(--tone-alert\) \}/,
    );
    assert.doesNotMatch(out.css, /--tone-copy--/);
  });

  it("puts a token a modifier is behind a default in that modifier's blocks, which comparing values at the defaults misses", async () => {
    // scheme defaults to `dark`, which fixes `alert`: with the defaults hiding it, contrast changes neither
    // `alert` nor `copy` as resolved values, and both still depend on it.
    const d = world(
      { tone: { base: color(srgb(17, 17, 17)), alert: color('{tone.base}'), copy: color('{tone.alert}') } },
      {
        scheme: modifier('scheme', 'dark', { dark: { tone: { alert: { $value: srgb(170, 0, 0) } } }, light: null }),
        contrast: modifier('contrast', 'normal', { normal: null, high: { tone: { base: { $value: srgb(34, 34, 34) } } } }),
      },
    );
    const without = await run('@toghen contexts ds;', d, { references: 'var' });
    assert.match(without.css, /\[data-contrast='high'\] \{ --tone-base: #222222 \}/);
    const out = await run('@toghen contexts ds;', d, CHAIN);
    assert.match(out.css, /\[data-contrast='high'\] \{ --tone-base: #222222; --tone-alert: [^}]*--tone-copy: var\(--tone-alert\) \}/);
  });

  it("writes a conditional link in the flag form: the reference's worked output, whitespace aside", async () => {
    const out = await run('@toghen contexts ds;', conditional(), CHAIN);
    const guarded = '--t--scheme--dark: var(--scheme--dark) var(--y); --t--scheme: var(--t--scheme--dark); --t: var(--t--scheme, #aaaaaa)';
    assert.equal(
      out.css,
      [
        `:root { --y: #111111; ${guarded} }`,
        `[data-scheme='light'] { --scheme--light: ; --scheme--dark: initial; ${guarded} }`,
        `[data-scheme='dark'] { --scheme--light: initial; --scheme--dark: ; ${guarded} }`,
        `[data-contrast='normal'] { --y: #111111; ${guarded} }`,
        `[data-contrast='high'] { --y: #222222; ${guarded} }`,
      ].join(' '),
    );
    assert.deepEqual(out.warnings, []);
  });

  it('writes an empty flag as a declaration that survives serialisation and parses back empty', async () => {
    const out = await run('@toghen contexts ds;', conditional(), CHAIN);
    assert.match(out.raw, /--scheme--dark:\s*;/);
    const empty: string[] = [];
    postcss.parse(out.raw).walkDecls(/^--scheme--/, (decl) => {
      if (decl.value.trim() === '') empty.push(decl.prop);
    });
    // `dark` is on in its own block and `light` in its: one empty flag per block of the modifier.
    assert.deepEqual(empty, ['--scheme--light', '--scheme--dark']);
  });

  it("turns on the default context's flag in the defaults when its step is defined, which no element otherwise says", async () => {
    const out = await run('@toghen contexts ds;', conditional('light'), CHAIN);
    // The reference refers to y under the default context, `light`; with nothing setting scheme, that is the context.
    assert.match(
      out.css,
      /^:root \{ --scheme--light: ; --y: #111111; --t--scheme--light: var\(--scheme--light\) var\(--y\); --t--scheme--dark: var\(--scheme--dark\) #00aa00;/,
    );
    // and a dark subtree turns it off again
    assert.match(out.css, /\[data-scheme='dark'\] \{ --scheme--light: initial; --scheme--dark: ; /);
  });

  it('writes a link plain when its values are literals or follow only a token of its own modifier', async () => {
    const d = world(
      { s: color(srgb(17, 17, 17)), t: color(srgb(170, 170, 170)) },
      {
        scheme: modifier('scheme', 'light', { light: null, dark: { s: { $value: srgb(0, 0, 0) }, t: { $value: '{s}' } } }),
        tone: modifier('tone', 'neutral', { neutral: null, primary: { t: { $value: srgb(0, 0, 170) } } }),
      },
    );
    const out = await run('@toghen contexts ds;', d, CHAIN);
    assert.match(
      out.css,
      /\[data-scheme='dark'\] \{ --s: #000000; --t--scheme: var\(--s\); --t: var\(--t--tone, var\(--t--scheme, #aaaaaa\)\) \}/,
    );
    assert.doesNotMatch(out.css, /--scheme--dark/);
  });

  it('names a link by the head and the modifier, escaping what an identifier cannot hold', async () => {
    const d = world(
      { tone: { a: color(srgb(170, 170, 170)) } },
      {
        'c:d': modifier('c:d', 'light', { light: null, dark: { tone: { a: { $value: srgb(0, 0, 0) } } } }, attribute('cd')),
        'a.b': modifier('a.b', 'x', { x: null, y: { tone: { a: { $value: srgb(0, 0, 170) } } } }, attribute('ab')),
      },
    );
    const out = await run('@toghen contexts ds;', d, CHAIN);
    assert.match(
      out.css,
      /\[data-cd='dark'\] \{ --tone-a--c\\:d: #000000; --tone-a: var\(--tone-a--a\\\.b, var\(--tone-a--c\\:d, #aaaaaa\)\) \}/,
    );
    assert.match(out.css, /\[data-ab='y'\] \{ --tone-a--a\\\.b: #0000aa;/);
  });
});

describe("bind: 'chain' — values", () => {
  it('spells a step through its type: structured colour, dimension, fontFamily array, and a hex string normalised', async () => {
    const d = world(
      {
        ink: color(srgb(17, 17, 17)),
        size: { gap: { $type: 'dimension', $value: px(8) } },
        face: { $type: 'fontFamily', $value: ['Inter', 'sans-serif'] },
        // a document may spell a colour as a string: it is normalised before it is spelled
        tint: color('#abc'),
      },
      {
        scheme: modifier('scheme', 'light', {
          light: null,
          dark: { size: { gap: { $value: px(12) } }, face: { $value: ['Mono', 'monospace'] }, tint: { $value: '#ABCDEF' } },
        }),
        tone: modifier('tone', 'neutral', {
          neutral: null,
          primary: { size: { gap: { $value: px(16) } }, face: { $value: ['Serif', 'serif'] }, tint: { $value: srgb(0, 0, 170) } },
        }),
      },
    );
    const out = await run('@toghen contexts ds;', d, CHAIN);
    assert.match(
      out.css,
      /\[data-scheme='dark'\] \{[^}]*--size-gap--scheme: 12px; --size-gap: var\(--size-gap--tone, var\(--size-gap--scheme, 8px\)\)/,
    );
    assert.match(out.css, /--face--scheme: Mono, monospace; --face: var\(--face--tone, var\(--face--scheme, Inter, sans-serif\)\)/);
    assert.match(out.css, /--face--tone: Serif, serif;/);
    assert.match(out.css, /--tint--scheme: #abcdef; --tint: var\(--tint--tone, var\(--tint--scheme, #aabbcc\)\)/);
    assert.doesNotMatch(out.css, /object Object|toghen\(/);
  });

  it('spells the steps the core gives in the stored shape: hex and dimension strings, typed by their group', async () => {
    const d = world(
      { ui: { $type: 'color', fill: { $value: '#eeeeee' } }, gap: { $type: 'dimension', md: { $value: '8px' } } },
      {
        scheme: modifier('scheme', 'light', {
          light: null,
          dark: { ui: { fill: { $value: '#222222' } }, gap: { md: { $value: '0.75rem' } } },
        }),
        tone: modifier('tone', 'neutral', {
          neutral: null,
          primary: { ui: { fill: { $value: '#0000AA' } }, gap: { md: { $value: '12px' } } },
        }),
      },
    );
    const out = await run('@toghen contexts ds;', d, CHAIN);
    assert.match(
      out.css,
      /\[data-scheme='dark'\] \{[^}]*--ui-fill--scheme: #222222; --ui-fill: var\(--ui-fill--tone, var\(--ui-fill--scheme, #eeeeee\)\)/,
    );
    assert.match(out.css, /--ui-fill--tone: #0000aa;/);
    assert.match(out.css, /--gap-md--scheme: 0\.75rem; --gap-md: var\(--gap-md--tone, var\(--gap-md--scheme, 8px\)\)/);
    assert.match(out.css, /--gap-md--tone: 12px;/);
    assert.doesNotMatch(out.css, /object Object|toghen\(/);
  });

  it('writes a composite link whole, a reference inside a member as a var() in place', async () => {
    const shadow = (color: unknown, blur: number) => ({ color, offsetX: px(0), offsetY: px(4), blur: px(blur) });
    const d = world(
      { shade: color(srgb(0, 0, 0)), card: { $type: 'shadow', $value: shadow(srgb(0, 0, 0), 4) } },
      {
        scheme: modifier('scheme', 'light', { light: null, dark: { card: { $value: shadow('{shade}', 12) } } }),
        tone: modifier('tone', 'neutral', { neutral: null, primary: { card: { $value: shadow(srgb(0, 0, 170), 8) } } }),
      },
    );
    const out = await run('@toghen contexts ds;', d, CHAIN);
    assert.match(out.css, /--card--scheme: 0px 4px 12px var\(--shade\);/);
    assert.match(out.css, /--card--tone: 0px 4px 8px #0000aa;/);
    assert.match(out.css, /--card: var\(--card--tone, var\(--card--scheme, 0px 4px 4px #000000\)\)/);
  });

  it("writes a reference as the target's value under references: resolve, where the target depends on nothing", async () => {
    const d = world(
      { ink: color(srgb(17, 17, 17)), t: color(srgb(170, 170, 170)) },
      {
        scheme: modifier('scheme', 'light', { light: null, dark: { t: { $value: '{ink}' } } }),
        tone: modifier('tone', 'neutral', { neutral: null, primary: { t: { $value: srgb(0, 0, 170) } } }),
      },
    );
    const out = await run('@toghen contexts ds;', d, { references: 'resolve', bind: 'chain' });
    assert.match(out.css, /\[data-scheme='dark'\] \{ --t--scheme: #111111; --t: var\(--t--tone, var\(--t--scheme, #aaaaaa\)\) \}/);
    assert.deepEqual(out.warnings, []);
  });

  it('refuses a value with no CSS spelling as it does elsewhere, through onUnresolved, naming the token', async () => {
    const gradient = (stop: number) => ({
      $type: 'gradient',
      $value: [
        { color: srgb(0, 0, 0), position: 0 },
        { color: srgb(255, 255, 255), position: stop },
      ],
    });
    const d = world(
      { g: gradient(1) },
      {
        scheme: modifier('scheme', 'light', { light: null, dark: { g: gradient(0.5) } }),
        tone: modifier('tone', 'neutral', { neutral: null, primary: { g: gradient(0.2) } }),
      },
    );
    const out = await run('@toghen contexts ds;', d, CHAIN);
    assert.match(out.warnings[0], /^\[@toghen\/postcss\] Cannot write token "ds\.g"/);
    assert.match(out.css, /@toghen contexts ds/);
  });
});

describe("bind: 'chain' with registerProperties", () => {
  it("registers a token's own head, never a link or a flag", async () => {
    const out = await run('@toghen contexts ds;', twoAxes(), { ...CHAIN, registerProperties: true });
    assert.match(out.css, /@property --tone-alert \{/);
    assert.match(out.css, /@property --tone-base \{/);
    assert.doesNotMatch(out.css, /@property --tone-alert--/);
    const flags = await run('@toghen contexts ds;', conditional(), { ...CHAIN, registerProperties: true });
    assert.doesNotMatch(flags.css, /@property --(?:t--|scheme--)/);
    assert.match(flags.css, /@property --t \{/);
  });

  it('writes no @property, and the flags and links as they are, by default', async () => {
    const out = await run('@toghen contexts ds;', conditional(), CHAIN);
    assert.doesNotMatch(out.css, /@property/);
    assert.match(out.css, /\[data-scheme='light'\] \{ --scheme--light: ; --scheme--dark: initial;/);
  });
});

describe("bind: 'chain' — not chained", () => {
  // `card` has its blur overridden by density alone: the resolver merges the partial onto the whole shadow beneath it.
  const partial = () =>
    world(
      { card: { $type: 'shadow', $value: { color: srgb(0, 0, 0), offsetX: px(0), offsetY: px(4), blur: px(4) } } },
      {
        density: modifier('density', 'regular', { regular: null, compact: { card: { $value: { blur: px(2) } } } }),
      },
    );

  it('writes a token whose context overrides part of a composite as without the option, and warns', async () => {
    const without = await run('@toghen contexts ds;', partial(), { references: 'var' });
    const out = await run('@toghen contexts ds;', partial(), CHAIN);
    assert.equal(out.raw, without.raw);
    assert.deepEqual(out.warnings, [
      '[@toghen/postcss] Cannot chain "ds.card" ($value): $value of "card" is overridden in part: an object merged onto the object beneath it differs from the incoming object alone. Modifiers: density. Contexts: density=compact. Written as resolved values, bound early: the later block wins whole where its modifiers are set on different elements.',
    ]);
  });

  it('writes a token as without the option under references: resolve when it refers to a token that moves, and warns instead of the two-modifier warning', async () => {
    const without = await run('@toghen contexts ds;', twoAxes(true), { references: 'resolve' });
    assert.match(without.warnings[0], /--tone-alert changes under 'scheme' and 'contrast'/);

    const out = await run('@toghen contexts ds;', twoAxes(true), { references: 'resolve', bind: 'chain' });
    assert.equal(out.raw, without.raw);
    // `alert` follows `base`, which contrast changes, so it gets this warning and not the two-modifier one.
    // `copy` has no link: it is written as today, and its warning is today's.
    assert.deepEqual(out.warnings, [
      `[@toghen/postcss] Cannot chain "ds.tone.alert": it refers to "ds.tone.base", which depends on contrast, and references: 'resolve' writes that value bound early. Use references: 'var'.`,
      without.warnings[1],
    ]);
    assert.match(without.warnings[1], /--tone-copy changes under/);
    assert.match(without.warnings[0], /--tone-alert changes under/);
  });

  it('warns of a hole, and writes the head without a final fallback', async () => {
    // x is defined by no set: only scheme=dark and tone=primary give it a value
    const d = world(
      { a: color(srgb(17, 17, 17)) },
      {
        scheme: modifier('scheme', 'light', { light: null, dark: { x: color(srgb(170, 0, 0)) } }),
        tone: modifier('tone', 'neutral', { neutral: null, primary: { x: color(srgb(0, 0, 170)) } }),
      },
    );
    const out = await run('@toghen contexts ds;', d, CHAIN);
    assert.deepEqual(out.warnings, [
      `[@toghen/postcss] "ds.x" has no value where scheme=light and tone=neutral. The head is written without a final fallback there.`,
    ]);
    assert.match(out.css, /^:root \{ --a: #111111; --x: var\(--x--tone, var\(--x--scheme\)\) \}/);
    // the default's world has no such token, and the head is written there and in the blocks of both modifiers all the same
    assert.match(out.css, /\[data-tone='neutral'\] \{ --x--tone: initial; --x: var\(--x--tone, var\(--x--scheme\)\) \}/);
    assert.match(out.css, /\[data-scheme='dark'\] \{ --x--scheme: #aa0000; --x: var\(--x--tone, var\(--x--scheme\)\) \}/);
  });
});

describe("bind: 'chain' — errors", () => {
  it('is an error for a collection that was not built from a resolver, and leaves the directive in place', async () => {
    const unbuilt = (system: ReturnType<Resolver['resolveContextsToDesignSystem']>) => {
      system.getCollection('ds')!.resolver = undefined;
    };
    const out = await run('@toghen contexts ds;', twoAxes(), CHAIN, unbuilt);
    assert.deepEqual(out.warnings, [
      `[@toghen/postcss] Cannot write chains for "ds": collection 'ds' was not built from a resolver document, so it cannot say which modifier a token falls through to. Build it with resolveContextsToDesignSystem(), or leave out bind: 'chain'.`,
    ]);
    assert.equal(out.css, '@toghen contexts ds;');
    await assert.rejects(
      run('@toghen contexts ds;', twoAxes(), { ...CHAIN, onUnresolved: 'throw' }, unbuilt),
      /Cannot write chains for "ds"/,
    );
    // without the option the same collection is written as it always was
    assert.match((await run('@toghen contexts ds;', twoAxes(), { references: 'var' }, unbuilt)).css, /^:root/);
  });

  it("is an error when a link's property is the property of another token, and writes nothing", async () => {
    // `bg--tone` is a legal token name, and its head is the link `bg` writes for the modifier `tone`.
    const d = world(
      { button: { bg: color(srgb(230, 230, 230)), 'bg--tone': color(srgb(0, 0, 0)) } },
      {
        scheme: modifier('scheme', 'light', { light: null, dark: { button: { bg: { $value: srgb(51, 51, 51) } } } }),
        tone: modifier('tone', 'neutral', { neutral: null, primary: { button: { bg: { $value: srgb(26, 102, 230) } } } }),
      },
    );
    const out = await run('@toghen contexts ds;', d, CHAIN);
    assert.deepEqual(out.warnings, [
      `[@toghen/postcss] Cannot write the chain of "ds.button.bg": its link property --button-bg--tone is also the property of "ds.button.bg--tone". Rename one of them, or give propertyName an injective rule.`,
    ]);
    assert.equal(out.css, '@toghen contexts ds;');
    await assert.rejects(
      run('@toghen contexts ds;', d, { ...CHAIN, onUnresolved: 'throw' }),
      /link property --button-bg--tone is also the property of "ds\.button\.bg--tone"/,
    );
  });

  it("names a flag the same way when its property is another token's", async () => {
    const propertyName = (path: string) => (path === 'ds.k' ? '--scheme--dark' : cssPropertyName(path));
    const d = conditional();
    (d.sets as any).base.sources[0].k = color(srgb(1, 2, 3));
    const out = await run('@toghen contexts ds;', d, { ...CHAIN, propertyName });
    assert.match(
      out.warnings[0],
      /^\[@toghen\/postcss\] Cannot write the chain of "ds\.t": its flag property --scheme--dark is also the property of "ds\.k"\./,
    );
  });
});

describe("bind: 'chain' — with the rest of the plugin", () => {
  it('is the same output as today when the option is unset', async () => {
    const out = await run('@layer tokens { @toghen contexts ds; }', twoAxes(true), { references: 'var' });
    assert.equal(
      out.raw,
      "@layer tokens { @layer defaults, scheme, contrast; @layer defaults { :root { --tone-base: #111111; --tone-alert: var(--tone-base); --tone-copy: var(--tone-alert) } } @layer scheme { [data-scheme='light'] { --tone-alert: var(--tone-base); --tone-copy: var(--tone-alert) } [data-scheme='dark'] { --tone-alert: #aa0000; --tone-copy: var(--tone-alert) } } @layer contrast { [data-contrast='normal'] { --tone-base: #111111; --tone-alert: var(--tone-base); --tone-copy: var(--tone-alert) } [data-contrast='high'] { --tone-base: #222222; --tone-alert: var(--tone-base); --tone-copy: var(--tone-alert) } } }",
    );
    assert.deepEqual(out.warnings, []);
    const resolved = await run('@toghen contexts ds;', twoAxes(true));
    assert.match(resolved.warnings[0], /--tone-alert changes under 'scheme' and 'contrast'/);
  });

  it('changes only @toghen contexts: toghen(), @toghen path, @toghen declare and :toghen() are as they were', async () => {
    const css =
      '.a { color: toghen(ds.tone.alert, scheme=dark); } .b { @toghen declare ds.tone; } .c:toghen(scheme=dark) { color: toghen(ds.tone.copy); }';
    const without = await run(css, twoAxes(true), { references: 'var' });
    const out = await run(css, twoAxes(true), CHAIN);
    assert.equal(out.raw, without.raw);
  });

  it('reads the head by its own name, never a link', async () => {
    const out = await run('@layer tokens { @toghen contexts ds; } .a { color: toghen(ds.tone.alert); }', twoAxes(), CHAIN);
    assert.match(out.css, /--tone-alert--scheme: #aa0000;/);
    assert.match(out.css, /\.a \{ color: var\(--tone-alert, var\(--tone-base\)\); \}$/);
    assert.doesNotMatch(out.css, /\.a[^}]*--scheme/);
  });

  it('wraps a context spelled as an at-rule as it does today, and fills it with the same declarations', async () => {
    const d = twoAxes();
    (d.modifiers as any).scheme.$extensions = {
      'com.toghen': { css: { contexts: { dark: { atRule: '@media (prefers-color-scheme: dark)' } } } },
    };
    const out = await run('@toghen contexts ds;', d, CHAIN);
    const head = 'var(--tone-alert--scheme, var(--tone-base))';
    assert.equal(
      out.css,
      [
        `:root { --tone-base: #111111; --tone-alert: ${head} }`,
        // `light`, the default, has no spelling and no block
        `@media (prefers-color-scheme: dark) { :root { --tone-alert--scheme: #aa0000; --tone-alert: ${head} } }`,
        `[data-contrast='normal'] { --tone-base: #111111; --tone-alert: ${head} }`,
        `[data-contrast='high'] { --tone-base: #222222; --tone-alert: ${head} }`,
      ].join(' '),
    );
  });

  it("puts a description above the head and never above a link; a group's above the first thing written for its first token", async () => {
    const d = twoAxes();
    const tone = (d.sets as any).base.sources[0].tone;
    tone.$description = 'The tone group.';
    tone.alert.$description = 'The alert tone.';
    const out = await run('@toghen contexts ds;', d, { ...CHAIN, descriptions: 'comment' });
    const head = 'var(--tone-alert--scheme, var(--tone-base))';
    // defaults: the group's description above its first token (`base`), the alert's above the head
    assert.match(
      out.css,
      new RegExp(
        `^:root \\{ /\\* The tone group\\. \\*/ --tone-base: #111111; /\\* The alert tone\\. \\*/ --tone-alert: ${head.replace(/[()]/g, '\\$&')} \\}`,
      ),
    );
    // a context block repeats nothing the defaults said
    assert.match(out.css, /\[data-scheme='dark'\] \{ --tone-alert--scheme: #aa0000; --tone-alert: var/);
    assert.doesNotMatch(out.css, /\*\/ --tone-alert--scheme/);
  });

  it('writes a token with no link, no dependency and no chain as it is written without the option', async () => {
    const d = twoAxes();
    (d.sets as any).base.sources[0].tone.plain = color(srgb(1, 2, 3));
    const out = await run('@toghen contexts ds;', d, CHAIN);
    assert.match(
      out.css,
      /^:root \{ --tone-base: #111111; --tone-alert: var\(--tone-alert--scheme, var\(--tone-base\)\); --tone-plain: #010203 \}/,
    );
    assert.doesNotMatch(out.css.slice(out.css.indexOf('[data-scheme')), /--tone-plain/);
  });
});

describe("bind: 'chain' — a link's name", () => {
  it('is the core link name: the modifier as written, so a camel-case modifier keeps its capitals', async () => {
    const d = world(
      { surface: { raised: color(srgb(255, 255, 255)) } },
      {
        colorScheme: modifier('colorScheme', 'light', { light: null, dark: { surface: { raised: { $value: srgb(43, 43, 43) } } } }),
        tone: modifier('tone', 'neutral', { neutral: null, loud: { surface: { raised: { $value: srgb(230, 0, 0) } } } }),
      },
    );
    const out = await run('@toghen contexts ds;', d, CHAIN);
    assert.match(out.css, /--surface-raised--colorScheme: #2b2b2b/);
    assert.match(out.css, /--surface-raised: var\(--surface-raised--tone, var\(--surface-raised--colorScheme, #ffffff\)\)/);
    assert.doesNotMatch(out.css, /--color-scheme|object Object|toghen\(/);
  });
});
