import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import postcssMixins from '@csstools/postcss-mixins';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

// Parts are subgroups the vocabulary names; the mixins nest them. Synthetic tokens, in the W3C structured shapes.
const rem = (value: number) => ({ value, unit: 'rem' });
const srgb = (r: number, g: number, b: number) => ({ colorSpace: 'srgb', components: [r, g, b] });
const BLUE = srgb(0.1, 0.4, 0.9); // #1a66e6
const DEEP = srgb(0.08, 0.31, 0.74); // #144fbd
const PAPER = srgb(1, 1, 1); // #ffffff
const INK = srgb(0.1, 0.1, 0.1); // #1a1a1a
const color = (value: unknown) => ({ $type: 'color', $value: value });

const VOCABULARY = {
  variant: { primary: "[data-variant='primary']", quiet: "[data-variant='quiet']" },
  // `disabled` places itself with `&`; the others are appended
  state: { hover: ':hover', pressed: ':active', disabled: ":is(&:disabled, [aria-disabled='true'] &)" },
  // an at-rule spelling
  input: { fine: '@media (pointer: fine)' },
};
const parts = (vocabulary: unknown) => ({ $extensions: { 'com.toghen': { css: { parts: vocabulary } } } });

function doc(button: Record<string, unknown> = defaultButton(), extra: Record<string, unknown> = {}): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            color: { ink: color(INK), paper: color(PAPER), accent: color(BLUE), strong: color(DEEP) },
            ui: {
              ...parts(VOCABULARY),
              button,
              // a group of its own spelling for one value, the others kept
              checkbox: {
                ...parts({ state: { pressed: ':is(:checked, :indeterminate)' } }),
                background: color('{color.paper}'),
                hover: { background: color('{color.accent}') },
                pressed: { background: color('{color.strong}') },
              },
              ...extra,
            },
          },
        ],
      },
    },
    modifiers: {
      theme: {
        default: 'light',
        contexts: { light: [], dark: [{ color: { strong: { $value: INK } } }] },
        $extensions: { 'com.toghen': { css: { selector: "[data-theme='{context}']" } } },
      },
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
  };
}

function defaultButton(): Record<string, unknown> {
  return {
    background: color('{color.accent}'),
    color: color('{color.paper}'),
    paddingBlock: { $type: 'dimension', $value: rem(0.5) },
    pin: { color: color('{color.paper}') },
    hover: { background: color('{color.strong}') },
    pressed: {
      background: color('{color.strong}'),
      // a child group under a part: with a twin at rest (`pin.color`), and without
      pin: { color: color('{color.ink}') },
      badge: { color: color('{color.ink}') },
    },
    disabled: { color: color('{color.ink}'), outlineColor: color('{color.ink}') },
    primary: {
      background: color('{color.strong}'),
      // two axes nested: the variant's own state
      hover: { background: color('{color.ink}') },
    },
    // a part with nothing of its own but a part nested in it
    quiet: { hover: { background: color('{color.paper}') } },
    fine: { paddingBlock: { $type: 'dimension', $value: rem(0.25) } },
  };
}

const norm = (css: string) => css.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }').trim();

async function toghen(input: string, options: Partial<ToghenPluginOptions> = {}, document: ResolverDocument = doc()) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn', ...options })]).process(input, { from: undefined });
  return { css: result.css, warnings: result.warnings().map((w) => w.text) };
}

/** The body of one mixin as written, whitespace collapsed. */
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
const names = (css: string) => {
  const out: string[] = [];
  postcss.parse(css).walkAtRules('mixin', (r) => void out.push(r.params));
  return out;
};

