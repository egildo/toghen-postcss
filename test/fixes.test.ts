import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Collection, DesignSystem, DesignToken, Resolver, type ResolverDocument, type ResolverModifier } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';
import { ATTR, doc, px, rem, run, srgb, warned } from './fixture-composites.js';

// Six fixes ruled on 8 October 2026. Every value is in the W3C structured shape, and the systems are synthetic.

/** A resolver document with one base set and the given modifiers. */
const system = (
  sources: Record<string, unknown>,
  modifiers?: Record<string, ResolverModifier>,
  order: string[] = [],
): ResolverDocument => ({
  version: '2025-11-01',
  name: 'ds',
  sets: { base: { sources: [sources] } },
  ...(modifiers ? { modifiers } : {}),
  resolutionOrder: [{ $ref: '#/sets/base' }, ...order.map((m) => ({ $ref: `#/modifiers/${m}` }))],
});

/** The stylesheet as written, with its spacing: only the newlines and indentation between nodes are flattened. */
async function raw(input: string, document: ResolverDocument, options: Partial<ToghenPluginOptions> = {}) {
  const result = await postcss([
    toghenPlugin({ system: new Resolver(document).resolveContextsToDesignSystem(), onUnresolved: 'throw', ...options }),
  ]).process(input, { from: undefined });
  return result.css.replace(/\s*\n\s*/g, ' ').trim();
}

describe('a fontFamily written as a CSS list', () => {
  const fonts = system({
    font: {
      $type: 'fontFamily',
      commas: { $value: "'Plex Sans', 'Source Sans 3', system-ui, sans-serif" },
      stack: { $value: ['Plex Sans', 'Source Sans 3', 'system-ui', 'sans-serif'] },
      one: { $value: 'Inter' },
      quoted: { $value: "'Foo, Bar', serif" },
    },
    text: {
      $type: 'typography',
      note: {
        $value: { fontFamily: "Inter, 'Source Sans 3', serif", fontSize: rem(1), fontWeight: 400, lineHeight: 1.5, letterSpacing: px(1) },
      },
    },
  });

  it('is a list of names, not one quoted family', async () => {
    const out = await run('p { font-family: toghen(ds.font.commas); }', {}, fonts);
    assert.equal(out.css, 'p { font-family: var(--font-commas, "Plex Sans", "Source Sans 3", system-ui, sans-serif) }');
  });

  it('is spelled as the array of the same names is', async () => {
    const out = await run('p { font-family: toghen(ds.font.stack); }', {}, fonts);
    assert.equal(out.css, 'p { font-family: var(--font-stack, "Plex Sans", "Source Sans 3", system-ui, sans-serif) }');
  });

  it('leaves a single name and a quoted comma as one name each', async () => {
    const out = await run('p { font-family: toghen(ds.font.one); } q { font-family: toghen(ds.font.quoted); }', {}, fonts);
    assert.equal(out.css, 'p { font-family: var(--font-one, Inter) } q { font-family: var(--font-quoted, "Foo, Bar", serif) }');
  });

  it('is read through in a typography member, in the shorthand and on its own', async () => {
    const out = await run('p { font: toghen(ds.text.note); font-family: toghen(ds.text.note.fontFamily); }', { typography: 'font' }, fonts);
    assert.equal(
      out.css,
      'p { font: var(--text-note, 400 1rem/1.5 Inter, "Source Sans 3", serif); font-family: Inter, "Source Sans 3", serif }',
    );
  });

  it('is declared as a list too', async () => {
    const out = await run(':root { @toghen declare ds.font.commas; }', {}, fonts);
    assert.equal(out.css, ':root { --font-commas: "Plex Sans", "Source Sans 3", system-ui, sans-serif }');
  });
});

describe('the order statement of @toghen contexts in a layer', () => {
  const themed = system(
    { card: { pad: { $type: 'dimension', $value: px(16) } } },
    { theme: { default: 'light', contexts: { light: [], dark: [{ card: { pad: { $value: px(8) } } }] }, ...ATTR('theme') } },
    ['theme'],
  );

  it('has no space before its semicolon', async () => {
    const css = await raw('@layer tokens {\n  @toghen contexts ds;\n}', themed);
    assert.match(css, /@layer defaults, theme;/);
    assert.doesNotMatch(css, / ;/);
    assert.equal(css.split('@layer defaults, theme;').length, 2);
  });

  it('has none either with other rules around it', async () => {
    const css = await raw('a { color: red }\n@layer tokens {\n  @toghen contexts ds;\n}\n.b { color: blue }', themed);
    assert.doesNotMatch(css, / ;/);
  });
});

