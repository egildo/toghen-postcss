import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { DesignSystem, Collection, DesignToken, Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin from '../src/index.js';

// ---------------------------------------------------------------------------
// Shared fixture — a small DesignSystem used across all tests.
// ---------------------------------------------------------------------------

function buildSystem(): DesignSystem {
  const system = new DesignSystem();

  // ── primitive color tokens ──────────────────────────────────────────────
  const colors = new Collection('colors', ['light', 'dark']);
  colors.setToken('primary.blue', new DesignToken('#0066cc', 'color', 'Brand blue'));
  colors.setToken('primary.red', new DesignToken('#cc3300', 'color', 'Brand red'));

  // Per-mode values are set one mode at a time; an array $value would be a
  // value that is genuinely an array, not a packed list of modes.
  colors.setToken('background', new DesignToken('#ffffff', 'color'), 'light');
  colors.setToken('background', new DesignToken('#1a1a1a', 'color'), 'dark');

  // Reference token: alias → primary.blue. The path is document-relative —
  // it carries no collection name, unlike the lookup paths in toghen() calls.
  colors.setToken('semantic.accent', new DesignToken('{primary.blue}', 'color', 'Accent colour alias'));

  system.addCollection(colors);

  // ── dimension tokens ────────────────────────────────────────────────────
  const spacing = new Collection('spacing');
  spacing.setToken('md', new DesignToken('16px', 'dimension', 'Medium spacing'));
  system.addCollection(spacing);

  return system;
}

// ---------------------------------------------------------------------------
// Helper — run the plugin against a CSS string and return the output.
// ---------------------------------------------------------------------------

async function process(
  css: string,
  system: DesignSystem,
  defaultMode?: string,
  onUnresolved?: 'warn' | 'throw' | 'ignore',
): Promise<string> {
  const result = await postcss([toghenPlugin({ system, defaultMode, onUnresolved })]).process(css, { from: undefined });
  return result.css;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@toghen/postcss — plugin', () => {
  it('resolves a simple token reference', async () => {
    const system = buildSystem();
    const output = await process('a { color: toghen(colors.primary.blue); }', system);
    assert.equal(output, 'a { color: var(--primary-blue, #0066cc); }');
  });

  it('resolves an alias (reference token) to its final value', async () => {
    const system = buildSystem();
    const output = await process('a { color: toghen(colors.semantic.accent); }', system);
    assert.equal(output, 'a { color: var(--semantic-accent, #0066cc); }');
  });

  it('resolves a multi-mode token with an explicit mode', async () => {
    const system = buildSystem();
    const output = await process('body { background: toghen(colors.background, dark); }', system);
    assert.equal(output, 'body { background: #1a1a1a; }');
  });

  it('uses defaultMode when no mode is given in the call', async () => {
    const system = buildSystem();
    // defaultMode = 'dark' → background should resolve to dark value
    const output = await process('body { background: toghen(colors.background); }', system, 'dark');
    assert.equal(output, 'body { background: var(--background, #1a1a1a); }');
  });

  it('resolves multiple toghen() calls in a single declaration', async () => {
    const system = buildSystem();
    const output = await process(
      'a { border: 1px solid toghen(colors.primary.blue); outline: toghen(spacing.md) solid toghen(colors.primary.red); }',
      system,
    );
    assert.equal(
      output,
      'a { border: 1px solid var(--primary-blue, #0066cc); outline: var(--md, 16px) solid var(--primary-red, #cc3300); }',
    );
  });

  it('resolves toghen() calls across different collections in the same rule', async () => {
    const system = buildSystem();
    const css = '.btn { color: toghen(colors.primary.blue); padding: toghen(spacing.md); }';
    const output = await process(css, system);
    assert.equal(output, '.btn { color: var(--primary-blue, #0066cc); padding: var(--md, 16px); }');
  });

  it('leaves unresolvable calls intact when onUnresolved = "ignore"', async () => {
    const system = buildSystem();
    const css = 'a { color: toghen(colors.does.not.exist); }';
    const result = await postcss([toghenPlugin({ system, onUnresolved: 'ignore' })]).process(css, { from: undefined });
    assert.equal(result.css, 'a { color: toghen(colors.does.not.exist); }');
  });

  it('throws when onUnresolved = "throw" and the token is missing', async () => {
    const system = buildSystem();
    const css = 'a { color: toghen(colors.does.not.exist); }';
    await assert.rejects(() => postcss([toghenPlugin({ system, onUnresolved: 'throw' })]).process(css, { from: undefined }), {
      name: 'CssSyntaxError',
    });
  });

  it('does not touch declarations that contain no toghen() calls', async () => {
    const system = buildSystem();
    const css = 'a { color: red; font-size: 16px; }';
    const output = await process(css, system);
    assert.equal(output, css);
  });

  // ── structured W3C values ───────────────────────────────────────────────
  // resolveValue() returns the raw $value; for structured colors/dimensions
  // that is an object. These guard against the `[object Object]` regression.

  it('serialises a structured W3C color object to hex', async () => {
    const system = new DesignSystem();
    const colors = new Collection('colors');
    // #e5e7eb — components precise enough to round-trip exactly to 8-bit hex
    colors.setToken('gray', new DesignToken({ colorSpace: 'srgb', components: [0.898039, 0.905882, 0.921569] }, 'color'));
    system.addCollection(colors);

    const output = await process('a { color: toghen(colors.gray); }', system);
    assert.equal(output, 'a { color: var(--gray, #e5e7eb); }');
  });

  it('serialises a structured color with alpha to 8-digit hex', async () => {
    const system = new DesignSystem();
    const colors = new Collection('colors');
    colors.setToken('shadow', new DesignToken({ colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5 }, 'color'));
    system.addCollection(colors);

    const output = await process('a { color: toghen(colors.shadow); }', system);
    assert.equal(output, 'a { color: var(--shadow, #00000080); }');
  });

  it('serialises a structured { value, unit } dimension', async () => {
    const system = new DesignSystem();
    const spacing = new Collection('spacing');
    spacing.setToken('sm', new DesignToken({ value: 0.5, unit: 'rem' }, 'dimension'));
    spacing.setToken('pill', new DesignToken({ value: 9999, unit: 'px' }, 'dimension'));
    system.addCollection(spacing);

    const output = await process('.b { padding: toghen(spacing.sm); border-radius: toghen(spacing.pill); }', system);
    assert.equal(output, '.b { padding: var(--sm, 0.5rem); border-radius: var(--pill, 9999px); }');
  });

  it('serialises a fontFamily array as a comma-joined list', async () => {
    const system = new DesignSystem();
    const font = new Collection('font');
    font.setToken('sans', new DesignToken(['ui-sans-serif', 'system-ui', 'sans-serif'], 'fontFamily'));
    system.addCollection(font);

    const output = await process('body { font-family: toghen(font.sans); }', system);
    assert.equal(output, 'body { font-family: var(--sans, ui-sans-serif, system-ui, sans-serif); }');
  });

  it('emits both themes from one resolver document', async () => {
    // The guide's two-theme pattern used to be silently wrong against a real
    // resolver document: resolveToDesignSystem() yields a single-context
    // collection, so the `dark` argument returned the light value and both
    // blocks came out identical. resolveAllToDesignSystem() is what makes
    // the mode argument mean anything.
    const resolver = new Resolver({
      version: '2025-11-01',
      name: 'theme',
      sets: {
        base: { sources: [{ palette: { $type: 'color', white: { $value: '#ffffff' }, black: { $value: '#000000' } } }] },
      },
      modifiers: {
        theme: {
          contexts: {
            light: [{ colors: { $type: 'color', background: { $value: '{palette.white}' } } }],
            dark: [{ colors: { $type: 'color', background: { $value: '{palette.black}' } } }],
          },
          default: 'light',
        },
      },
      resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
    } as ResolverDocument);

    const system = resolver.resolveAllToDesignSystem();

    const output = await process(
      ':root { --bg: toghen(theme.colors.background, light); }' + '[data-theme="dark"] { --bg: toghen(theme.colors.background, dark); }',
      system,
    );

    assert.equal(output, ':root { --bg: #ffffff; }[data-theme="dark"] { --bg: #000000; }');
  });

  it('reports an undeclared mode through onUnresolved', async () => {
    const resolver = new Resolver({
      version: '2025-11-01',
      name: 'theme',
      sets: { base: { sources: [{ colors: { bg: { $value: '#ffffff', $type: 'color' } } }] } },
      resolutionOrder: [{ $ref: '#/sets/base' }],
    } as ResolverDocument);

    const system = resolver.resolveAllToDesignSystem();

    // Previously this returned the only context it had, without a word.
    await assert.rejects(() => process('a { color: toghen(theme.colors.bg, dark); }', system, undefined, 'throw'), /Mode 'dark' not found/);
  });
});