describe("a group's mixin nests its parts", () => {
  it('writes its own tokens, then a rule per part, fewer parts first, then the vocabulary: appended, placing itself with &, or an at-rule', async () => {
    const out = await toghen('@toghen mixins;');
    assert.deepEqual(out.warnings, []);
    assert.equal(
      body(out.css, '--ui-button'),
      '--_ui-button-background: initial; --_ui-button-color: initial; --_ui-button-padding-block: initial; --_ui-button-pin-color: initial; ' +
        'background: var(--_ui-button-background, var(--ui-button-background, #1a66e6)); color: var(--_ui-button-color, var(--ui-button-color, #ffffff)); padding-block: var(--_ui-button-padding-block, var(--ui-button-padding-block, 0.5rem)); @contents; ' +
        "&:where([data-variant='primary']) { --_ui-button-background: var(--ui-button-primary-background, #144fbd) } " +
        '&:where(:hover) { --_ui-button-background: var(--ui-button-hover-background, #144fbd) } ' +
        '&:where(:active) { --_ui-button-background: var(--ui-button-pressed-background, #144fbd); --_ui-button-pin-color: var(--ui-button-pressed-pin-color, #1a1a1a) } ' +
        "&:where(:is(&:disabled, [aria-disabled='true'] &)) { --_ui-button-color: var(--ui-button-disabled-color, #1a1a1a); outline-color: var(--ui-button-disabled-outline-color, #1a1a1a) } " +
        '@media (pointer: fine) { --_ui-button-padding-block: var(--ui-button-fine-padding-block, 0.25rem) } ' +
        // two parts, after every rule of one; the quiet variant has nothing of its own, so no rule
        "&:where([data-variant='primary']) { &:where(:hover) { --_ui-button-background: var(--ui-button-primary-hover-background, #1a1a1a) } } " +
        "&:where([data-variant='quiet']) { &:where(:hover) { --_ui-button-background: var(--ui-button-quiet-hover-background, #ffffff) } }",
    );
  });

  it('takes the order of the parts from the vocabulary, never from the keys of the group', async () => {
    // the keys run disabled, hover; the vocabulary runs hover, pressed, disabled: the rules follow the vocabulary
    const button = {
      background: color('{color.accent}'),
      disabled: { color: color('{color.ink}') },
      hover: { background: color('{color.strong}') },
    };
    const out = await toghen('@toghen mixins;', {}, doc(button));
    assert.equal(
      body(out.css, '--ui-button'),
      "--_ui-button-background: initial; background: var(--_ui-button-background, var(--ui-button-background, #1a66e6)); @contents; &:where(:hover) { --_ui-button-background: var(--ui-button-hover-background, #144fbd) } &:where(:is(&:disabled, [aria-disabled='true'] &)) { color: var(--ui-button-disabled-color, #1a1a1a) }",
    );
  });

  it('follows a reordered vocabulary: the later value of an axis wins, and so does a later axis', async () => {
    const button = {
      background: color('{color.accent}'),
      hover: { background: color('{color.strong}') },
      disabled: { color: color('{color.ink}') },
      primary: { background: color('{color.ink}') },
    };
    const reordered = doc(button);
    const vocabulary = { state: { disabled: ":is(&:disabled, [aria-disabled='true'] &)", hover: ':hover' }, variant: VOCABULARY.variant };
    (reordered.sets as any).base.sources[0].ui.$extensions['com.toghen'].css.parts = vocabulary;
    const out = await toghen('@toghen mixins;', {}, reordered);
    assert.equal(
      body(out.css, '--ui-button'),
      "--_ui-button-background: initial; background: var(--_ui-button-background, var(--ui-button-background, #1a66e6)); @contents; &:where(:is(&:disabled, [aria-disabled='true'] &)) { color: var(--ui-button-disabled-color, #1a1a1a) } &:where(:hover) { --_ui-button-background: var(--ui-button-hover-background, #144fbd) } &:where([data-variant='primary']) { --_ui-button-background: var(--ui-button-primary-background, #1a1a1a) }",
    );
  });

  it('orders the parts nested in a part by the vocabulary too', async () => {
    const button = {
      background: color('{color.accent}'),
      // keys: disabled before hover; vocabulary: hover before disabled
      primary: { disabled: { color: color('{color.ink}') }, hover: { background: color('{color.ink}') } },
    };
    const out = await toghen('@toghen mixins;', {}, doc(button));
    assert.equal(
      body(out.css, '--ui-button-primary'),
      "&:where(:hover) { --_ui-button-background: var(--ui-button-primary-hover-background, #1a1a1a) } &:where(:is(&:disabled, [aria-disabled='true'] &)) { color: var(--ui-button-primary-disabled-color, #1a1a1a) }",
    );
  });

  it('takes a spelling a group below overrides, and keeps the rest of the vocabulary', async () => {
    const out = await toghen('@toghen mixins;');
    assert.equal(
      body(out.css, '--ui-checkbox'),
      '--_ui-checkbox-background: initial; background: var(--_ui-checkbox-background, var(--ui-checkbox-background, #ffffff)); @contents; &:where(:hover) { --_ui-checkbox-background: var(--ui-checkbox-hover-background, #1a66e6) } &:where(:is(:checked, :indeterminate)) { --_ui-checkbox-background: var(--ui-checkbox-pressed-background, #144fbd) }',
    );
  });

  it("gives a group with parts and no rest of its own a mixin, its parts in the vocabulary's order, each setting its own property", async () => {
    // the chip's rest comes from elsewhere (a recipe it composes); it defines only its states, keys out of the vocabulary's order
    const chip = {
      pressed: { background: color('{color.strong}') },
      hover: { background: color('{color.accent}'), color: color('{color.paper}') },
    };
    const out = await toghen('@toghen mixins;', {}, doc(defaultButton(), { chip, namespace: { inner: { hover: {} as never } } }));
    assert.deepEqual(out.warnings, []);
    assert.equal(
      body(out.css, '--ui-chip'),
      '@contents; &:where(:hover) { background: var(--ui-chip-hover-background, #1a66e6); color: var(--ui-chip-hover-color, #ffffff) } &:where(:active) { background: var(--ui-chip-pressed-background, #144fbd) }',
    );
    assert.equal(
      body(out.css, '--ui-chip-hover'),
      'background: var(--ui-chip-hover-background, #1a66e6); color: var(--ui-chip-hover-color, #ffffff)',
    );
    // a group with no rest and no part that says anything still gets none
    assert.ok(!names(out.css).some((n) => n.startsWith('--ui-namespace')));
    // a group with a key that is no property still gets none, parts or not
    const scale = await toghen(
      '@toghen mixins;',
      {},
      doc(defaultButton(), { size: { sm: { $type: 'dimension', $value: rem(1) }, hover: { background: color('{color.ink}') } } }),
    );
    assert.equal(body(scale.css, '--ui-size'), undefined);
  });

  it('nests no part that has nothing to say, and a group that is no part of a vocabulary is a plain group', async () => {
    const out = await toghen(
      '@toghen mixins;',
      {},
      doc({ background: color('{color.accent}'), hover: {} as never, glow: { background: color('{color.paper}') } }),
    );
    // `glow` is in no vocabulary: a plain group with its own mixin, never nested
    assert.equal(body(out.css, '--ui-button'), 'background: var(--ui-button-background, #1a66e6); @contents');
    assert.equal(body(out.css, '--ui-button-glow'), 'background: var(--ui-button-glow-background, #ffffff); @contents');
  });
});