describe('@toghen contexts of a collection with no modifiers', () => {
  const plain = system({ card: { pad: { $type: 'dimension', $value: px(16) }, edge: { $type: 'color', $value: srgb(0.8, 0.8, 0.8) } } });

  it('writes the defaults alone under the root selector', async () => {
    const out = await run('@toghen contexts ds;', {}, plain);
    assert.equal(out.css, `:root { --card-pad: 16px; --card-edge: #cccccc }`);
  });

  it('writes the order statement and the defaults sublayer inside a layer', async () => {
    const css = await raw('@layer tokens {\n  @toghen contexts ds;\n}', plain);
    assert.equal(css, `@layer tokens { @layer defaults; @layer defaults { :root { --card-pad: 16px; --card-edge: #cccccc } } }`);
  });

  it('works for a collection that was built by hand, and is not reported', async () => {
    const ds = new DesignSystem();
    const card = new Collection('card');
    card.setToken('pad', new DesignToken({ value: 1, unit: 'rem' }, 'dimension'));
    ds.addCollection(card);
    const result = await postcss([toghenPlugin({ system: ds, onUnresolved: 'throw' })]).process('@toghen contexts card;', {
      from: undefined,
    });
    assert.equal(result.css.replace(/\s+/g, ' ').trim(), ':root { --pad: 1rem }');
    assert.deepEqual(result.warnings(), []);
  });

  it('keeps the directive when the first context arrives, and grows by its block', async () => {
    const grown = system(
      { card: { pad: { $type: 'dimension', $value: px(16) } } },
      { theme: { default: 'light', contexts: { light: [], dark: [{ card: { pad: { $value: px(8) } } }] }, ...ATTR('theme') } },
      ['theme'],
    );
    const out = await run('@toghen contexts ds;', {}, grown);
    assert.equal(out.css, ":root { --card-pad: 16px } [data-theme='light'] { --card-pad: 16px } [data-theme='dark'] { --card-pad: 8px }");
  });
});

