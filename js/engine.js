// Scoring model. Everything is on the log-odds scale so effects add up:
//   brawler strength on a map  = its win rate there, shrunk toward its win rate across the whole mode
//   pair synergy               = how much better a pair does than its two brawlers would predict
//   trio fit                   = the same check for the exact three-brawler comp, when it has been seen
//   personal fit               = power level and the player's own record on that brawler
// Shrinking (adding K imaginary games at the prior rate) keeps a 3-0 brawler from topping the list.
// For brawlers, K is fitted from the data each time (empirical Bayes): when win rates on a map spread
// out no more than coin-flip noise would explain, K grows and the list leans on the mode-wide numbers.

(function () {
  // Pair and trio records mostly reflect who plays together (pre-made top teams), not the comp itself:
  // when tested on players the model never saw, light shrinkage here made predictions worse.
  const K_PAIR = 200;
  const K_TRIO = 300;
  // Personal fit: what each of us is actually good on. Recent games count most, then highest trophies.
  // These weights are a judgment call (Andy's priority order), not fitted: there's too little squad data.
  const HALF_LIFE_DAYS = 21;  // a game three weeks old counts half as much as one today
  const OTHER_MODE = 0.5;     // games in a different mode count half
  const K_RECENT = 8;         // imaginary 50% games pulling a short recent record toward even
  const VOLUME_STEP = 0.15;   // playing a brawler a lot lately is itself a sign you're good on it
  const VOLUME_CAP = 0.5;
  const TROPHY_WEIGHT = 0.4;  // best brawler by highest trophies gets +0.4, worst gets -0.4
  const POWER_STEP = 0.06;    // log-odds lost per power level under 11
  // How much "what we're good on" counts next to top players' win rates when ranking comps.
  // Our own records come from lower-trophy games, where a main can win 85%+, so at full weight they
  // swamped the meta and a 63% comp could outrank a 70% one. Judgment call (Oct 2026), not fitted.
  const PERSONAL_WEIGHT = 0.3;
  const CANDIDATES = 14;     // best brawlers per player considered when building comps
  // Summed team scores ran about 20% too confident when predicting battles of players held out of
  // the data (Oct 2026), because part of a brawler's record is the skill of the top players who main it.
  const TEAM_SCALE = 0.8;

  const logit = (p) => Math.log(p / (1 - p));
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  const shrink = (g, w, prior, k) => (w + k * prior) / (g + k);
  const pairKey = (a, b) => (a < b ? a + "-" + b : b + "-" + a);
  const trioKey = (ids) => [...ids].sort((a, b) => a - b).join("-");

  // Method of moments: real spread = observed spread minus the noise expected from sample size.
  // rows: [games, wins, prior]. Returns how many imaginary games a prior is worth.
  function fitK(rows) {
    const use = rows.filter(([g]) => g >= 10);
    if (use.length < 5) return 100;
    let spread = 0, noise = 0, base = 0;
    for (const [g, w, prior] of use) {
      spread += (w / g - prior) ** 2;
      noise += (prior * (1 - prior)) / g;
      base += prior * (1 - prior);
    }
    const tau2 = Math.max((spread - noise) / use.length, 1e-4);
    return Math.min(Math.max(base / use.length / tau2, 10), 500);
  }

  function modeTotals(meta) {
    const out = {};
    for (const m of Object.values(meta.maps)) {
      const t = out[m.mode] || (out[m.mode] = { battles: 0, brawlers: {} });
      t.battles += m.battles;
      for (const [id, [g, w]] of Object.entries(m.brawlers)) {
        const c = t.brawlers[id] || (t.brawlers[id] = [0, 0]);
        c[0] += g;
        c[1] += w;
      }
    }
    for (const t of Object.values(out)) t.k = fitK(Object.values(t.brawlers).map(([g, w]) => [g, w, 0.5]));
    return out;
  }

  // One map's model, built once and reused for every lookup on that map.
  function mapModel(meta, key, totals) {
    const m = meta.maps[key];
    if (!m) return null;
    totals = totals || modeTotals(meta);
    const mode = totals[m.mode] || { battles: 0, brawlers: {}, k: 100 };
    const brawlerCache = {};
    const modeP = (id) => {
      const [gm, wm] = mode.brawlers[id] || [0, 0];
      return shrink(gm, wm, 0.5, mode.k);
    };
    const kMap = fitK(Object.entries(m.brawlers).map(([id, [g, w]]) => [g, w, modeP(id)]));

    function brawler(id) {
      if (brawlerCache[id]) return brawlerCache[id];
      const pMode = modeP(id);
      const [g, w] = m.brawlers[id] || [0, 0];
      const p = shrink(g, w, pMode, kMap);
      return (brawlerCache[id] = { id: +id, p, L: logit(p), games: g, wins: w, pick: m.battles ? g / (2 * m.battles) : 0, modeP: pMode });
    }

    function pairSynergy(a, b) {
      const [g, w] = m.pairs[pairKey(a, b)] || [0, 0];
      const expected = sigmoid(brawler(a).L + brawler(b).L);
      if (!g) return { syn: 0, games: 0 };
      return { syn: logit(shrink(g, w, expected, K_PAIR)) - logit(expected), games: g, wins: w };
    }

    // Team strength for 1-3 brawlers: brawler terms + pair synergies, then the exact trio's record if seen.
    function team(ids) {
      let L = 0;
      for (const id of ids) L += brawler(id).L;
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) L += pairSynergy(ids[i], ids[j]).syn;
      let trio = null;
      if (ids.length === 3) {
        const [g, w] = m.trios[trioKey(ids)] || [0, 0];
        if (g) {
          const before = sigmoid(L);
          L = logit(shrink(g, w, before, K_TRIO));
          trio = { games: g, wins: w };
        }
      }
      L *= TEAM_SCALE;
      return { L, p: sigmoid(L), trio };
    }

    function topBrawlers(n = 20, minGames = 0) {
      return Object.keys(m.brawlers)
        .map(brawler)
        .filter((b) => b.games >= minGames)
        .sort((a, b) => b.p - a.p)
        .slice(0, n);
    }

    function topTeams(field, n = 10, minGames = 4) {
      return Object.entries(m[field])
        .filter(([, [g]]) => g >= minGames)
        .map(([k, [g, w]]) => {
          const ids = k.split("-").map(Number);
          return { ids, games: g, wins: w, raw: w / g, ...team(ids) };
        })
        .sort((a, b) => b.p - a.p)
        .slice(0, n);
    }

    return { info: m, kMap, brawler, pairSynergy, team, topBrawlers, topTeams };
  }

  // How well a specific player fits a brawler, on top of the meta.
  const trophyRanks = new WeakMap();
  function trophyPct(player, owned) {
    let sorted = trophyRanks.get(player);
    if (!sorted) trophyRanks.set(player, (sorted = player.brawlers.map((b) => b.highest || 0).sort((a, b) => a - b)));
    if (sorted.length < 2) return 0.5;
    let below = 0;
    while (below < sorted.length && sorted[below] < (owned.highest || 0)) below++;
    return below / (sorted.length - 1);
  }

  function personal(player, id, ctx = {}) {
    const owned = player.brawlers.find((b) => b.id === +id);
    if (!owned) return null;
    const now = ctx.now || Date.now();
    let g = 0, w = 0, recentGames = 0, recentWins = 0, lastPlayed = 0;
    for (const [t, bid, mode, won] of player.games || []) {
      if (bid !== +id) continue;
      const age = Math.max(0, (now - t) / 864e5);
      const weight = 0.5 ** (age / HALF_LIFE_DAYS) * (ctx.mode && mode !== ctx.mode ? OTHER_MODE : 1);
      g += weight;
      w += weight * won;
      if (age <= 30) { recentGames++; recentWins += won; }
      lastPlayed = Math.max(lastPlayed, t);
    }
    const record = g ? logit(shrink(g, w, 0.5, K_RECENT)) : 0;
    const volume = Math.min(VOLUME_STEP * Math.log1p(g), VOLUME_CAP);
    const pct = trophyPct(player, owned);
    const trophy = TROPHY_WEIGHT * (2 * pct - 1);
    const powerGap = -(11 - Math.min(owned.power, 11)) * POWER_STEP;
    return { owned, recentGames, recentWins, lastPlayed, trophyPct: pct, record, volume, trophy, powerGap, L: record + volume + trophy + powerGap };
  }

  // Best comps for the selected squad members on one map. Each member plays a different brawler they own.
  function recommend(model, players, opts = {}) {
    const minPower = opts.minPower ?? 1;
    const limit = opts.limit ?? 6;
    const pw = opts.personalWeight ?? PERSONAL_WEIGHT;
    const pools = players.map((pl) =>
      pl.brawlers
        .filter((b) => b.power >= minPower)
        .map((b) => {
          const meta = model.brawler(b.id);
          const pers = personal(pl, b.id, { mode: model.info.mode, now: opts.now });
          return { id: b.id, meta, pers, solo: meta.L + pw * pers.L };
        })
        .sort((a, b) => b.solo - a.solo)
        .slice(0, players.length === 1 ? 30 : players.length > 3 ? 9 : CANDIDATES)
    );

    if (players.length === 1) {
      return pools[0].slice(0, limit * 2).map((c) => ({ picks: [c], score: c.solo, comp: model.team([c.id]) }));
    }

    const results = [];
    const pick = (i, chosen) => {
      if (i === pools.length) {
        const ids = chosen.map((c) => c.id);
        const comp = model.team(ids);
        const pers = pw * chosen.reduce((s, c) => s + c.pers.L, 0);
        results.push({ picks: chosen.slice(), score: comp.L + pers, comp });
        return;
      }
      for (const c of pools[i]) {
        if (chosen.some((x) => x.id === c.id)) continue;
        chosen.push(c);
        pick(i + 1, chosen);
        chosen.pop();
      }
    };
    pick(0, []);
    results.sort((a, b) => b.score - a.score);

    // Keep the list varied: no repeated brawler sets, and nobody stuck on the same brawler in more than
    // two suggestions, so each person also sees their next-best options.
    const seen = new Set();
    const uses = {};
    const out = [];
    for (const r of results) {
      const k = trioKey(r.picks.map((p) => p.id));
      if (seen.has(k) || r.picks.some((p, i) => (uses[i + ":" + p.id] || 0) >= 2)) continue;
      seen.add(k);
      r.picks.forEach((p, i) => (uses[i + ":" + p.id] = (uses[i + ":" + p.id] || 0) + 1));
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  const api = { logit, sigmoid, shrink, modeTotals, mapModel, personal, recommend, PERSONAL_WEIGHT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.BrawlEngine = api;
})();
