import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const px = (value: number) => ({ value, unit: 'px' });
// With its `hex`, so a reference to it can be interpolated into a string.
const srgb = (v: number) => {
  const byte = Math.round(v * 255)
    .toString(16)
    .padStart(2, '0');
  return { colorSpace: 'srgb', components: [v, v, v], hex: `#${byte}${byte}${byte}` };
};

// Two independent modifiers: theme switches by media query (and one context by
// class), density by attribute. `card.border` depends on both.
function doc(css: Record<string, unknown> = {}): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            color: { $type: 'color', line: { $value: srgb(0.8) }, bg: { $value: srgb(1) } },
            border: { width: { $type: 'dimension', $value: px(2) } },
            gap: { $type: 'dimension', $value: px(8) },
            card: { border: { $type: 'string', $value: '{border.width} solid {color.line}' } },
          },
        ],
      },
    },
    modifiers: {
      theme: {
        default: 'light',
        contexts: {
          light: [],
          dark: [{ color: { line: { $value: srgb(0.2) }, bg: { $value: srgb(0) } } }],
          contrast: [{ color: { line: { $value: srgb(0) } } }],
        },
        // `light`, the default, has no spelling: it gets no block and no error.
        $extensions: {
          'com.toghen': {
            css: {
              contexts: { dark: { atRule: '@media (prefers-color-scheme: dark)' }, contrast: { selector: '.high-contrast' } },
            },
          },
        },
      },
      density: {
        default: 'cosy',
        contexts: { cosy: [], compact: [{ gap: { $value: px(4) }, border: { width: { $value: px(1) } } }] },
        ...css,
      },
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }, { $ref: '#/modifiers/density' }],
  };
}

const DENSITY = { $extensions: { 'com.toghen': { css: { selector: "[data-density='{context}']" } } } };

async function run(css: string, document: ResolverDocument, options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'throw', ...options })]).process(css, { from: undefined });
  // New rules come out over several lines; what matters is what is in them.
  return { css: result.css.replace(/\s+/g, ' ').trim(), warnings: result.warnings().map((w) => w.text) };
}

describe('a mode named by one context', () => {
  it('works in toghen() and in @toghen declare, against the defaults or a named base', async () => {
    const out = await run(
      'a { margin: toghen(ds.gap, density=compact); } .c { @toghen declare ds, density=compact; } .d { @toghen declare ds.color, theme=light from theme=dark; }',
      doc(DENSITY),
    );
    assert.equal(
      out.css,
      'a { margin: 4px; } .c { --border-width: 1px; --gap: 4px; --card-border: 1px solid #cccccc; } .d { --color-line: #cccccc; --color-bg: #ffffff; }',
    );
  });
});

describe('a mode argument', () => {
  it('matches modifier and context names regardless of case', async () => {
    const out = await run(
      'a { margin: toghen(ds.gap, Density=COMPACT); } .c { @toghen declare ds.gap, DENSITY=compact; } .d { @toghen declare ds.color, Theme=Light from THEME=Dark; }',
      doc(DENSITY),
    );
    assert.equal(out.css, 'a { margin: 4px; } .c { --gap: 4px; } .d { --color-line: #cccccc; --color-bg: #ffffff; }');
  });

  it('still refuses a name that matches in no case, as written', async () => {
    await assert.rejects(
      run('a { margin: toghen(ds.gap, Density=tight); }', doc(DENSITY)),
      /\(mode: Density=tight\).*modifier 'density' has no context 'tight'/,
    );
  });
});

