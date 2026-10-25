## House rule: the feature folder is named by date

This overrides the numbering in the step "Create the spec feature directory" below. Ignore `feature_numbering` in `.specify/init-options.json` and ignore any running number.

- The prefix is today's date as `YYYY-MM-DD` (for example `2026-10-25`), then a hyphen, then the short name.
- The folder is `specs/<YYYY-MM-DD>-<short-name>`. Two features on one day differ by their short names.
- If `SPECIFY_FEATURE_DIRECTORY` is given by the user, use it as is.
- Write the resolved folder to `.specify/feature.json` as the step says. Every later command finds the feature there, not by its name.

The spec template in this repository has Findings, Questions and Answers sections. Fill Findings by reading the code, with a path and line for each. Put every decision the owner must make in Questions, with context, alternatives and a recommendation. Leave Answers empty.

