import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import postcssCustomMedia from 'postcss-custom-media';
import postcssCustomSelectors from 'postcss-custom-selectors';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

// `@toghen spellings;` names every spelling of the vocabulary and of the contexts. Synthetic tokens, structured shapes.
const srgb = (r: number, g: number, b: number) => ({ colorSpace: 'srgb', components: [r, g, b] });
const color = (value: unknown) => ({ $type: 'color', $value: value });

const parts = (vocabulary: unknown) => ({ $extensions: { 'com.toghen': { css: { parts: vocabulary } } } });

function doc(vocabulary: unknown, groups: Record<string, unknown> = {}, contexts: Record<string, unknown> = {}): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            ...parts(vocabulary),
            ui: {
              button: { background: color(srgb(1, 1, 1)) },
              checkbox: { ...(groups.checkbox as object), background: color(srgb(1, 1, 1)) },
            },
          },
        ],
      },
    },
    modifiers: {
      theme: {
        default: 'light',
        contexts: { light: [], dark: [{ ui: { button: { background: { $value: srgb(0, 0, 0) } } } }], contrast: [], print: [] },
        $extensions: {
          'com.toghen': {
            css: {
              contexts: {
                dark: { selector: "[data-theme='dark']" },
                contrast: { atRule: '@media (prefers-contrast: more)' },
                print: { selector: '.print', atRule: '@media print' },
                ...contexts,
              },
            },
          },
        },
      },
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
  };
}

const VOCABULARY = {
  state: { hover: ':hover', disabled: ":is(&:disabled, [aria-disabled='true'] &)" },
  input: { fine: '@media (pointer: fine)', supported: '@supports (display: grid)' },
};

const norm = (css: string) => css.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }').trim();

async function toghen(input: string, document = doc(VOCABULARY), options: Partial<ToghenPluginOptions> = {}) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn', ...options })]).process(input, { from: undefined });
  return { css: norm(result.css), warnings: result.warnings().map((w) => w.text) };
}

describe('@toghen spellings', () => {
  it('names the vocabulary and the contexts: a selector as @custom-selector, a @media as @custom-media', async () => {
    const out = await toghen('@toghen spellings;');
    assert.deepEqual(out.warnings, []);
    assert.equal(
      out.css,
      "@custom-selector :--state-hover :hover; @custom-selector :--theme-dark [data-theme='dark']; @custom-selector :--theme-print .print; " +
        '@custom-media --input-fine (pointer: fine); @custom-media --theme-contrast (prefers-contrast: more); @custom-media --theme-print print; ' +
        '/* :--state-disabled is left out: the state "disabled" holds "&", and a custom selector is a selector, with no place for a part to stand relative to a rule. */ ' +
        '/* --input-supported is left out: the input "supported" is an @supports spelling, and @supports has no named form. */',
    );
  });

  it("names a value a group overrides with the group's path, and leaves a repeated spelling alone", async () => {
    const document = doc(VOCABULARY, {
      checkbox: parts({ state: { hover: ':hover', pressed: ':is(:checked, :indeterminate)' } }),
    });
    const out = await toghen('@toghen spellings;', document);
    assert.match(out.css, /@custom-selector :--ui-checkbox-state-pressed :is\(:checked, :indeterminate\);/);
    assert.doesNotMatch(out.css, /ui-checkbox-state-hover/);
  });

  it('is an error, always, when two spellings are written as one name', async () => {
    // a vocabulary axis named for a context: `--theme-dark` twice, as selectors
    const vocabulary = { theme: { dark: '.dark' } };
    for (const onUnresolved of ['warn', 'ignore', 'throw'] as const) {
      await assert.rejects(
        toghen('@toghen spellings;', doc(vocabulary), { onUnresolved }),
        /are both written as @custom-selector :--theme-dark\. Rename one of them/,
      );
    }
  });

  it('is refused inside a rule or a layer, like mixins', async () => {
    const inRule = await toghen('.a { @toghen spellings; }');
    assert.match(inRule.warnings[0], /Cannot write the spellings of "ds" inside a rule/);
    const inLayer = await toghen('@layer tokens { @toghen spellings; }');
    assert.match(inLayer.warnings[0], /Cannot write the spellings of "ds" inside a layer/);
  });

  it('also answers to @t, and refuses a collection that is not one', async () => {
    assert.match((await toghen('@t spellings;')).css, /^@custom-selector :--state-hover :hover;/);
    assert.match((await toghen('@toghen spellings ds.ui;')).warnings[0], /the argument is a collection/);
  });

  it('leaves the mixins on their literal spellings', async () => {
    const out = await toghen('@toghen mixins;');
    assert.doesNotMatch(out.css, /custom-selector|custom-media|:--/);
  });
});

describe("the polyfills expand the names an author's own rules use", () => {
  it('postcss-custom-media and postcss-custom-selectors expand them in one pipeline', async () => {
    const system = new Resolver(doc(VOCABULARY)).resolveContextsToDesignSystem();
    const result = await postcss([toghenPlugin({ system }), postcssCustomMedia(), postcssCustomSelectors()]).process(
      `@toghen spellings;
             .a:--state-hover { color: red; }
             :--theme-dark .b { color: blue; }
             @media (--input-fine) { .c { color: green; } }`,
      { from: undefined },
    );
    const css = norm(result.css);
    assert.match(css, /\.a:is\(:hover\) \{ color: red }/);
    assert.match(css, /:is\(\[data-theme='dark'\]\) \.b \{ color: blue }/);
    assert.match(css, /@media \(pointer: fine\) \{ \.c \{ color: green } }/);
    assert.doesNotMatch(css, /--state-hover|--theme-dark|--input-fine/);
  });
});