describe("a part's mixin", () => {
  it("re-points the twin at rest to the part's token", async () => {
    const out = await toghen('@toghen mixins;');
    assert.equal(body(out.css, '--ui-button-hover'), '--_ui-button-background: var(--ui-button-hover-background, #144fbd)');
  });

  it('re-points the twin of a token in a child group, and writes none for a child group with no twin', async () => {
    const out = await toghen('@toghen mixins;');
    assert.equal(
      body(out.css, '--ui-button-pressed'),
      '--_ui-button-background: var(--ui-button-pressed-background, #144fbd); --_ui-button-pin-color: var(--ui-button-pressed-pin-color, #1a1a1a)',
    );
    // the child group with no twin lives in its own mixin, which the author applies where the child is
    assert.equal(body(out.css, '--ui-button-pressed-badge'), 'color: var(--ui-button-pressed-badge-color, #1a1a1a); @contents');
    assert.equal(body(out.css, '--ui-button-pressed-pin'), 'color: var(--ui-button-pressed-pin-color, #1a1a1a); @contents');
  });

  it('sets the property of a token directly in the part that has no twin at rest', async () => {
    const out = await toghen('@toghen mixins;');
    assert.equal(
      body(out.css, '--ui-button-disabled'),
      '--_ui-button-color: var(--ui-button-disabled-color, #1a1a1a); outline-color: var(--ui-button-disabled-outline-color, #1a1a1a)',
    );
  });

  it('nests the parts of other axes in itself, recursively, and gets a mixin with no tokens of its own', async () => {
    const out = await toghen('@toghen mixins;');
    assert.equal(
      body(out.css, '--ui-button-primary'),
      '--_ui-button-background: var(--ui-button-primary-background, #144fbd); &:where(:hover) { --_ui-button-background: var(--ui-button-primary-hover-background, #1a1a1a) }',
    );
    assert.equal(body(out.css, '--ui-button-primary-hover'), '--_ui-button-background: var(--ui-button-primary-hover-background, #1a1a1a)');
    assert.equal(
      body(out.css, '--ui-button-quiet'),
      '&:where(:hover) { --_ui-button-background: var(--ui-button-quiet-hover-background, #ffffff) }',
    );
  });

  it('re-points a typography token member by member, the family list spelled', async () => {
    const text = (weight: number) => ({
      fontFamily: ['Inter', 'Helvetica Neue', 'sans-serif'],
      fontSize: rem(1),
      fontWeight: weight,
      lineHeight: 1.5,
    });
    const button = { font: { $type: 'typography', $value: text(400) }, pressed: { font: { $type: 'typography', $value: text(700) } } };
    const out = await toghen('@toghen mixins;', {}, doc(button));
    assert.equal(
      body(out.css, '--ui-button-pressed'),
      '--_ui-button-font-font-family: var(--ui-button-pressed-font-font-family, Inter, "Helvetica Neue", sans-serif); --_ui-button-font-font-size: var(--ui-button-pressed-font-font-size, 1rem); --_ui-button-font-font-weight: var(--ui-button-pressed-font-font-weight, 700); --_ui-button-font-line-height: var(--ui-button-pressed-font-line-height, 1.5)',
    );
  });

  it('writes mixins in document order, a part after the group it belongs to', async () => {
    const out = await toghen('@toghen mixins;');
    const all = names(out.css);
    assert.ok(all.indexOf('--ui-button') < all.indexOf('--ui-button-hover'));
    assert.ok(all.indexOf('--ui-button-primary') < all.indexOf('--ui-button-primary-hover'));
    assert.equal(all.length, new Set(all).size);
  });

  it("refuses two parts of one axis nested, with the library's sentence", async () => {
    const button = {
      background: color('{color.accent}'),
      hover: { background: color('{color.strong}'), pressed: { background: color('{color.ink}') } },
    };
    const out = await toghen('@toghen mixins;', {}, doc(button));
    assert.match(out.warnings[0], /nests two parts of axis 'state': 'hover' and 'pressed'/);
  });
});