describe('@toghen contexts', () => {
  it('writes the defaults, then a complete block for every context that has a spelling, the default included', async () => {
    const out = await run('@toghen contexts ds;', doc(DENSITY), { references: 'var' });
    assert.equal(
      out.css,
      [
        ':root { --color-line: #cccccc; --color-bg: #ffffff; --border-width: 2px; --gap: 8px; --card-border: var(--border-width) solid var(--color-line) }',
        // theme: `light` has no spelling, so no block. `dark` holds every token theme varies, `bg` included.
        '@media (prefers-color-scheme: dark) { :root { --color-line: #333333; --color-bg: #000000; --card-border: var(--border-width) solid var(--color-line) } }',
        // `contrast` leaves `bg` at the default's value, and writes it anyway: the block is complete.
        '.high-contrast { --color-line: #000000; --color-bg: #ffffff; --card-border: var(--border-width) solid var(--color-line) }',
        // density: the default `cosy` is spelled, so it has a block.
        "[data-density='cosy'] { --border-width: 2px; --gap: 8px; --card-border: var(--border-width) solid var(--color-line) }",
        "[data-density='compact'] { --border-width: 1px; --gap: 4px; --card-border: var(--border-width) solid var(--color-line) }",
      ].join(' '),
    );
    assert.deepEqual(out.warnings, []);
  });

  it('writes a dependent of a varied token with its own value, and nothing for a modifier that varies nothing', async () => {
    const d = doc(DENSITY);
    // `calm` changes nothing the tokens say.
    (d.modifiers as any).calm = { default: 'on', contexts: { on: [], off: [] }, ...DENSITY };
    (d.resolutionOrder as any).push({ $ref: '#/modifiers/calm' });
    const out = await run('@toghen contexts ds.card;', d);
    assert.doesNotMatch(out.css, /data-calm/);
    // resolved values: the dependent is a different string in each density
    assert.match(out.css, /\[data-density='compact'\] \{ --card-border: 1px solid #cccccc \}/);
    assert.match(out.css, /\[data-density='cosy'\] \{ --card-border: 2px solid #cccccc \}/);
  });

  it('writes the W3C structured shapes: colour, dimension and a fontFamily array', async () => {
    const d: ResolverDocument = {
      version: '2025-11-01',
      name: 'ds',
      sets: {
        base: {
          sources: [
            {
              bg: { $type: 'color', $value: srgb(1) },
              pad: { $type: 'dimension', $value: px(8) },
              face: { $type: 'fontFamily', $value: ['Inter', 'sans-serif'] },
            },
          ],
        },
      },
      modifiers: {
        mood: {
          default: 'calm',
          contexts: {
            calm: [],
            loud: [{ bg: { $value: srgb(0) }, pad: { $value: { value: 0.5, unit: 'rem' } }, face: { $value: ['Mono', 'monospace'] } }],
          },
          $extensions: { 'com.toghen': { css: { selector: '.mood-{context}' } } },
        },
      },
      resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/mood' }],
    };
    const out = await run('@toghen contexts ds;', d);
    assert.equal(
      out.css,
      `:root { --bg: #ffffff; --pad: 8px; --face: Inter, sans-serif } .mood-calm { --bg: #ffffff; --pad: 8px; --face: Inter, sans-serif } .mood-loud { --bg: #000000; --pad: 0.5rem; --face: Mono, monospace }`,
    );
    assert.doesNotMatch(out.css, /object Object|toghen\(/);
  });

  it('warns, under resolved values, about a token that changes under two modifiers', async () => {
    const out = await run('@toghen contexts ds;', doc(DENSITY));
    assert.deepEqual(out.warnings, [
      "[@toghen/postcss] --card-border changes under 'theme' and 'density'. Written as resolved values, the later block wins where both apply, which is right only if its value does not depend on both. Use references: 'var', or declare the combination yourself.",
    ]);
  });

  it('writes under a root selector of your own', async () => {
    const out = await run('@toghen contexts ds.gap;', doc(DENSITY), { rootSelector: '.ds' });
    assert.equal(out.css, ".ds { --gap: 8px } [data-density='cosy'] { --gap: 8px } [data-density='compact'] { --gap: 4px }");
  });

  it('refuses a context the document gives no selector', async () => {
    await assert.rejects(
      run('@toghen contexts ds;', doc()),
      /Cannot write context 'compact' of modifier 'density': the resolver document gives it no CSS selector/,
    );
  });

  it('reports a non-default context with no spelling, on warn, and writes the rest', async () => {
    const out = await run('@toghen contexts ds;', doc(), { onUnresolved: 'warn' });
    assert.match(out.warnings[0], /Cannot write context 'compact' of modifier 'density'/);
    assert.doesNotMatch(out.css, /data-density/);
  });

  it('refuses to sit inside a rule', async () => {
    await assert.rejects(run('a { @toghen contexts ds; }', doc(DENSITY)), /inside a rule/);
  });

  it("keeps the library's sentence for a context whose at-rule does not start with @", async () => {
    const out = await run(
      '@toghen contexts ds;',
      doc({ $extensions: { 'com.toghen': { css: { atRule: 'media (min-width: {context})' } } } }),
      { onUnresolved: 'warn' },
    );
    assert.deepEqual(out.warnings, [
      `[@toghen/postcss] Cannot write the contexts of "ds": The CSS selector of context 'compact' of modifier 'density': atRule must start with '@', got 'media (min-width: compact)'.`,
    ]);
  });

  it('refuses two non-default contexts spelled the same, and writes nothing for that modifier', async () => {
    const document = doc(DENSITY);
    document.modifiers!.theme.$extensions = { 'com.toghen': { css: { selector: '.alt' } } };
    const out = await run('@toghen contexts ds;', document, { onUnresolved: 'warn' });
    assert.deepEqual(out.warnings, [
      "[@toghen/postcss] Cannot write the contexts of modifier 'theme': contexts 'dark' and 'contrast' have the same CSS spelling, so neither block could be told from the other. Give each its own selector or at-rule.",
    ]);
    assert.doesNotMatch(out.css, /\.alt/);
    assert.match(out.css, /\[data-density='compact'\]/);
    await assert.rejects(run('@toghen contexts ds;', document), /contexts 'dark' and 'contrast' have the same CSS spelling/);
  });

  it("says what it was writing, and the library's sentence names the token, for a reference to a non-scalar inside a string", async () => {
    // A fontFamily list cannot be interpolated into a string: the library throws InvalidInterpolationError.
    const document = doc(DENSITY);
    const source = (document.sets as any).base.sources[0];
    source.font = { base: { $type: 'fontFamily', $value: ['Inter', 'Helvetica Neue', 'sans-serif'] } };
    source.card.label = { $type: 'string', $value: 'set in {font.base}' };
    const sentence =
      'Reference {font.base} inside the string value of token "ds.card.label" at $value (mode "light/cosy") resolved to an array, which cannot be interpolated into a string. Use the reference as the entire $value instead.';
    const contexts = await run('@toghen contexts ds;', document, { onUnresolved: 'warn' });
    assert.deepEqual(contexts.warnings, [`[@toghen/postcss] Cannot write the contexts of "ds": ${sentence}`]);
    const mixins = await run('@toghen mixins ds;', document, { onUnresolved: 'warn' });
    assert.deepEqual(mixins.warnings, [`[@toghen/postcss] Cannot write the mixins of "card": ${sentence}`]);
    await assert.rejects(run('@toghen contexts ds;', document), {
      message: /Cannot write the contexts of "ds": Reference \{font\.base\} inside the string value of token "ds\.card\.label"/,
    });
  });
});

describe('@toghen contexts — the order of the modifiers', () => {
  // Declared density first, applied theme first: the cascade follows the order modifiers win in; a list, the declared order.
  const declaredOtherwise = (): ResolverDocument => {
    const d = doc(DENSITY);
    return { ...d, modifiers: { density: d.modifiers!.density, theme: d.modifiers!.theme } };
  };

  it('writes the layers and the blocks in the order modifiers win in, and the mixins and the spellings in the declared order', async () => {
    const out = await run('@layer tokens { @toghen contexts ds; } @toghen mixins ds; @toghen spellings ds;', declaredOtherwise());
    const at = (s: string) => out.css.indexOf(s);
    assert.match(out.css, /@layer tokens \{ @layer defaults, theme, density;/);
    assert.ok(at('@layer defaults {') < at('@layer theme {') && at('@layer theme {') < at('@layer density {'));
    assert.ok(at('--when-density-cosy') < at('--when-density-compact'));
    assert.ok(at('--when-density-compact') < at('--when-theme-dark') && at('--when-theme-dark') < at('--when-theme-contrast'));
    assert.ok(at(':--density-compact') < at(':--theme-contrast'));
    assert.match(
      out.css,
      /@custom-selector :--density-cosy \[data-density='cosy'\]; @custom-selector :--density-compact \[data-density='compact'\]; @custom-selector :--theme-contrast \.high-contrast; @custom-media --theme-dark \(prefers-color-scheme: dark\);/,
    );
    assert.doesNotMatch(out.css, /object Object|toghen\(/);
  });
});
