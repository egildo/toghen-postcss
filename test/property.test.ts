import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const px = (value: number) => ({ value, unit: 'px' });
const rem = (value: number) => ({ value, unit: 'rem' });
const srgb = (r: number, g: number, b: number) => ({ colorSpace: 'srgb', components: [r, g, b] });

// One collection, named `ds`, with a token of each type and a theme that changes the colour and the px dimension.
function doc(name = 'ds'): ResolverDocument {
  return {
    version: '2025-11-01',
    name,
    sets: {
      base: {
        sources: [
          {
            field: {
              color: { $type: 'color', $value: srgb(0.1, 0.1, 0.1) },
              gap: { $type: 'dimension', $value: px(8) },
              indent: { $type: 'dimension', $value: rem(1.5) },
              transitionDuration: { $type: 'duration', $value: { value: 150, unit: 'ms' } },
              opacity: { $type: 'number', $value: 0.9 },
              fontFamily: { $type: 'fontFamily', $value: ['Inter', 'sans-serif'] },
              boxShadow: { $type: 'shadow', $value: { color: srgb(0, 0, 0), offsetX: px(0), offsetY: px(2), blur: px(4) } },
              font: {
                $type: 'typography',
                $value: { fontFamily: ['Inter', 'sans-serif'], fontSize: rem(1), fontWeight: 400, lineHeight: 1.5 },
              },
            },
          },
        ],
      },
    },
    modifiers: {
      theme: {
        default: 'light',
        contexts: { light: [], dark: [{ field: { color: { $value: srgb(1, 1, 1) }, gap: { $value: px(4) } } }] },
        $extensions: { 'com.toghen': { css: { contexts: { dark: { selector: "[data-theme='dark']" } } } } },
      },
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
  };
}

async function run(input: string, options: Partial<ToghenPluginOptions> = {}, document = doc()) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn', ...options })]).process(input, { from: undefined });
  return { css: result.css.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }').trim(), warnings: result.warnings().map((w) => w.text) };
}