// ---------------------------------------------------------------------------
// Composite types — what this adapter can write, and what it refuses to.
//
// The founding defect of this file was `[object Object]` reaching a stylesheet:
// a structured colour resolved correctly by the core and stringified by the
// adapter. These tests exist because the same thing was still true of every
// composite type the core supports and this adapter did not, and because a
// fallback that produces plausible-looking CSS is how that survived.
// ---------------------------------------------------------------------------

describe('composite values', () => {
  /** A shadow in the W3C shape, built from parts rather than a hex string. */
  const shadow = (over: Record<string, unknown> = {}) => ({
    color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.3 },
    offsetX: { value: 0, unit: 'px' },
    offsetY: { value: 4, unit: 'px' },
    blur: { value: 12, unit: 'px' },
    ...over,
  });

  function systemWith(value: unknown, type = 'shadow'): DesignSystem {
    const system = new DesignSystem();
    const elevation = new Collection('elevation');
    elevation.setToken('raised', new DesignToken(value, type));
    system.addCollection(elevation);
    return system;
  }

  it('writes a shadow in CSS order, not object order', async () => {
    const output = await process('a { box-shadow: toghen(elevation.raised); }', systemWith(shadow()), undefined, 'throw');
    assert.equal(output, 'a { box-shadow: var(--raised, 0px 4px 12px #0000004d); }');
  });

  it('omits spread when the token does not carry one, and writes it when it does', async () => {
    const output = await process(
      'a { box-shadow: toghen(elevation.raised); }',
      systemWith(shadow({ spread: { value: 2, unit: 'px' } })),
      undefined,
      'throw',
    );
    assert.equal(output, 'a { box-shadow: var(--raised, 0px 4px 12px 2px #0000004d); }');
  });

  it('puts inset first, where CSS wants it', async () => {
    const output = await process('a { box-shadow: toghen(elevation.raised); }', systemWith(shadow({ inset: true })), undefined, 'throw');
    assert.equal(output, 'a { box-shadow: var(--raised, inset 0px 4px 12px #0000004d); }');
  });

  it('comma-joins several shadows, which is what box-shadow wants', async () => {
    const output = await process(
      'a { box-shadow: toghen(elevation.raised); }',
      systemWith([shadow(), shadow({ offsetY: { value: 8, unit: 'px' }, inset: true })]),
      undefined,
      'throw',
    );
    assert.equal(output, 'a { box-shadow: var(--raised, 0px 4px 12px #0000004d, inset 0px 8px 12px #0000004d); }');
  });

  it('refuses a shape it cannot write, rather than stringifying it', async () => {
    // Typography is several CSS properties, not one value — there is no
    // honest single spelling, so the adapter must say so.
    const typography = {
      fontFamily: 'Inter',
      fontSize: { value: 16, unit: 'px' },
      fontWeight: 500,
      lineHeight: 1.4,
      letterSpacing: { value: 0.2, unit: 'px' },
    };
    await assert.rejects(
      () =>
        process(
          'a { font: toghen(type.body); }',
          (() => {
            const s = new DesignSystem();
            const c = new Collection('type');
            c.setToken('body', new DesignToken(typography, 'typography'));
            s.addCollection(c);
            return s;
          })(),
          undefined,
          'throw',
        ),
      /No CSS serialisation for a value of shape[\s\S]*toghen\(path\.fontSize\)/,
    );
  });

  describe('members of a composite', () => {
    /** A typography block whose members are references, and a two-layer shadow. */
    function memberSystem(): DesignSystem {
      const px = (value: number) => ({ value, unit: 'px' });
      const ds = new Collection('ds');
      ds.setToken('font.size.md', new DesignToken({ value: 1, unit: 'rem' }, 'dimension'));
      ds.setToken('font.stack', new DesignToken(['Inter', 'sans-serif'], 'fontFamily'));
      ds.setToken(
        'type.body',
        new DesignToken(
          {
            fontFamily: '{font.stack}',
            fontSize: '{font.size.md}',
            fontWeight: 400,
            lineHeight: 1.5,
            letterSpacing: px(0),
          },
          'typography',
        ),
      );
      ds.setToken(
        'elevation.raised',
        new DesignToken(
          [shadow({ offsetY: px(1), blur: px(2) }), shadow({ color: { colorSpace: 'srgb', components: [0, 0, 1], alpha: 0.2 } })],
          'shadow',
        ),
      );
      const system = new DesignSystem();
      system.addCollection(ds);
      return system;
    }

    it('writes a typography member', async () => {
      const output = await process('p { font-size: toghen(ds.type.body.fontSize); }', memberSystem(), undefined, 'throw');
      assert.equal(output, 'p { font-size: var(--type-body-font-size, 1rem); }');
    });

    it("writes one shadow layer's colour as hex", async () => {
      const output = await process('a { --ink: toghen(ds.elevation.raised.1.color); }', memberSystem(), undefined, 'throw');
      assert.equal(output, 'a { --ink: #0000ff33; }');
    });

    it('composes the font shorthand from members', async () => {
      const output = await process(
        'p { font: toghen(ds.type.body.fontWeight) toghen(ds.type.body.fontSize)/toghen(ds.type.body.lineHeight) toghen(ds.type.body.fontFamily); }',
        memberSystem(),
        undefined,
        'throw',
      );
      assert.equal(
        output,
        'p { font: var(--type-body-font-weight, 400) var(--type-body-font-size, 1rem)/var(--type-body-line-height, 1.5) var(--type-body-font-family, Inter, sans-serif); }',
      );
    });
  });

  it('never lets [object Object] reach the stylesheet', async () => {
    // The whole point, stated as its own assertion: on the non-throwing
    // paths the directive is left intact and visible, so any build step
    // already checking for unresolved directives catches it.
    const system = systemWith({ some: 'shape', nobody: 'handles' }, 'custom');

    for (const mode of ['warn', 'ignore'] as const) {
      const output = await process('a { background: toghen(elevation.raised); }', system, undefined, mode);
      assert.doesNotMatch(output, /\[object Object\]/, `mode: ${mode}`);
      assert.match(output, /toghen\(elevation\.raised\)/, `mode: ${mode}`);
    }
  });
});

