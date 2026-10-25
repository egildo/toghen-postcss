
## House pass: the living docs

Run this pass together with the detection passes above, before you write the report. Its findings go into that same report, not into a separate one. It is as read-only as the rest: change no file.

### What to read

1. From the plan, list the packages the feature touches. In a repository that holds one package, that is the package.
2. For each of those packages, read its living docs:
   - `guide.md`, `reference.md`, `specs.md` and `decisions.md`, where they exist;
   - any other doc that the repository's `CLAUDE.md` lists for the package.
3. Read the code the feature touches, so the docs can be checked against it.

Do not read the docs of packages the feature does not touch.

### What to report

Report each place where the docs disagree, under the category "Living docs":

- two docs disagree with each other (for example `guide.md` says one thing and `specs.md` another);
- a doc disagrees with the code (a name, a signature, a path, a default, a count, a step that no longer exists). Cite the doc location and the code location as path and line;
- a doc other than `reference.md` restates a type shape instead of linking to it, because `reference.md` owns every type shape;
- a doc still describes something that `decisions.md` records as superseded;
- a dated entry in `decisions.md` was rewritten instead of added to, if the history shows it;
- a link or anchor in a living doc points at nothing.

Say which side you judge to be right, and why. If you cannot tell, say so.

Add these findings to the main table with the category "Living docs" and the usual severity. Use HIGH when a doc tells a reader to do something that fails. Use MEDIUM for a stale name or number. Use LOW for wording.

### Fold check

Check that `tasks.md` ends with a Fold phase that covers `specs.md`, `reference.md` where the package has one, `guide.md`, the dated entry in `decisions.md`, and the Folded mark on the spec. If the last phase is anything else, or Fold is missing, that is CRITICAL.

### Register check

Report any place where a number or code from the working papers (a story label, a requirement code, a question number, a task id) is written into a living doc. Those stay inside the feature folder.
