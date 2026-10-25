import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import postcssMixins from '@csstools/postcss-mixins';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

// Synthetic tokens in the W3C structured shapes. One collection, so its name may be left out of a path.
const px = (value: number) => ({ value, unit: 'px' });
const rem = (value: number) => ({ value, unit: 'rem' });
const srgb = (r: number, g: number, b: number) => ({ colorSpace: 'srgb', components: [r, g, b] });
const INK = srgb(0.1, 0.1, 0.1); // #1a1a1a
const PAPER = srgb(1, 1, 1); // #ffffff

function doc(modifiers: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            // primitive scales: keys are not properties, so no group mixin
            color: { $type: 'color', ink: { $value: INK }, paper: { $value: PAPER } },
            space: { $type: 'dimension', 100: { $value: px(4) }, 200: { $value: px(8) } },
            button: {
              backgroundColor: { $type: 'color', $value: '{color.paper}' },
              color: { $type: 'color', $value: '{color.ink}' },
              paddingBlock: { $type: 'dimension', $value: rem(0.5) },
              borderRadius: { $type: 'dimension', $value: px(6) },
              icon: { width: { $type: 'dimension', $value: px(16) } },
            },
            // one key that is no property: the whole group gets no mixin
            badge: {
              color: { $type: 'color', $value: '{color.ink}' },
              tone: { $type: 'color', $value: '{color.paper}' },
            },
            type: {
              body: {
                $type: 'typography',
                $value: { fontFamily: ['Inter', 'Helvetica Neue', 'sans-serif'], fontSize: rem(0.875), fontWeight: 400, lineHeight: 1.25 },
              },
            },
            motion: {
              transitionDuration: { $type: 'duration', $value: { value: 200, unit: 'ms' } },
              opacity: { $type: 'number', $value: 1 },
            },
            ...extra,
          },
        ],
      },
    },
    modifiers: {
      theme: {
        default: 'light',
        contexts: { light: [], dark: [{ color: { ink: { $value: PAPER }, paper: { $value: INK } } }], contrast: [], print: [] },
        $extensions: {
          'com.toghen': {
            css: {
              contexts: {
                // an at-rule alone, a selector list alone, and both
                dark: { atRule: '@media (prefers-color-scheme: dark)' },
                contrast: { selector: ".hc, [data-contrast='high']" },
                print: { selector: '.print', atRule: '@media print' },
              },
            },
          },
        },
      },
      density: {
        default: 'regular',
        contexts: { regular: [], compact: [{ space: { 100: { $value: px(2) } } }] },
        $extensions: { 'com.toghen': { css: { selector: "[data-density='{context}']" } } },
      },
      ...modifiers,
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }, { $ref: '#/modifiers/density' }],
  };
}

const norm = (css: string) => css.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }').trim();

async function toghen(input: string, options: Partial<ToghenPluginOptions> = {}, document: ResolverDocument = doc()) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn', ...options })]).process(input, { from: undefined });
  return { css: norm(result.css), warnings: result.warnings().map((w) => w.text) };
}

/** What Toghen writes, then what the mixins polyfill makes of it beside the author's rules: one pipeline. */
async function expanded(author: string, options: Partial<ToghenPluginOptions> = {}, document: ResolverDocument = doc()) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const out = await postcss([toghenPlugin({ system, onUnresolved: 'warn', ...options }), postcssMixins()]).process(
    `@toghen mixins; ${author}`,
    { from: undefined },
  );
  return norm(out.css);
}