// ---------------------------------------------------------------------------
// The default failure path.
//
// `onUnresolved` defaults to `'warn'`, and until now no test ever passed that
// value — the string appeared in this file only inside the helper's type. The
// path deadlocked: `decl.root().toResult()` on a root that is mid-walk re-enters
// PostCSS's lazy processing and waits for the walk calling it. No error, no
// timeout, no output — the build simply stopped.
//
// HOW THIS REGRESSION WOULD ANNOUNCE ITSELF, stated because it is unpleasant:
// **the suite emits nothing at all.** Not a failure — nothing. Two guards were
// tried and neither works: a per-test `{ timeout }` does not fire, and racing
// the call against a timer inside the test does not either. The deadlock blocks
// the runner, and the runner buffers its report until the run ends, so a run
// that never ends prints no report.
//
// So the guard is that these tests EXIST and are run, not that they go red. A
// `pnpm test` that produces no output at all is this bug, and that sentence is
// the whole of the early warning available.
// ---------------------------------------------------------------------------

describe('onUnresolved, exercised on every branch', () => {
  function systemWithBlue(): DesignSystem {
    const system = new DesignSystem();
    const colors = new Collection('colors');
    colors.setToken('blue', new DesignToken('#0000ff', 'color'));
    system.addCollection(colors);
    return system;
  }

  it('warns and leaves the directive intact', async () => {
    const result = await postcss([toghenPlugin({ system: systemWithBlue(), onUnresolved: 'warn' })]).process(
      'a { color: toghen(colors.nope); }',
      { from: undefined },
    );

    assert.match(result.css, /toghen\(colors\.nope\)/);
    assert.equal(result.warnings().length, 1);
    assert.match(result.warnings()[0].text, /Cannot resolve token "colors\.nope"/);
  });

  it('ignores silently and leaves the directive intact', async () => {
    const result = await postcss([toghenPlugin({ system: systemWithBlue(), onUnresolved: 'ignore' })]).process(
      'a { color: toghen(colors.nope); }',
      { from: undefined },
    );

    assert.match(result.css, /toghen\(colors\.nope\)/);
    assert.equal(result.warnings().length, 0);
  });

  it('warns rather than hanging when the value has no CSS spelling', async () => {
    const system = new DesignSystem();
    const c = new Collection('type');
    c.setToken(
      'body',
      new DesignToken({ fontFamily: 'Inter', fontSize: { value: 16, unit: 'px' }, fontWeight: 400, lineHeight: 1.5 }, 'typography'),
    );
    system.addCollection(c);

    const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn' })]).process('a { font: toghen(type.body); }', {
      from: undefined,
    });

    assert.doesNotMatch(result.css, /\[object Object\]/);
    assert.equal(result.warnings().length, 1);
    // The message must name the right problem: the path was found, the shape
    // was not writable. Reporting this as «cannot resolve» sends the reader
    // hunting for a typo in a path that is correct.
    assert.match(result.warnings()[0].text, /Cannot write token "type\.body"/);
  });
});

