# Template: rebase a stale branch onto current main

Use for: a feature branch that was cut weeks ago and is now behind main, where you want to ship its work without reverting more recent commits.

```
The branch `<branch-name>` was created before <recent commit / PR>
and is now N commits behind main. Its diff includes stale changes
that would revert work currently on main if merged as-is. Rebase
cleanly.

Steps:
1. `git fetch origin && git checkout <branch-name>`
2. `git rebase origin/main`
3. During rebase, DROP these hunks — they're stale and would revert
   work that's already on main:
   - <list of file path + brief description of what to drop>
4. Reconcile <conflicting file> against <recent change> — keep both
   the new feature AND the conflicting concurrent change.
5. Push and open a fresh PR titled "<branch>: rebase onto main".

────────────────────────────────────────────────────
VERIFICATION (run all, paste output)
────────────────────────────────────────────────────

- grep -n "<feature-distinctive symbol>" <file>
  (must show the feature still wired)
- grep -n "<recent-conflicting symbol>" <other file>
  (must show the concurrent work preserved)
- git log --oneline -5 main after merge.

If any verification grep returns wrong, do not declare done — fix first.

────────────────────────────────────────────────────
GROUND RULES
────────────────────────────────────────────────────

- Andrew merges. Do not self-merge.
- Open a fresh PR; don't force-push to a stale PR.
- Close the original stale PR with a comment pointing to the new one.
```
