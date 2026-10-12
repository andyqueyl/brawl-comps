# Brawl Comps

Best Brawl Stars comps for every map, built from the brawlers our squad actually owns. Pick who's playing, open a map, and it ranks trios where each person plays a brawler they have, using win rates from top players' recent battles plus each person's power levels and own record.

This is a static site (plain HTML and JavaScript). A GitHub Action refreshes the data every Monday.

## What it can't tell you

- The numbers come from top-ranked players. What wins at the top isn't always what wins at lower trophies.
- The % on a comp is a model estimate. Unless it says "games seen", that exact trio wasn't played enough to measure directly.
- Balance changes show up the next Monday, and the first week after a patch mixes old and new data.
- The API only returns each player's last 25 battles, so squad records miss games when someone plays more than that in a week.
- The "Live" badge is the map rotation at update time; maps rotate daily, so it goes stale during the week.

## How the data is built

`scripts/update.mjs` (Node 20+, no dependencies):

1. Pulls brawler, map and mode names and art from Brawlify's public API (`data/game.json`).
2. Loads each squad member from `squad.config.json`: owned brawlers, power levels, trophies, and their recent battles, which add to a running record (`data/squad.json`, `data/squad-history.json`).
3. Takes the top 200 players from the global and ~20 country leaderboards (up to 1,500 players), reads their last 25 battles, and counts wins for every brawler, pair and trio on each map. Only Trophy and Ranked 3v3/5v5 games count; duplicates are dropped when several sampled players were in the same match.
4. Blends this week's counts with last week's at half weight (`data/meta.json`).

`js/engine.js` turns counts into rankings. A brawler's win rate on a map is shrunk toward its win rate across the whole mode, with the amount of shrinkage fitted from the data each week (empirical Bayes), so a 4-0 brawler doesn't top the list. Pair and trio records adjust a comp only as far as their sample supports. Each person's power level and own record count for a little on top.

The engine was checked against a simulated API with planted brawler strengths: with ~800 battles per map, the planted strongest brawler ranked first on half the maps and top five on 20 of 24.

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
