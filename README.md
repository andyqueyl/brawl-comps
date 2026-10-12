# Brawl Comps

Best Brawl Stars comps for our squad, focused on Brawl Ball and Knockout (3v3 only; 5v5 is left out). Pick who's playing, open a map, and it ranks trios where each person plays a brawler they own: what each of us is good on comes first (recent games, then highest trophies), then win rates from top players' battles on that map.

This is a static site (plain HTML and JavaScript). A GitHub Action refreshes squad games daily and the top-player meta every Monday.

## What it can't tell you

- **Picks matter less than skill.** On players the model hadn't seen, knowing both teams' brawlers raised the share of games called correctly only from 64.3% to 64.8%. Comps tilt the odds; they don't decide games.
- The numbers come from top-ranked players. What wins at the top isn't always what wins at lower trophies.
- Pair and trio records mostly come from a few pre-made top teams, so part of "this trio wins" is "these players win". The model leans on them only lightly for that reason.
- Unless a comp says "games seen", that exact trio wasn't played enough to measure directly.
- Balance changes show up the next Monday, and the first week after a patch mixes old and new data.
- The API only returns each player's last 25 battles. Squad games are pulled daily, so only a day with more than 25 games loses some.
- How much recent form and trophies count is a judgment call, not fitted; there aren't enough squad games to test it.
- The "Live" badge is the map rotation at update time; maps rotate daily, so it goes stale during the week.

## How the data is built

`scripts/update.mjs` (Node 20+, no dependencies):

1. Pulls brawler, map and mode names and art from Brawlify's public API (`data/game.json`).
2. Loads each squad member from `squad.config.json`: owned brawlers, power levels, trophies, and every new game since the last pull, kept one by one so recent games can count more (`data/squad.json`, `data/squad-history.json`). `SQUAD_ONLY=1` does just this step (the daily run).
3. Takes the top 200 players from the global and ~20 country leaderboards (up to 3,000 players), reads their last 25 battles, and counts wins for every brawler, pair and trio on each map. Only Trophy and Ranked 3v3 games count; duplicates are dropped when several sampled players were in the same match.
4. Removes the sampling bias: every battle was found through a top player, and the team with the sampled player wins about 66% of the time, so their picks would look too strong. The script measures that edge per mode and takes it out of those teams' results (and gives it back to their opponents'). Games where both teams had a sampled player need no correction.
5. Blends this week's counts with last week's at half weight (`data/meta.json`).

`js/engine.js` turns counts into rankings. A brawler's win rate on a map is shrunk toward its win rate across the whole mode, with the amount of shrinkage fitted from the data each week (empirical Bayes), so a 4-0 brawler doesn't top the list. Pair and trio records adjust a comp only as far as their sample supports. Each person's power level and own record count for a little on top.

Checks on the first real pulls (about 43,000 battles each, Oct 2026). The strict test builds the model from half of the sampled top players and predicts battles involving only the other half, so a player's skill can't leak into their brawler's numbers:

- The bias correction beat the alternative of only learning from top players' opponents.
- Pair and trio records added nothing for unseen players (they mostly capture pre-made teams), so they're shrunk hard (`K_PAIR = 200`, `K_TRIO = 300`).
- Summed team scores were about 20% too confident, so the engine scales them by 0.8; after that, calibration on unseen players was exact.
- A random half/half split of battles (same players on both sides) makes the model look much better, with top trios winning 86% of held-out games. That number is inflated by player skill and isn't the one to trust.

The engine was also checked against a simulated API with planted brawler strengths. Pass `DUMP_BATTLES=path.json` to the update script to save the raw battles for checks like these.

## Setup

1. Create a key at [developer.brawlstars.com](https://developer.brawlstars.com) and whitelist IP `45.79.218.79`. Requests go through [RoyaleAPI's proxy](https://github.com/RoyaleAPI/cr-api-docs/blob/master/docs/proxy.md) because GitHub Actions has no fixed IP.
2. Add the key as a repository secret named `BS_API_KEY`.
3. Put the squad in `squad.config.json`:

   ```json
   { "players": [ { "name": "Andy", "tag": "#ABC123" } ] }
   ```

4. Run the workflow once from the Actions tab (or wait for the next scheduled run).

Run it locally with `BS_API_KEY=... node scripts/update.mjs`, then serve the folder (for example `python3 -m http.server`) and open it.

Art from [Brawlify](https://brawlify.com). Data from the official Brawl Stars API. Not affiliated with Supercell.
