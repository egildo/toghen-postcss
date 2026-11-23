# Browser measurements

The fixtures (`c1.html` to `c7.html`, and the pages in `c9/`), the script that reads them (`run.mjs`), the chain check (`c8/`) and the recorded results (`RESULTS.md`). The CSS claims in the postcss and lib docs link here.

To run them again, copy this folder to a scratch folder outside the repository, then there:

```sh
npm init -y && npm install playwright-core
npx playwright-core install chromium webkit
node run.mjs
```

`run.mjs` reads the fixtures from the folder it runs in (`path.resolve('.')`) and imports `playwright-core` from the nearest `node_modules`, so it needs no edit. Firefox is tried and reported `UNAVAILABLE` unless you also install it. The script prints computed values per engine and page colour scheme; compare them with `RESULTS.md`.

## Claim 8: `c8/`

`c8/docs.mjs` holds the synthetic resolver documents and `c8/run.mjs` runs the **built** plugin on them (`pnpm build` at the root first), nests up to three elements each setting one `modifier=context`, reads each consumer's computed value in Chromium and WebKit, and compares it with `Resolver.valueAt()`. It prints `N/M` per document, engine and output form and lists the first mismatches.

To run it, copy `c8/` to a scratch folder outside the repository, install `playwright-core` there as above, and say where the repository is:

```sh
TOGHEN_ROOT=/path/to/Toghen node run.mjs
```

It imports the plugin, `@toghen/lib` and `postcss` from `TOGHEN_ROOT` and `playwright-core` from the nearest `node_modules`. It is not part of `pnpm test`, because it needs browsers.

## Claim 9: `c9/`

The three pages in `c9/` hold one `light-dark()` modifier's output: as the plugin writes it, and after Lightning CSS 1.33.0 at Vite 8's default targets, with and without `color-scheme` in the sheet it lowers. `run.mjs` reads them with the other fixtures.

`c9/build.mjs` writes the pages again from the **built** plugin (`pnpm build` at the root first). It needs Lightning CSS in the scratch folder as well:

```sh
npm install lightningcss@1.33.0
TOGHEN_ROOT=/path/to/postcss node c9/build.mjs
```

It imports the plugin, `@toghen/lib` and `postcss` from `TOGHEN_ROOT`, and `lightningcss` from the nearest `node_modules`.
