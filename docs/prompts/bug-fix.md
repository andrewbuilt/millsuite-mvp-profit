# Template: bug fix

Use for: fixing a regression or a newly-discovered bug. Tighter than new-feature; emphasis on root cause + regression protection.

```
Bug: <one-sentence description>

Symptom: <what the user saw>
Repro: <minimum steps to reproduce>

Root cause: <what's actually wrong in the code>
  Evidence: <file:line references and grep output that proves it>

Fix:

File: <path>
  <specific change — exact code if small, instruction if large>

If the fix could regress a related feature, also touch:
  <other files that need updating>

────────────────────────────────────────────────────
DEFENSIVE GUARD (optional)
────────────────────────────────────────────────────

If the bug had no clear single cause, add a defensive guard that
fails loudly rather than silently:
  - console.warn at the offending site
  - validation at the entry point
  - a comment explaining why the guard exists

Document any guard in code comments so it doesn't get removed
accidentally during cleanup.

────────────────────────────────────────────────────
VERIFICATION
────────────────────────────────────────────────────

- grep -n "<offending pattern>" <file>
  (must NOT show the buggy shape, OR must show the fix predicate)
- Smoke test:
  1. Reproduce the original bug — confirm it's now fixed.
  2. Test the related path that worried us — confirm no regression.
- git log --oneline -3 main after merge.

────────────────────────────────────────────────────
GROUND RULES
────────────────────────────────────────────────────

- One PR. Don't pile feature work onto a bug fix.
- Rebase on origin/main.
- Andrew merges.
- Paste verification + git log -3 in PR description.
```
