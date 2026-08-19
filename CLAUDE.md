# BlueLink

**Read [HANDOFF.md](HANDOFF.md) before changing anything.** It holds the
decisions, the traps that cost real debugging time, and the open items. This file
is only the pointer, because Claude Code loads it automatically.

The three things worth knowing before you touch a key:

1. **Verify by looking, not by building.** Every real defect here was found with
   `scripts/qa/*` or a screenshot, never by a passing type check.
2. **Commit as `Shadow_Lu <xshadowlu13@gmail.com>`** (repo-local git config
   already does this) and **never** add a `Co-Authored-By: Claude` trailer.
3. **`git fetch` first.** A 4-hourly cron pushes refreshed `public/data`, so you
   are usually behind.