const mixinNames = (css: string) => [...css.matchAll(/@mixin (--[^\s{]+)/g)].map((m) => m[1]);
const ruleOf = (css: string, name: string) => new RegExp(`@mixin ${name} \\{([^]*?)\\}(?= @| *$|\\s+@mixin)`).exec(css)?.[1];

describe('@toghen mixins: the rest mixin of a group', () => {
  it('writes one mixin per group whose keys are all properties, reading the custom properties', async () => {
    const out = await toghen('@toghen mixins ds;');
    assert.deepEqual(out.warnings, []);
    const body = ruleOf(out.css, '--button');
    assert.equal(
      norm(body ?? ''),
      'background-color: var(--button-background-color, #ffffff); color: var(--button-color, #1a1a1a); padding-block: var(--button-padding-block, 0.5rem); border-radius: var(--button-border-radius, 6px); @contents',
    );
    assert.equal(norm(ruleOf(out.css, '--button-icon') ?? ''), 'width: var(--button-icon-width, 16px); @contents');
  });

  it('writes none for a primitive scale, a group with a key that is no property, or a namespace', async () => {
    const names = mixinNames((await toghen('@toghen mixins;')).css);
    assert.ok(!names.includes('--color'));
    assert.ok(!names.includes('--space'));
    assert.ok(!names.includes('--badge'));
    // `motion` holds only properties; `type` holds only a typography token, which is no property
    assert.ok(names.includes('--motion'));
    assert.ok(!names.includes('--type'));
  });

  it('writes a typography key as longhands under typography: block, and as the font shorthand under font', async () => {
    const extra = {
      box: {
        font: { $type: 'typography', $value: { fontFamily: ['Inter', 'sans-serif'], fontSize: rem(1), fontWeight: 400, lineHeight: 1.5 } },
      },
    };
    const block = await toghen('@toghen mixins;', {}, doc({}, extra));
    assert.equal(
      norm(ruleOf(block.css, '--box') ?? ''),
      'font-family: var(--box-font-font-family, Inter, sans-serif); font-size: var(--box-font-font-size, 1rem); font-weight: var(--box-font-font-weight, 400); line-height: var(--box-font-line-height, 1.5); @contents',
    );
    const font = await toghen('@toghen mixins;', { typography: 'font' }, doc({}, extra));
    assert.equal(norm(ruleOf(font.css, '--box') ?? ''), 'font: var(--box-font, 400 1rem/1.5 Inter, sans-serif); @contents');
  });

  it('is expanded by the polyfill into declarations on the applying rule', async () => {
    const css = await expanded('.tg-button { display: inline-flex; @apply --button; }');
    assert.match(
      css,
      /\.tg-button \{ display: inline-flex; background-color: var\(--button-background-color, #ffffff\); color: var\(--button-color, #1a1a1a\); padding-block: var\(--button-padding-block, 0\.5rem\); border-radius: var\(--button-border-radius, 6px\) \}/,
    );
    assert.doesNotMatch(css, /@mixin|@apply/);
  });

  it('is the same with the names the propertyName option gives', async () => {
    const out = await toghen('@toghen mixins;', { propertyName: (path) => `--t-${path.split('.').slice(1).join('_')}` });
    assert.ok(mixinNames(out.css).includes('--t-button'));
    assert.match(out.css, /background-color: var\(--t-button_backgroundColor, #ffffff\)/);
  });
});

describe('@toghen mixins: a typography token', () => {
  it('gets a mixin of its own, one longhand per member, the family list spelled', async () => {
    const out = await toghen('@toghen mixins;');
    assert.equal(
      norm(ruleOf(out.css, '--type-body') ?? ''),
      'font-family: var(--type-body-font-family, Inter, "Helvetica Neue", sans-serif); font-size: var(--type-body-font-size, 0.875rem); font-weight: var(--type-body-font-weight, 400); line-height: var(--type-body-line-height, 1.25)',
    );
  });

  it('is expanded by the polyfill', async () => {
    const css = await expanded('.body { @apply --type-body; }');
    assert.equal(
      css,
      '.body { font-family: var(--type-body-font-family, Inter, "Helvetica Neue", sans-serif); font-size: var(--type-body-font-size, 0.875rem); font-weight: var(--type-body-font-weight, 400); line-height: var(--type-body-line-height, 1.25) }',
    );
  });

  it('writes the members the font shorthand cannot carry under typography: font, and no custom property for the carried ones', async () => {
    const css = await expanded('.body { @apply --type-body; }', { typography: 'font' });
    assert.equal(css, '.body { font: var(--type-body, 400 0.875rem/1.25 Inter, "Helvetica Neue", sans-serif) }');
  });
});

describe('@toghen mixins: --when-<modifier>-<context>', () => {
  it('writes a context spelled as a selector list as self-or-descendant at no specificity', async () => {
    const out = await toghen('@toghen mixins;');
    assert.equal(
      norm(ruleOf(out.css, '--when-theme-contrast') ?? ''),
      "&:where(.hc, .hc *, [data-contrast='high'], [data-contrast='high'] *) { @contents }",
    );
    assert.equal(
      norm(ruleOf(out.css, '--when-density-compact') ?? ''),
      "&:where([data-density='compact'], [data-density='compact'] *) { @contents }",
    );
  });

  it('nests a context spelled as an at-rule directly', async () => {
    const out = await toghen('@toghen mixins;');
    assert.match(out.css, /@mixin --when-theme-dark \{ @media \(prefers-color-scheme: dark\) \{ @contents \} \}/);
  });

  it('wraps the selector rule in the at-rule when a context has both', async () => {
    const out = await toghen('@toghen mixins;');
    assert.match(out.css, /@mixin --when-theme-print \{ @media print \{ &:where\(\.print, \.print \*\) \{ @contents \} \} \}/);
  });

  it('writes none for a context with no spelling, and a leftover "inherits": false changes nothing', async () => {
    const state = {
      hover: {
        default: 'rest',
        contexts: { rest: [], hovered: [] },
        $extensions: { 'com.toghen': { css: { selector: ':hover', inherits: false } } },
      },
    };
    const names = mixinNames((await toghen('@toghen mixins;', {}, doc(state))).css);
    assert.ok(!names.includes('--when-theme-light'));
    assert.ok(names.includes('--when-hover-hovered'));
  });

  it('are expanded by the polyfill: a selector, an at-rule, and both', async () => {
    const css = await expanded(
      '.card { @apply --when-theme-contrast { outline: 2px solid; } @apply --when-theme-dark { box-shadow: none; } @apply --when-theme-print { color: #000000; } }',
    );
    // Nested rules, which a nesting polyfill flattens: `&` is the applying rule's selector.
    assert.match(css, /&:where\(\.hc, \.hc \*, \[data-contrast='high'\], \[data-contrast='high'\] \*\) \{ outline: 2px solid ?\}/);
    assert.match(css, /@media \(prefers-color-scheme: dark\) \{ box-shadow: none ?\}/);
    assert.match(css, /@media print \{ &:where\(\.print, \.print \*\) \{ color: #000000 ?\} \}/);
    assert.doesNotMatch(css, /@mixin|@apply|@contents/);
  });
});

describe('@toghen mixins: where it may stand, and in what order', () => {
  it('is refused inside a rule and inside a layer, and stays where it was', async () => {
    const inRule = await toghen('.a { @toghen mixins; }');
    assert.match(inRule.warnings[0], /Cannot write the mixins of "ds" inside a rule/);
    assert.match(inRule.css, /@toghen mixins/);
    const inLayer = await toghen('@layer tokens { @toghen mixins; }');
    assert.match(inLayer.warnings[0], /Cannot write the mixins of "ds" inside a layer/);
    assert.match(inLayer.css, /@toghen mixins/);
    await assert.rejects(toghen('@layer tokens { @toghen mixins; }', { onUnresolved: 'throw' }), /inside a layer/);
  });

  it('is deterministic, in document order: groups, then typography tokens as they come, then contexts', async () => {
    const first = await toghen('@toghen mixins;');
    const second = await toghen('@toghen mixins;');
    assert.equal(first.css, second.css);
    assert.deepEqual(mixinNames(first.css), [
      '--button',
      '--button-icon',
      '--type-body',
      '--motion',
      '--when-theme-dark',
      '--when-theme-contrast',
      '--when-theme-print',
      '--when-density-regular',
      '--when-density-compact',
    ]);
  });

  it('takes the collection as its argument and refuses a group', async () => {
    const out = await toghen('@toghen mixins ds.button;');
    assert.match(out.warnings[0], /Cannot write the mixins of "ds.button": the argument is a collection/);
    assert.match(out.css, /@toghen mixins/);
  });
});

describe('@toghen mixins: a name written twice', () => {
  const clash = () =>
    doc(
      {},
      {
        fact: { strip: { color: { $type: 'color', $value: '{color.ink}' } } },
        'fact-strip': { color: { $type: 'color', $value: '{color.paper}' } },
      },
    );

  it('is an error naming both paths, whatever onUnresolved says, and writes neither definition', async () => {
    for (const onUnresolved of ['warn', 'ignore', 'throw'] as const) {
      await assert.rejects(
        toghen('@toghen mixins;', { onUnresolved }, clash()),
        /\[@toghen\/postcss\] "fact\.strip" and "fact-strip" are both written as the mixin --fact-strip\. Rename one of them, or give propertyName an injective rule\./,
      );
    }
  });

  it('counts the --when- mixin of a context: a group named for it collides', async () => {
    const document = doc({}, { 'when-theme-dark': { color: { $type: 'color', $value: '{color.ink}' } } });
    await assert.rejects(
      toghen('@toghen mixins;', {}, document),
      /"when-theme-dark" and "theme=dark" are both written as the mixin --when-theme-dark\./,
    );
  });

  it('is no error when the names differ', async () => {
    const out = await toghen(
      '@toghen mixins;',
      {},
      doc(
        {},
        {
          fact: { strip: { color: { $type: 'color', $value: '{color.ink}' } } },
          'fact-band': { color: { $type: 'color', $value: '{color.paper}' } },
        },
      ),
    );
    assert.deepEqual(out.warnings, []);
    assert.ok(mixinNames(out.css).includes('--fact-strip') && mixinNames(out.css).includes('--fact-band'));
  });
});
