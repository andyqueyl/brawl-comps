---
name: brawl-maintenance
description: Weekly health check and maintenance for the Brawl Comps site (andyqueyl.github.io/brawl-comps). Use when the user asks to check on, update, refresh, fix or maintain the Brawl site or its data; when a "Data update" GitHub Action failed; when the API key needs replacing; or when squad members change. Triggers on "check brawl", "update brawl", "is the brawl site working", "brawl data is old", "add a friend to brawl", "new API key".
---

# Brawl Comps maintenance

Read `CLAUDE.md` in the repo root first. It has the owner's requirements, the model, and why things are built the way they are. This skill is the routine.

The data refreshes itself: squad and rotation daily at 09:00 UTC, the top-player meta Mondays at 14:00 UTC. Each data commit redeploys GitHub Pages. "Update brawl" therefore usually means **check that the automation worked**, not republish anything.

## 1. Health check (always start here)

```sh
cd ~/Desktop/"Coding Projects"/brawl-comps
git pull --rebase -q
gh run list --repo andyqueyl/brawl-comps --workflow "Data update" --limit 10
node -e 'for (const f of ["squad","meta","rotation"]) { const d=require("./data/"+f+".json"); console.log(f.padEnd(9), d.updated) }'
```

Healthy means:
- A green run every day, and a green Monday run.
- `squad` and `rotation` updated within ~1 day, `meta` within 7 days.

For the latest Monday run, read its log:

```sh
gh run view <run-id> --repo andyqueyl/brawl-comps --log | grep -E "battles across|side win rate|could not load|403|Error"
```

Expect about 40,000 new battles, and `top-player side win rate (removed): {"all": ~65...}`.
- **Far fewer battles:** the proxy or API is failing.
- **Side win rate near 50%:** the sampling or `debias()` broke. Investigate before trusting the site.

Then load https://andyqueyl.github.io/brawl-comps/ (curl for 200, or a browser if one is available). Check that the nav stamp shows recent dates.

Report to the user in a few lines: which runs passed, data dates, anything wrong. Say plainly what you didn't check.

## 2. Fix by symptom

| Symptom | Fix |
|---|---|
| Runs fail with 403 / `accessDenied` / invalid IP | The key is dead or not whitelisting `45.79.218.79`. Ask Andy to create a new key at developer.brawlstars.com with that IP; you can't create keys. Then: `printf %s "<token>" \| gh secret set BS_API_KEY --repo andyqueyl/brawl-comps`, update `.env`, and re-run step 3. Never echo the token or commit it. |
| Runs fail on network, or report almost no battles | RoyaleAPI's proxy (`bsproxy.royaleapi.dev`) is likely down. Re-run later. If it lasts, tell Andy; a direct call needs a key whitelisting a fixed IP. |
| No runs at all for days | GitHub disabled the schedule (public repos, 60 days without activity) or the workflow file broke. Re-enable it with `gh workflow enable "Data update" --repo andyqueyl/brawl-comps`, then run step 3. |
| Monday run missed but daily runs fine | Trigger a full run: `gh workflow run "Data update" --repo andyqueyl/brawl-comps`. Only if no full run happened this week; a second full pull double-counts battles. |
| `git push` rejected | The bot commits daily; run `git pull --rebase` first. A rejection mentioning workflow scope means the user runs `gh auth refresh -h github.com -s workflow`. |
| A brawler shows initials instead of art | Brawlify has no portrait yet. Expected for new brawlers; nothing to fix. |

## 3. Trigger a refresh by hand

```sh
gh workflow run "Data update" --repo andyqueyl/brawl-comps -f squad_only=true   # squad + rotation, any time
gh workflow run "Data update" --repo andyqueyl/brawl-comps                      # full meta: at most once a week
gh run watch $(gh run list --repo andyqueyl/brawl-comps --limit 1 --json databaseId -q '.[0].databaseId') --repo andyqueyl/brawl-comps
git pull --rebase -q
```

## 4. Change the squad

1. Verify the tag first: `set -a; . ./.env; set +a; curl -s -H "Authorization: Bearer $BS_API_KEY" "https://bsproxy.royaleapi.dev/v1/players/%23<TAG>" | head -c 200`
2. Edit `squad.config.json` (display name + tag). Keep the existing names unless Andy says otherwise.
3. Run `SQUAD_ONLY=1 node --env-file=.env scripts/update.mjs`, commit, `git pull --rebase`, push.

Removing someone leaves their history in `data/squad-history.json`. That's harmless; delete their entry only if asked.

## 5. After changing engine constants or the pipeline

`PERSONAL_WEIGHT` and the other personal-fit constants only change the ranking, not the % shown, so they need no re-validation: just compare the top comps on a few Brawl Ball and Knockout maps before and after. For meta-model constants (`K_PAIR`, `K_TRIO`, `TEAM_SCALE`, `fitK`) or pipeline changes, re-validate with a **player split** (never a random split; see CLAUDE.md):

```sh
DUMP_ONLY=1 DUMP_BATTLES=/tmp/battles.json node --env-file=.env scripts/update.mjs
node scripts/check-model.cjs . /tmp/battles.json player
```

Look for `best a` near 1.00 on the "with pairs/trios" line. Then update the numbers quoted in the Method page (`methodView` in `js/app.js`), `README.md` and `CLAUDE.md`.

## Ground rules

- Keep the owner's requirements: Brawl Ball + Knockout first, no 5v5, meta first with personal fit (recent form, then trophies) as a nudge at `PERSONAL_WEIGHT = 0.3`.
- Don't oversell the percentages. Picks move win odds a few points; skill decides games.
- Don't commit `.env`, mock data or analysis dumps.
- End commit messages with the Co-Authored-By line used in the history.
