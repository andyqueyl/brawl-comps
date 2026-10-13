# Brawl Comps: handoff notes for AI assistants

Read this before changing anything. `README.md` is the public description; this file holds what you need to maintain the project and keep it honest. For the routine weekly check and fixes, use the project skill `.claude/skills/brawl-maintenance/SKILL.md`.

- **Live site:** https://andyqueyl.github.io/brawl-comps/ (GitHub Pages, `main` branch, repo root)
- **Repo:** https://github.com/andyqueyl/brawl-comps (public; the owner chose that on purpose)
- **Owner:** Andy (in-game DustinMenace$$$). It's a personal side project for him and three friends.

## What it does

A static site that suggests Brawl Stars 3v3 comps for a fixed squad. You pick who's on, open a map, and it ranks trios where each person plays a brawler they own. The ranking puts **what each person is good on** first and the **top-player meta** second.

## The owner's requirements (don't drift from these)

- **Brawl Ball and Knockout come first.** They lead every list and are the default filter. Other 3v3 modes stay available but secondary.
- **No 5v5.** The parser drops any battle whose teams aren't exactly 3 players (`teamBattle` in `scripts/update.mjs`), and the site also strips 5v5 maps on load.
- **Rank by what the squad is good at:** recent games first, then highest trophies, then the meta. Those weights are judgment calls that follow his priority order (see Model). Don't present them as fitted.
- **Display names:** Andy (#2Y2GPLL88), Nova (#28900QP9Y, in-game Glowstar), DLB (#2PYQL2ULQ), Anthony (#28R8GC0C9, in-game CodyMenace$$$). Edit names and tags only in `squad.config.json`.
- **Look:** a sibling of his other site, `~/Desktop/Coding Projects/poker-solver-lab`: condensed uppercase display, mono labels, thin-ruled cards. Its own identity: Big Shoulders Display / Instrument Sans / JetBrains Mono, violet-tinted neutrals, Brawl gold (`--accent`), Brawl Ball blue (`--ball`), Knockout orange (`--ko`). Every color is a token in `css/style.css`, with light and dark themes. Keep it that way.
- **Be blunt about limits.** He relays conclusions to others. The strongest finding is that picks barely matter compared with skill (see Validation). Never oversell the % numbers.

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/style.css`, `js/app.js` | The site. Hash routes: `#/` home, `#/map/<mode>|<map>`, `#/squad`, `#/method`. |
| `js/engine.js` | All scoring (pure functions, also loadable from Node via `require`). |
| `scripts/update.mjs` | Data refresh (Node 20+, no dependencies). |
| `scripts/check-model.cjs` | Held-out validation of the engine on a raw battle dump. |
| `squad.config.json` | The squad: `{ "players": [{ "name", "tag" }] }`. |
| `data/game.json` | Brawler, map and mode names plus art URLs (from Brawlify). |
| `data/meta.json` | Per-map win counts for brawlers, pairs and trios from top players (debiased, blended). |
| `data/squad.json` | Each person's brawlers (power, trophies, highest) and every tracked game. |
| `data/squad-history.json` | The running game log the updater appends to (up to 1,500 newest games per person). |
| `data/rotation.json` | Live map rotation, rewritten on every run. |
| `.github/workflows/weekly-update.yml` | The scheduled refresh (workflow name "Data update"). |
| `.env` | Local only, gitignored: `BS_API_KEY=...`. Never commit it. |

## Data sources

- **Official Brawl Stars API** (`api.brawlstars.com/v1`) is the only source of battles and win rates. It needs a key. Keys are IP-whitelisted, and GitHub Actions has no fixed IP, so every call goes through **RoyaleAPI's proxy**, `https://bsproxy.royaleapi.dev/v1`. The key must whitelist `45.79.218.79` (documented in RoyaleAPI/cr-api-docs `docs/proxy.md`). Set `BS_API_BASE=https://api.brawlstars.com/v1` to call Supercell directly from a whitelisted machine.
- **Brawlify** gives static names and art only. Use `https://api.brawlapi.com/v1/{brawlers,maps,gamemodes}`. `api.brawlify.com` is blocked by Cloudflare for scripts. Brawlify's map `stats` and `events` endpoints come back empty, so don't build on them.
- The key lives in GitHub as repo secret `BS_API_KEY` and locally in `.env`. Andy's developer account is "brawl comps" at developer.brawlstars.com.

## Refresh schedule (automatic)

The "Data update" workflow commits to `main`, and every data commit redeploys Pages. Nobody needs to republish by hand.

| When (UTC) | Mode | What happens |
|---|---|---|
| Daily 09:00 | `SQUAD_ONLY=1` | Squad profiles, each person's new games, `rotation.json`. Takes about 10 s. Runs daily because the API only shows each player's last 25 battles. |
| Mondays 14:00 | full | Everything above, plus top-player battles from the leaderboards (up to 3,000 players, about 3 min) into `meta.json`. |
| Manual | either | Actions tab → Data update → Run workflow (tick "Only refresh squad profiles" for a quick run). |

**Never run a second full meta pull in the same week.** Each full run blends with the previous `meta.json` at half weight, so pulling twice counts the same battles again. Use `SQUAD_ONLY=1` for anything mid-week, and `DUMP_ONLY=1` for analysis pulls that must not touch site data.

## Weekly maintenance checklist

1. `gh run list --repo andyqueyl/brawl-comps --limit 10`: daily runs green, the Monday run green.
2. Data freshness: the stamp in the site's nav ("Squad <date> · Meta <date>"), or `updated` in `data/squad.json` and `data/meta.json`.
3. Monday run log should show about 40,000 battles and a line `top-player side win rate (removed): {"all": ~65, ...}`. A sharp drop in battles means the proxy or API is failing. A side win rate near 50% means the sampling or debiasing broke.
4. Before any local commit, run `git pull --rebase`. The bot commits daily, so pushes otherwise get rejected.
5. Spot-check the site on a phone-width viewport: home live maps, one map page with 3 people picked, the Squad page.

## Common failures and fixes

- **403 `accessDenied` / "invalid ip":** the key was revoked or doesn't whitelist `45.79.218.79`. Andy creates a new key at developer.brawlstars.com (you can't make accounts or keys for him; ask him to do it). Then: `printf %s "<token>" | gh secret set BS_API_KEY --repo andyqueyl/brawl-comps`, and update `.env`. Never echo the token in chat or commit it.
- **The proxy is down:** runs fail or return almost no battles. Wait, or run locally from a whitelisted IP with `BS_API_BASE=https://api.brawlstars.com/v1` (that needs a second key whitelisting that machine's IP).
- **A new brawler shows initials instead of art:** Brawlify hasn't added a portrait yet. The site falls back on its own. Nothing to do unless it lasts weeks.
- **A new game mode** shows up under "All modes" automatically. Its mode color is `--other`. Add a token only if Andy wants it featured.
- **Scheduled workflows stop:** GitHub disables schedules in public repos after 60 days without repository activity. The bot's daily commits should count as activity, but if runs stop, re-enable the workflow in the Actions tab.
- **Push rejected for workflow files:** the `gh` token needs the `workflow` scope. The user runs `gh auth refresh -h github.com -s workflow`; it's interactive.
- **`meta.json` growth:** blending prunes rows below 2 games for pairs and trios and maps under 2 battles; it's about 1.6 MB. If it passes ~5 MB, raise those cut-offs in `blend()`.

## Running locally

```sh
node --env-file=.env scripts/update.mjs                  # full run (only if the Monday run failed)
SQUAD_ONLY=1 node --env-file=.env scripts/update.mjs     # profiles + rotation only
python3 -m http.server 8000 --bind 127.0.0.1             # then open http://127.0.0.1:8000
```

The site loads `data/*.json` with `fetch`, so it needs a server; opening `index.html` as a file won't work.

## Model (`js/engine.js`)

Everything is on the log-odds scale so effects add up.

- **Brawler on a map:** win rate shrunk toward the brawler's mode-wide rate. The amount of shrinkage `K` is fitted per map by empirical Bayes in `fitK`, a method-of-moments estimate of the true spread versus sampling noise.
- **Pairs and trios:** `K_PAIR = 200` and `K_TRIO = 300` shrink their records hard toward what the individual brawlers predict.
- **Team score:** the sum of the parts times `TEAM_SCALE = 0.8`.
- **Personal fit:** `personal()`:
  - recency-weighted record (`HALF_LIFE_DAYS = 21`, games in other modes ×0.5, `K_RECENT = 8`)
  - play volume (`VOLUME_STEP = 0.15`, capped at 0.5)
  - highest-trophy percentile among the person's own brawlers (±`TROPHY_WEIGHT = 0.4`)
  - power below 11 (`POWER_STEP = 0.06` per level)
  - **These are not fitted.** They encode Andy's priority order.
- **`recommend()`:** ranks by meta score plus personal fit, with no repeated trios and no person on the same brawler in more than 2 suggestions. The **% shown** is the meta-only comp estimate, the calibrated part, not the ranking score.

### Sampling bias (the most important thing in the pipeline)

Every battle is found through a top player's log, and the side with the sampled player wins about 66%. Without a correction, whatever top players pick looks far stronger than it is. The first real pull showed brawlers at 65–74% and trios at 90%+. `debias()` tags each team as sampled (S), opponent (O) or both sampled (N), measures the S-side edge per mode, and removes it from S results (adding it back to O). Don't remove this. An opponents-only alternative predicted worse.

### Validation: always split by player

```sh
DUMP_ONLY=1 DUMP_BATTLES=/tmp/battles.json node --env-file=.env scripts/update.mjs   # ~3 min, site data untouched
node scripts/check-model.cjs . /tmp/battles.json player
```

- **Use `player`, not `random`.** A random split puts the same top players in both halves and leaks their skill: top trios looked like 86% wins that way, versus about 70% on 37 games for players held out. Results from Oct 2026 with the player split: best `a = 1.00` (calibrated); the meta model improved log loss 0.6495 → 0.6307; accuracy rose only 64.3% → 64.8%.
- **Pairs and trios added nothing for unseen players.** They mostly capture pre-made top teams, which is why they're shrunk so hard.
- **What to tell the user:** comps tilt the odds a few points; skill decides games.
- **If you change engine constants,** re-run this check and update the numbers in the Method page (`methodView` in `js/app.js`) and the README.
- The squad-side weights can't be validated until there are months of squad games. Then you could check whether recency or trophies predicts the squad's own wins.

## Working conventions

- Match the existing code style: vanilla JS, no build step, no dependencies, sparse but meaningful comments, template-string rendering.
- Keep every color in tokens with both themes, check phone width (~390px) for horizontal overflow, and keep the broken-image fallback.
- Don't commit synthetic or mock data. The early engine tests used a mock API in a scratch directory that no longer exists.
- Tell the user plainly what you didn't verify, for example a page you couldn't open in a browser.
- Commit messages end with the Co-Authored-By line used in the existing history.

## History (Oct 12–13, 2026)

1. Built the static site and pipeline. The engine was first tested against a mock API with planted strengths.
2. First real pull exposed the top-player sampling bias; added `debias()` and calibration.
3. Squad added, then a player-split validation, which led to the heavy pair/trio shrinkage and `TEAM_SCALE` 0.8.
4. Andy's asks: Brawl Ball and Knockout focus, no 5v5, rank by recent form then trophies, renamed players, daily squad refresh.
5. Briefly kept private (no GitHub Pro, so no Pages for a private repo). Andy then chose a public repo with Pages.
6. Redesigned to match the poker site's polish.