// ---------------------------------------------------------------------------
// `@toghen path[, mode];` — a block expanded to its longhands.
// ---------------------------------------------------------------------------

describe('@toghen mixins, a typography token in one line', () => {
  const rem = (value: number) => ({ value, unit: 'rem' });
  const body = {
    fontFamily: ['Inter', 'sans-serif'],
    fontSize: rem(1),
    fontWeight: 400,
    lineHeight: 1.5,
    letterSpacing: rem(0.01),
    textTransform: 'uppercase',
  };

  function blockSystem(): DesignSystem {
    const ds = new Collection('ds', ['light', 'dark']);
    ds.setToken('type.body', new DesignToken(body, 'typography'));
    ds.setToken('font.size.md', new DesignToken(rem(1), 'dimension'));
    ds.setToken('font.stack', new DesignToken(['Inter', 'sans-serif'], 'fontFamily'));
    ds.setToken(
      'type.label',
      new DesignToken(
        {
          fontFamily: '{font.stack}',
          fontSize: '{font.size.md}',
          fontWeight: 600,
          lineHeight: 1.25,
        },
        'typography',
      ),
    );
    ds.setToken('type.themed', new DesignToken({ ...body, fontWeight: 400 }, 'typography'), 'light');
    ds.setToken('type.themed', new DesignToken({ ...body, fontWeight: 300 }, 'typography'), 'dark');
    ds.setToken(
      'elevation.raised',
      new DesignToken(
        [
          {
            color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.3 },
            offsetX: { value: 0, unit: 'px' },
            offsetY: { value: 4, unit: 'px' },
            blur: { value: 12, unit: 'px' },
          },
        ],
        'shadow',
      ),
    );
    const system = new DesignSystem();
    system.addCollection(ds);
    return system;
  }

  /** The body of one mixin of `@toghen mixins;`. */
  const mixin = async (name: string) =>
    (await process('@toghen mixins;', blockSystem(), undefined, 'throw'))
      .match(new RegExp(`@mixin ${name} \\{ ?([^}]*?) ?\\}`))?.[1]
      ?.replace(/\s+/g, ' ')
      .trim();

  it('writes a typography token as a mixin of one longhand per member, in order', async () => {
    assert.equal(
      await mixin('--type-body'),
      'font-family: var(--type-body-font-family, Inter, sans-serif); font-size: var(--type-body-font-size, 1rem); font-weight: var(--type-body-font-weight, 400); line-height: var(--type-body-line-height, 1.5); letter-spacing: var(--type-body-letter-spacing, 0.01rem); text-transform: var(--type-body-text-transform, uppercase)',
    );
  });

  it('writes members that are references as their resolved values', async () => {
    assert.equal(
      await mixin('--type-label'),
      'font-family: var(--type-label-font-family, Inter, sans-serif); font-size: var(--type-label-font-size, 1rem); font-weight: var(--type-label-font-weight, 600); line-height: var(--type-label-line-height, 1.25)',
    );
  });

  it('writes the mixin of the default mode', async () => {
    assert.match((await mixin('--type-themed'))!, /font-weight: var\(--type-themed-font-weight, 400\)/);
  });

  it('writes no mixin for a list (a shadow) or a value, which are written as one value', async () => {
    const css = await process('@toghen mixins;', blockSystem(), undefined, 'throw');
    assert.doesNotMatch(css, /@mixin --elevation/);
    assert.doesNotMatch(css, /@mixin --font-size-md/);
  });

  it('reports the retired block directive, and leaves it in place', async () => {
    const result = await postcss([toghenPlugin({ system: blockSystem(), onUnresolved: 'warn' })]).process('a { @toghen ds.type.body; }', {
      from: undefined,
    });

    assert.equal(result.css, 'a { @toghen ds.type.body; }');
    assert.equal(result.warnings().length, 1);
    assert.match(result.warnings()[0].text, /it is retired: use @apply --type-body; with @toghen mixins/);
  });
});