describe('the polyfill expands the nesting', () => {
  const system = () => new Resolver(doc()).resolveContextsToDesignSystem();
  const APPLY = '.tg-button { display: inline-flex; @apply --ui-button; }';

  it("expands each part into the rule that applies the group, `&` being the rule's selector, in one pipeline", async () => {
    const out = await postcss([toghenPlugin({ system: system(), onUnresolved: 'warn' }), postcssMixins()]).process(
      `@toghen mixins; ${APPLY}`,
      { from: undefined },
    );
    const css = norm(out.css);
    assert.doesNotMatch(css, /@mixin|@apply/);
    assert.match(css, /\.tg-button \{ display: inline-flex; --_ui-button-background: initial;/);
    assert.match(css, /&:where\(:hover\) \{ --_ui-button-background: var\(--ui-button-hover-background, #144fbd\) \}/);
    assert.match(
      css,
      /&:where\(\[data-variant='primary'\]\) \{ --_ui-button-background: var\(--ui-button-primary-background, #144fbd\) \}/,
    );
    assert.match(
      css,
      /&:where\(\[data-variant='primary'\]\) \{ &:where\(:hover\) \{ --_ui-button-background: var\(--ui-button-primary-hover-background, #1a1a1a\) ?\} ?\}/,
    );
    assert.match(
      css,
      /&:where\(:is\(&:disabled, \[aria-disabled='true'\] &\)\) \{ --_ui-button-color: var\(--ui-button-disabled-color, #1a1a1a\); outline-color:/,
    );
    assert.match(css, /@media \(pointer: fine\) \{ --_ui-button-padding-block: var\(--ui-button-fine-padding-block, 0\.25rem\) \}/);
  });

  it('expands the same when the polyfill runs in a second pass', async () => {
    const one = await postcss([toghenPlugin({ system: system(), onUnresolved: 'warn' }), postcssMixins()]).process(
      `@toghen mixins; ${APPLY}`,
      { from: undefined },
    );
    const first = await postcss([toghenPlugin({ system: system(), onUnresolved: 'warn' })]).process(`@toghen mixins; ${APPLY}`, {
      from: undefined,
    });
    const two = await postcss([postcssMixins()]).process(first.css, { from: undefined });
    // the polyfill spaces nested rules differently in the two parses, which says nothing about the CSS
    const bare = (css: string) => css.replace(/\s+/g, '');
    assert.equal(bare(two.css), bare(one.css));
    assert.doesNotMatch(one.css, /@apply/);
  });

  it('leaves no custom property with whitespace at the end of its value, in a formatted stylesheet through one pipeline', async () => {
    const out = await postcss([toghenPlugin({ system: system(), onUnresolved: 'warn' }), postcssMixins()]).process(
      `@toghen mixins;\n\n.tg-button {\n    display: inline-flex;\n    @apply --ui-button;\n}\n\n.tg-pin {\n    @apply --ui-button-pin;\n}\n`,
      { from: undefined },
    );
    let seen = 0;
    out.root.walkDecls(/^--/, (decl) => {
      seen++;
      assert.equal(decl.value, decl.value.trim(), decl.prop);
    });
    assert.ok(seen > 0);
    assert.doesNotMatch(out.css, /--[\w-]+:[^;{}]*\s;/);
  });

  it('keys a part on an ancestor through a spelling with `&`, and writes no rule on the element itself', async () => {
    // the variant is set on the card; the badge inside it follows, by its own spelling of the axis
    const badge = {
      ...parts({ variant: { primary: ".tg-card:where([data-variant='primary']) &", quiet: ".tg-card:where([data-variant='quiet']) &" } }),
      color: color('{color.ink}'),
      primary: { color: color('{color.accent}') },
      quiet: { color: color('{color.strong}') },
    };
    const out = await postcss([
      toghenPlugin({ system: new Resolver(doc(defaultButton(), { badge })).resolveContextsToDesignSystem(), onUnresolved: 'warn' }),
      postcssMixins(),
    ]).process('@toghen mixins; .tg-badge { @apply --ui-badge; }', { from: undefined });
    assert.equal(
      norm(out.css),
      '.tg-badge { --_ui-badge-color: initial; color: var(--_ui-badge-color, var(--ui-badge-color, #1a1a1a)); ' +
        "&:where(.tg-card:where([data-variant='primary']) &) { --_ui-badge-color: var(--ui-badge-primary-color, #1a66e6) } " +
        "&:where(.tg-card:where([data-variant='quiet']) &) { --_ui-badge-color: var(--ui-badge-quiet-color, #144fbd) } }",
    );
  });

  it('writes its mixins in a pipeline that lists the polyfill first, and nothing expands them', async () => {
    const out = await postcss([postcssMixins(), toghenPlugin({ system: system(), onUnresolved: 'warn' })]).process(
      `@toghen mixins; ${APPLY}`,
      { from: undefined },
    );
    assert.match(out.css, /@mixin --ui-button/);
    assert.match(out.css, /@apply --ui-button/);
  });
});