describe('a member property and a token with one name', () => {
  // `frame.border` has a member `color` written at --frame-border-color, and `frame.borderColor` is a token with that name.
  const framed = doc(
    {},
    {
      frame: {
        border: { $type: 'border', $value: { color: srgb(0.8, 0.8, 0.8), width: px(1), style: 'solid' } },
        borderColor: { $type: 'color', $value: srgb(0.1, 0.4, 0.9) },
      },
    },
  );

  it('writes the token, not the member, and reports the clash through onUnresolved', async () => {
    const out = await warned(':root { @toghen declare ds.frame; }', {}, framed);
    assert.equal(
      out.css,
      ':root { --frame-border: 1px solid #cccccc; --frame-border-width: 1px; --frame-border-style: solid; --frame-border-color: #1a66e6 }',
    );
    assert.equal(out.warnings.length, 1);
    assert.match(
      out.warnings[0],
      /"ds\.frame\.border" declares its member "color" as --frame-border-color, which is also the property of the token "ds\.frame\.borderColor"\. The token wins/,
    );
  });

  it('stops the build under throw', async () => {
    await assert.rejects(
      run(':root { @toghen declare ds.frame; }', {}, framed),
      /"ds\.frame\.border" declares its member "color" as --frame-border-color/,
    );
  });

  it('is reported once by @toghen contexts, however many blocks it writes', async () => {
    const varying = doc(
      {},
      {
        frame: {
          border: { $type: 'border', $value: { color: '{color.edge}', width: px(1), style: 'solid' } },
          borderColor: { $type: 'color', $value: '{color.accent}' },
        },
      },
    );
    const out = await warned('@toghen contexts ds.frame;', {}, varying);
    assert.equal(out.warnings.length, 1);
    // the token varies with the theme, and it is the token's value the block holds
    assert.match(out.css, /:root \{[^}]*--frame-border-color: #1a66e6/);
    assert.match(out.css, /\[data-theme='dark'\] \{[^}]*--frame-border-color: #1a1a1a/);
    assert.equal((out.css.match(/--frame-border-color:/g) ?? []).length, 3);
  });

  it('says nothing when the token is outside the directive', async () => {
    const out = await warned(':root { @toghen declare ds.frame.border; }', {}, framed);
    assert.deepEqual(out.warnings, []);
    assert.match(out.css, /--frame-border-color: #cccccc/);
  });
});

describe('a typography key in a group under typography: font', () => {
  const styled = system({
    eyebrow: {
      font: {
        $type: 'typography',
        $value: {
          fontFamily: ['Inter', 'sans-serif'],
          fontSize: rem(0.75),
          fontWeight: 600,
          lineHeight: 1.25,
          letterSpacing: { value: 0.09, unit: 'rem' },
          textTransform: 'uppercase',
        },
      },
      color: { $type: 'color', $value: srgb(0.1, 0.4, 0.9) },
    },
    type: {
      label: {
        $type: 'typography',
        $value: { fontFamily: ['Inter'], fontSize: rem(1), fontWeight: 400, lineHeight: 1.5, letterSpacing: { value: 1, unit: 'px' } },
      },
    },
    alias: { font: { $type: 'typography', $value: '{type.label}' } },
  });

  /** The body of one mixin as written. */
  const mixin = async (name: string, options: Partial<ToghenPluginOptions>) =>
    (await run('@toghen mixins;', options, styled)).css.match(new RegExp(`@mixin ${name} \\{ (.*?) \\}`))?.[1];

  it('writes the members the shorthand cannot carry, after font, each at its own property', async () => {
    assert.equal(
      await mixin('--eyebrow', { typography: 'font' }),
      'font: var(--eyebrow-font, 600 0.75rem/1.25 Inter, sans-serif); letter-spacing: var(--eyebrow-font-letter-spacing, 0.09rem); text-transform: var(--eyebrow-font-text-transform, uppercase); color: var(--eyebrow-color, #1a66e6); @contents',
    );
  });

  it('writes the members of the token a typography key refers to', async () => {
    assert.equal(
      await mixin('--alias', { typography: 'font' }),
      'font: var(--alias-font, 400 1rem/1.5 Inter); letter-spacing: var(--alias-font-letter-spacing, 1px); @contents',
    );
  });

  it('writes the key as the longhands that read the member properties, beside the other keys, under the block default', async () => {
    assert.equal(
      await mixin('--eyebrow', {}),
      'font-family: var(--eyebrow-font-font-family, Inter, sans-serif); font-size: var(--eyebrow-font-font-size, 0.75rem); font-weight: var(--eyebrow-font-font-weight, 600); line-height: var(--eyebrow-font-line-height, 1.25); letter-spacing: var(--eyebrow-font-letter-spacing, 0.09rem); text-transform: var(--eyebrow-font-text-transform, uppercase); color: var(--eyebrow-color, #1a66e6); @contents',
    );
    // and the token's own mixin says the same
    assert.match(
      (await mixin('--eyebrow-font', {}))!,
      /^font-family: var\(--eyebrow-font-font-family, Inter, sans-serif\); font-size: var\(--eyebrow-font-font-size, 0\.75rem\)/,
    );
  });
});

describe("composites: 'shorthand'", () => {
  const SHORT = { composites: 'shorthand' } as const;
  // ds.card.border is { color: {colorSpace, components}, width: {value, unit}, style }

  it("defaults to 'longhands': today's output", async () => {
    const plain = await run(':root { @toghen declare ds.card.border; }');
    const said = await run(':root { @toghen declare ds.card.border; }', { composites: 'longhands' });
    assert.equal(said.css, plain.css);
    assert.match(plain.css, /--card-border-width: 1px/);
  });

  it('declares the composite alone', async () => {
    const out = await run(':root { @toghen declare ds.card.border; }', SHORT);
    assert.equal(out.css, ':root { --card-border: 1px solid #cccccc }');
  });

  it('writes no member property in any block of contexts', async () => {
    const out = await run('@toghen contexts ds.card.border;', SHORT);
    assert.equal(
      out.css,
      ":root { --card-border: 1px solid #cccccc } [data-theme='light'] { --card-border: 1px solid #cccccc } [data-theme='dark'] { --card-border: 1px solid #4d4d4d }",
    );
  });

  it('writes the literal for a longhand read, which has no property to read', async () => {
    const out = await run('.c { border-width: toghen(ds.card.border.width); border-color: toghen(ds.card.border.color); }', SHORT);
    assert.equal(out.css, '.c { border-width: 1px; border-color: #cccccc }');
  });

  it('leaves a whole read as it was', async () => {
    const out = await run('.c { border: toghen(ds.card.border); }', SHORT);
    assert.equal(out.css, '.c { border: var(--card-border, 1px solid #cccccc) }');
  });

  it('leaves typography to the typography option', async () => {
    const out = await run(':root { @toghen declare ds.type.body; }', { ...SHORT, typography: 'font' });
    assert.equal(out.css, ':root { --type-body: 400 0.875rem/1.25 Inter, sans-serif }');
    const block = await run(':root { @toghen declare ds.type.body; }', SHORT);
    assert.match(block.css, /--type-body-font-size: 0\.875rem/);
  });
});

// Messages and small corrections ruled on 13 October 2026 after the running example was run.
describe('messages that name the right thing', () => {
  it('@toghen contexts of a path that names no token says so, and writes nothing', async () => {
    const out = await warned('@toghen contexts nothing;');
    assert.deepEqual(out.warnings, ['[@toghen/postcss] Cannot write the contexts of "ds.nothing": it names no token.']);
    assert.equal(out.css, '@toghen contexts nothing;');
  });

  it('@toghen declare takes the collection segment or leaves it out, like t(), contexts and mixins', async () => {
    const full = await run(':root { @toghen declare ds.card.pad; }');
    assert.equal((await run(':root { @toghen declare card.pad; }')).css, full.css);
    assert.match(full.css, /--card-pad: 16px/);
    assert.deepEqual((await warned(':root { @toghen declare nothing; }')).warnings, [
      '[@toghen/postcss] Cannot declare "ds.nothing": it names no token.',
    ]);
  });

  it("the nested-axes error of @toghen mixins names what is written and keeps the library's sentence", async () => {
    const nested = system({
      $extensions: { 'com.toghen': { css: { parts: { state: { hover: ':hover', pressed: ':active' } } } } },
      button: {
        background: { $type: 'color', $value: srgb(1, 1, 1) },
        hover: { pressed: { background: { $type: 'color', $value: srgb(0, 0, 0) } } },
      },
    });
    const out = await warned('@toghen mixins;', {}, nested);
    assert.deepEqual(out.warnings, [
      '[@toghen/postcss] Cannot write the mixins of "button": Path \'button.hover.pressed.background\' nests two parts of axis \'state\': \'hover\' and \'pressed\'. Give the group "com.toghen": { "css": { "parts": false } }, or rename a key.',
    ]);
  });

  it('an error in one group leaves that group out and writes every other', async () => {
    const mixed = system({
      $extensions: { 'com.toghen': { css: { parts: { variant: { plain: '[data-variant=plain]', solid: '[data-variant=solid]' } } } } },
      // a lookup table that nests two values of one axis
      hue: { plain: { solid: { background: { $type: 'color', $value: srgb(1, 0, 0) } } } },
      card: { background: { $type: 'color', $value: srgb(1, 1, 1) } },
    });
    const out = await warned('@toghen mixins;', {}, mixed);
    assert.equal(out.warnings.length, 1);
    assert.match(
      out.warnings[0],
      /^\[@toghen\/postcss\] Cannot write the mixins of "hue": Path 'hue\.plain\.solid\.background' nests two parts of axis 'variant': 'plain' and 'solid'\./,
    );
    assert.match(out.css, /@mixin --card \{/);
    assert.doesNotMatch(out.css, /@mixin --hue/);
  });

  it('a group with parts: false is read as no component, and nothing is reported', async () => {
    const opted = system({
      $extensions: { 'com.toghen': { css: { parts: { variant: { plain: '[data-variant=plain]', solid: '[data-variant=solid]' } } } } },
      hue: {
        $extensions: { 'com.toghen': { css: { parts: false } } },
        plain: { solid: { background: { $type: 'color', $value: srgb(1, 0, 0) } } },
      },
      card: { background: { $type: 'color', $value: srgb(1, 1, 1) } },
    });
    const out = await warned('@toghen mixins;', {}, opted);
    assert.deepEqual(out.warnings, []);
    assert.match(out.css, /@mixin --card \{/);
  });

  it('an error in one group still stops the build under onUnresolved: throw', async () => {
    const mixed = system({
      $extensions: { 'com.toghen': { css: { parts: { variant: { plain: '[data-variant=plain]', solid: '[data-variant=solid]' } } } } },
      hue: { plain: { solid: { background: { $type: 'color', $value: srgb(1, 0, 0) } } } },
      card: { background: { $type: 'color', $value: srgb(1, 1, 1) } },
    });
    await assert.rejects(warned('@toghen mixins;', { onUnresolved: 'throw' }, mixed), /Cannot write the mixins of "hue"/);
  });

  it('any @toghen layer … is the retired layer directive, not a path', async () => {
    for (const input of ['@toghen layer;', '.a { @toghen layer states; }']) {
      const out = await warned(input);
      assert.match(out.warnings[0], /it is retired: a part is nested in the rule that applies its group/);
    }
  });

  it('@toghen mixins inside a rule speaks of a rule, and inside a layer of a layer', async () => {
    assert.match(
      (await warned('.a { @toghen mixins; }')).warnings[0],
      /inside a rule: a mixin is defined at the top of a stylesheet, and a rule cannot hold a definition/,
    );
    assert.match((await warned('@layer x { @toghen mixins; }')).warnings[0], /inside a layer: a mixin has no cascade position of its own/);
  });

  it('a path with a leading dot is reported as written', async () => {
    const out = await warned('.a { x: t(.card.pad); }');
    assert.match(out.warnings[0], /^\[@toghen\/postcss\] Cannot resolve token "\.card\.pad": /);
    assert.doesNotMatch(out.warnings[0], /ds\.\./);
  });
});

describe('the plugin listed bare', () => {
  it('says it needs its options, with a system at least', () => {
    for (const bare of [undefined, {}] as never[]) {
      assert.throws(
        () => toghenPlugin(bare),
        /@toghen\/postcss needs its options: it has no design system to read\. Pass \{ system \} at least/,
      );
    }
  });
});