describe('@property in @toghen contexts, with registerProperties', () => {
  const ON = { registerProperties: true } as const;

  it('registers a token of a type that has one syntax, with the default as its initial value', async () => {
    const out = await run('@toghen contexts ds.field;', ON);
    assert.deepEqual(out.warnings, []);
    assert.match(out.css, /@property --field-color \{ syntax: '<color>'; inherits: true; initial-value: #1a1a1a \}/);
    assert.match(out.css, /@property --field-gap \{ syntax: '<length>'; inherits: true; initial-value: 8px \}/);
    assert.match(out.css, /@property --field-transition-duration \{ syntax: '<time>'; inherits: true; initial-value: 150ms \}/);
    assert.match(out.css, /@property --field-opacity \{ syntax: '<number>'; inherits: true; initial-value: 0\.9 \}/);
  });

  it('writes none for a rem dimension, a shadow, a font family or a typography token', async () => {
    const out = await run('@toghen contexts ds.field;', ON);
    // rem is not computationally independent, so an initial-value in it would be invalid
    assert.doesNotMatch(out.css, /@property --field-indent/);
    assert.doesNotMatch(out.css, /@property --field-box-shadow|@property --field-font/);
    assert.equal((out.css.match(/@property/g) ?? []).length, 4);
  });

  it('takes the initial value from the default context, not from a block', async () => {
    const out = await run('@toghen contexts ds.field;', ON);
    assert.match(out.css, /@property --field-color \{[^}]*initial-value: #1a1a1a/);
    assert.match(out.css, /\[data-theme='dark'\] \{ --field-color: #ffffff; --field-gap: 4px \}/);
  });

  it('writes the initial value as a literal under references: var', async () => {
    const out = await run('@toghen contexts ds.field;', { ...ON, references: 'var' });
    assert.match(out.css, /@property --field-gap \{ syntax: '<length>'; inherits: true; initial-value: 8px \}/);
  });

  it("stands in the author's layer, before the sublayers", async () => {
    const out = await run('@layer tokens { @toghen contexts ds.field; }', ON);
    assert.match(out.css, /^@layer tokens \{ @layer defaults, theme; @property --field-color \{[^}]*\} .* @layer defaults \{ :root/);
  });

  it('is written once for a token, whatever the number of blocks', async () => {
    const out = await run('@toghen contexts ds.field;', ON);
    assert.equal((out.css.match(/@property --field-color /g) ?? []).length, 1);
  });
});

describe('@property in @toghen contexts, by default', () => {
  it('is not written: a registered property has an initial value and never takes a var() fallback', async () => {
    const out = await run('@toghen contexts ds.field;');
    assert.doesNotMatch(out.css, /@property/);
    assert.match(out.css, /^:root \{ --field-color: #1a1a1a;/);
  });

  it('is not written for a layer either', async () => {
    assert.doesNotMatch((await run('@layer tokens { @toghen contexts ds.field; }')).css, /@property/);
  });
});

describe('toghen() reads the custom property', () => {
  it('writes var() with the literal as the fallback, with no form and no mode', async () => {
    const out = await run(
      'a { color: toghen(ds.field.color); gap: t(ds.field.gap); transition-duration: t(ds.field.transitionDuration); }',
    );
    assert.equal(
      out.css,
      'a { color: var(--field-color, #1a1a1a); gap: var(--field-gap, 8px); transition-duration: var(--field-transition-duration, 150ms) }',
    );
  });

  it('writes the literal with as value, and with a mode', async () => {
    const out = await run(
      'a { color: t(ds.field.color as value); gap: t(ds.field.gap, theme=dark); color: toghen(ds.field.color, theme=dark); }',
    );
    assert.equal(out.css, 'a { color: #1a1a1a; gap: 4px; color: #ffffff }');
  });

  it('reads a structured family list and a shadow as one property each', async () => {
    const out = await run('a { font-family: t(ds.field.fontFamily); box-shadow: t(ds.field.boxShadow); }');
    assert.equal(
      out.css,
      'a { font-family: var(--field-font-family, Inter, sans-serif); box-shadow: var(--field-box-shadow, 0px 2px 4px #000000) }',
    );
    assert.doesNotMatch(out.css, /object Object|toghen\(/);
  });

  it("also reads inside a token layer's hand-written declarations", async () => {
    const out = await run('@layer tokens { :root { --alias: t(ds.field.color); } }');
    assert.equal(out.css, '@layer tokens { :root { --alias: var(--field-color, #1a1a1a) } }');
  });

  it('does not read a property from its own declaration, which would be a cycle', async () => {
    const out = await run(':root { --field-color: t(ds.field.color); }');
    assert.equal(out.css, ':root { --field-color: #1a1a1a }');
  });
});

describe('the collection segment of a path', () => {
  it('may be left out when the system has one collection', async () => {
    const out = await run('a { color: t(field.color); gap: t(ds.field.gap); }');
    assert.equal(out.css, 'a { color: var(--field-color, #1a1a1a); gap: var(--field-gap, 8px) }');
  });

  it('may be left out of the argument of contexts and of mixins', async () => {
    const contexts = await run('@toghen contexts field;');
    const full = await run('@toghen contexts ds.field;');
    assert.equal(contexts.css, full.css);
    const whole = await run('@toghen contexts;');
    assert.equal(whole.css, (await run('@toghen contexts ds;')).css);
    assert.equal((await run('@toghen mixins;')).css, (await run('@toghen mixins ds;')).css);
  });

  it("is read as written when the first segment is the collection's name", async () => {
    // a group that has the collection's name: `ds.ds.x` is the path under the collection, `ds.x` is the collection's own
    const d = doc();
    (d.sets as any).base.sources[0].ds = { x: { $type: 'number', $value: 1 } };
    const out = await run('a { v: t(ds.x); w: t(ds.ds.x); }', {}, d);
    assert.equal(out.css, 'a { v: t(ds.x); w: var(--ds-x, 1) }');
    assert.match(out.warnings[0], /ds\.x/);
  });

  it('is not guessed with two collections', async () => {
    const system = new Resolver(doc('ds')).resolveContextsToDesignSystem();
    const other = new Resolver(doc('other')).resolveContextsToDesignSystem();
    for (const name of other.getCollectionNames()) system.addCollection(other.getCollection(name)!);
    const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn' })]).process('a { color: t(field.color); }', {
      from: undefined,
    });
    assert.match(result.warnings()[0].text, /Collection 'field' not found/);
  });
});
