# Brawl Comps

Best Brawl Stars comps for every map, built from the brawlers our squad actually owns. Pick who's playing, open a map, and it ranks trios where each person plays a brawler they have, using win rates from top players' recent battles plus each person's power levels and own record.

This is a static site (plain HTML and JavaScript). A GitHub Action refreshes the data every Monday.

## What it can't tell you

- **Picks matter less than skill.** On held-out battles, knowing both teams' brawlers raised the share of games called correctly only from 65.1% to 66.1%. A better comp is worth a few percentage points.
- The numbers come from top-ranked players. What wins at the top isn't always what wins at lower trophies.
- The highest trio records often come from a few pre-made top teams, so part of "this trio wins" is "these players win".
- Unless a comp says "games seen", that exact trio wasn't played enough to measure directly.
- Balance changes show up the next Monday, and the first week after a patch mixes old and new data.
- The API only returns each player's last 25 battles, so squad records miss games when someone plays more than that in a week.
- The "Live" badge is the map rotation at update time; maps rotate daily, so it goes stale during the week.

## How the data is built

`scripts/update.mjs` (Node 20+, no dependencies):

1. Pulls brawler, map and mode names and art from Brawlify's public API (`data/game.json`).
2. Loads each squad member from `squad.config.json`: owned brawlers, power levels, trophies, and their recent battles, which add to a running record (`data/squad.json`, `data/squad-history.json`).
3. Takes the top 200 players from the global and ~20 country leaderboards (up to 3,000 players), reads their last 25 battles, and counts wins for every brawler, pair and trio on each map. Only Trophy and Ranked team games count; duplicates are dropped when several sampled players were in the same match.
4. Removes the sampling bias: every battle was found through a top player, and the team with the sampled player wins about 66% of the time, so their picks would look too strong. The script measures that edge per mode and takes it out of those teams' results (and gives it back to their opponents'). Games where both teams had a sampled player need no correction.
5. Blends this week's counts with last week's at half weight (`data/meta.json`).

`js/engine.js` turns counts into rankings. A brawler's win rate on a map is shrunk toward its win rate across the whole mode, with the amount of shrinkage fitted from the data each week (empirical Bayes), so a 4-0 brawler doesn't top the list. Pair and trio records adjust a comp only as far as their sample supports. Each person's power level and own record count for a little on top.

Checks on the first real pull (42,819 battles, Oct 2026), building from half the battles and predicting the other half:

- The bias correction beat the alternative of only learning from top players' opponents.
- Summed team scores were about 15% too confident, so the engine scales them by 0.85; after that, calibration on held-out games was exact.
- The five best-ranked trios per map won 87.5% of their held-out games against a model expectation of 79% (64.5% from player skill alone).

The engine was also checked against a simulated API with planted brawler strengths. Pass `DUMP_BATTLES=path.json` to the update script to save the raw battles for checks like these.

## Setup

1. Create a key at [developer.brawlstars.com](https://developer.brawlstars.com) and whitelist IP `45.79.218.79`. Requests go through [RoyaleAPI's proxy](https://github.com/RoyaleAPI/cr-api-docs/blob/master/docs/proxy.md) because GitHub Actions has no fixed IP.
2. Add the key as a repository secret named `BS_API_KEY`.
3. Put the squad in `squad.config.json`:

   ```json
   { "players": [ { "name": "Andy", "tag": "#ABC123" } ] }
   ```

4. Run the workflow once from the Actions tab (or wait for Monday).

Run it locally with `BS_API_KEY=... node scripts/update.mjs`, then serve the folder (for example `python3 -m http.server`) and open it.

Art from [Brawlify](https://brawlify.com). Data from the official Brawl Stars API. Not affiliated with Supercell.