// ---------------------------------------------------------------------------
// references: 'var' — a layered stylesheet keeps its chain.
//
// A three-tier document (primitive → semantic → component) in the W3C
// structured shapes, with a dark context that re-points one semantic.
// ---------------------------------------------------------------------------

describe("references: 'var'", () => {
  const srgb = (r: number, g: number, b: number, alpha?: number) => ({
    colorSpace: 'srgb',
    components: [r, g, b],
    ...(alpha === undefined ? {} : { alpha }),
  });
  const px = (value: number) => ({ value, unit: 'px' });

  function layered(): DesignSystem {
    return new Resolver({
      version: '2025-11-01',
      name: 'ds',
      sets: {
        base: {
          sources: [
            {
              color: {
                $type: 'color',
                'blue-500': { $value: srgb(0, 0.4, 0.8) },
                'blue-300': { $value: srgb(0.4, 0.6, 1) },
                shade: { $value: srgb(0, 0, 0, 0.5) },
                ink: { $value: '#112233' },
              },
              surface: {
                $type: 'color',
                accent: { $value: '{color.blue-500}' },
                plain: { $value: '{color.blue-500}' },
              },
              button: { fill: { $type: 'color', $value: '{surface.accent}' } },
              font: {
                size: { md: { $type: 'dimension', $value: { value: 1, unit: 'rem' } } },
                stack: { $type: 'fontFamily', $value: ['Inter', 'sans-serif'] },
              },
              type: {
                $type: 'typography',
                body: { $value: { fontFamily: '{font.stack}', fontSize: '{font.size.md}', fontWeight: 400, lineHeight: 1.5 } },
                alias: { $value: '{type.body}' },
              },
              elevation: {
                raised: { $type: 'shadow', $value: [{ color: '{color.shade}', offsetX: px(0), offsetY: px(4), blur: px(12) }] },
              },
              card: { shadow: { $type: 'shadow', $value: '{elevation.raised}' } },
              rule: { $value: '1px solid {color.ink}' },
            },
          ],
        },
      },
      modifiers: {
        theme: {
          contexts: {
            light: [{}],
            dark: [{ surface: { $type: 'color', accent: { $value: '{color.blue-300}' } } }],
          },
          default: 'light',
        },
      },
      resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
    } as ResolverDocument).resolveAllToDesignSystem();
  }

  const run = async (css: string, options: Partial<Parameters<typeof toghenPlugin>[0]> = { references: 'var' }) =>
    (await postcss([toghenPlugin({ system: layered(), onUnresolved: 'throw', ...options })]).process(css, { from: undefined })).css;

  const tiers =
    ':root { --color-blue-500: toghen(ds.color.blue-500); --surface-accent: toghen(ds.surface.accent); --button-fill: toghen(ds.button.fill); }';

  it('writes one hop per tier, never skipping one', async () => {
    assert.equal(
      await run(tiers),
      ':root { --color-blue-500: #0066cc; --surface-accent: var(--color-blue-500); --button-fill: var(--surface-accent); }',
    );
  });

  it("leaves 'resolve', the default, unchanged", async () => {
    const resolved = ':root { --color-blue-500: #0066cc; --surface-accent: #0066cc; --button-fill: #0066cc; }';
    assert.equal(await run(tiers, {}), resolved);
    assert.equal(await run(tiers, { references: 'resolve' }), resolved);
  });

  it('lets the mode choose the target, and writes its literal', async () => {
    assert.equal(await run('a { color: toghen(ds.surface.accent, dark); }'), 'a { color: #6699ff; }');
  });

  it("writes a shadow layer's reference inside the shadow", async () => {
    assert.equal(
      await run('a { box-shadow: toghen(ds.elevation.raised); }'),
      'a { box-shadow: var(--elevation-raised, 0px 4px 12px var(--color-shade)); }',
    );
  });

  it('writes an interpolated reference inside its string', async () => {
    assert.equal(await run('a { border: toghen(ds.rule); }'), 'a { border: var(--rule, 1px solid var(--color-ink)); }');
  });

  it('writes the member properties of a typography token in its mixin, a reference to a block with members of its own', async () => {
    const css = (await run('@toghen mixins;')).replace(/\s+/g, ' ');
    assert.match(
      css,
      /@mixin --type-body \{[^}]*font-family: var\(--type-body-font-family, var\(--font-stack\)\); font-size: var\(--type-body-font-size, var\(--font-size-md\)\); font-weight: var\(--type-body-font-weight, 400\); line-height: var\(--type-body-line-height, 1.5\) \}/,
    );
    assert.match(css, /@mixin --type-alias \{[^}]*font-family: var\(--type-alias-font-family, var\(--font-stack\)\);/);
  });

  it('writes a member path as its reference, following a reference it walks through', async () => {
    assert.equal(
      await run('a { font-size: toghen(ds.type.body.fontSize); }'),
      'a { font-size: var(--type-body-font-size, var(--font-size-md)); }',
    );
    assert.equal(await run('a { color: toghen(ds.card.shadow.0.color); }'), 'a { color: var(--color-shade); }');
  });

  it('names properties with propertyName', async () => {
    const propertyName = (path: string) => `--t-${path.replaceAll('.', '_')}`;
    assert.equal(
      await run('a { color: toghen(ds.button.fill); } :root { @toghen declare ds.button; }', { references: 'var', propertyName }),
      'a { color: var(--t-ds_button_fill, var(--t-ds_surface_accent)); } :root { --t-ds_button_fill: var(--t-ds_surface_accent); }',
    );
  });

  describe('@toghen declare', () => {
    it('declares one custom property per token in the group', async () => {
      assert.equal(
        await run(':root { @toghen declare ds.surface; }'),
        ':root { --surface-accent: var(--color-blue-500); --surface-plain: var(--color-blue-500); }',
      );
    });

    it('declares resolved values when references are resolved', async () => {
      assert.equal(
        await run(':root { @toghen declare ds.surface; }', {}),
        ':root { --surface-accent: #0066cc; --surface-plain: #0066cc; }',
      );
    });

    it('in a mode, writes what resolves differently, dependents included', async () => {
      // --button-fill reads var(--surface-accent) in both modes, and still
      // must be re-declared: in a subtree it would otherwise keep the value
      // it was given at :root. --surface-plain resolves the same, and is not.
      assert.equal(
        await run('.panel { @toghen declare ds, dark; }'),
        '.panel { --surface-accent: var(--color-blue-300); --button-fill: var(--surface-accent); }',
      );
    });

    it('in the default mode named explicitly, writes everything', async () => {
      assert.equal(
        await run('.island { @toghen declare ds.surface, light; }'),
        '.island { --surface-accent: var(--color-blue-500); --surface-plain: var(--color-blue-500); }',
      );
    });

    it('compares against the parent context that from names', async () => {
      // A light island inside a dark panel: its parent already holds the
      // dark values, so what differs from dark is what must be re-declared.
      const island = '.island { @toghen declare ds, light from dark; }';
      assert.equal(await run(island), '.island { --surface-accent: var(--color-blue-500); --button-fill: var(--surface-accent); }');
      // Against its own mode nothing differs.
      assert.equal(await run('.p { color: red; @toghen declare ds, dark from dark; }'), '.p { color: red; }');
    });

    it('refuses a base that is not a mode, rather than writing everything', async () => {
      await assert.rejects(() => run('.p { @toghen declare ds, light from drak; }'), /Mode 'drak' not found/);
    });

    it('gives a block no property of its own, only its members', async () => {
      const css = await run(':root { @toghen declare ds.type; }');
      assert.doesNotMatch(css, /--type-body:/);
      assert.match(css, /--type-body-font-size: var\(--font-size-md\);/);
    });

    it('refuses outside a rule, and a group that names nothing', async () => {
      await assert.rejects(() => run('@toghen declare ds.surface;'), /declarations need a rule/);
      await assert.rejects(() => run(':root { @toghen declare ds.nothing; }'), /names no token/);
    });

    it('writes a whole layered sheet with no leaks', async () => {
      const css = await run(':root { @toghen declare ds; } [data-theme="dark"] { @toghen declare ds, dark; }');
      assert.doesNotMatch(css, /\[object Object\]|toghen\(|var\(--undefined\)/);
    });
  });
});
