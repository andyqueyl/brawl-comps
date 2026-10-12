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
  const K_PERSONAL = 30;
  const POWER_STEP = 0.06;   // log-odds lost per power level under 11
  const PERSONAL_WEIGHT = 0.5;
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

  // How well a specific player fits a brawler, on top of the meta: power gap plus their own record.
  function personal(player, id) {
    const owned = player.brawlers.find((b) => b.id === +id);
    if (!owned) return null;
    const [g, w] = player.record?.brawlers?.[id] || [0, 0];
    const comfort = g ? logit(shrink(g, w, 0.5, K_PERSONAL)) * PERSONAL_WEIGHT : 0;
    const powerGap = -(11 - Math.min(owned.power, 11)) * POWER_STEP;
    return { owned, games: g, wins: w, comfort, powerGap, L: comfort + powerGap };
  }

  // Best comps for the selected squad members on one map. Each member plays a different brawler they own.
  function recommend(model, players, opts = {}) {
    const minPower = opts.minPower ?? 1;
    const limit = opts.limit ?? 6;
    const pools = players.map((pl) =>
      pl.brawlers
        .filter((b) => b.power >= minPower)
        .map((b) => {
          const meta = model.brawler(b.id);
          const pers = personal(pl, b.id);
          return { id: b.id, meta, pers, solo: meta.L + pers.L };
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
        const pers = chosen.reduce((s, c) => s + c.pers.L, 0);
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

    // Keep the list varied: no two suggestions with the exact same set of brawlers.
    const seen = new Set();
    const out = [];
    for (const r of results) {
      const k = trioKey(r.picks.map((p) => p.id));
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  const api = { logit, sigmoid, shrink, modeTotals, mapModel, personal, recommend };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.BrawlEngine = api;
})();
