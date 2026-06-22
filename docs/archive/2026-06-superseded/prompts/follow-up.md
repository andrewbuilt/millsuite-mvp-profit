# Template: follow-up commit on an open PR

Use for: a small additional change pushed to an already-open PR (typo, copy, additional verification, missed sub-bug from a parent fix).

```
PR #<N> follow-up — <one-sentence description of the additional change>.

Context: <what's already in the PR + why this commit is needed on top>

Change:

File: <path>
  <specific change>

────────────────────────────────────────────────────
VERIFICATION
────────────────────────────────────────────────────

- grep -n "<predicate>" <file>
- Smoke test: <single step confirming the additional change works>

Push the new commit to the existing branch (do NOT open a separate
PR). Update the PR description to note the follow-up.

────────────────────────────────────────────────────
GROUND RULES
────────────────────────────────────────────────────

- Push to the existing branch, not a new one.
- Andrew merges the consolidated PR.
- Don't squash unless asked — keep the follow-up as its own commit
  for traceability.
```
