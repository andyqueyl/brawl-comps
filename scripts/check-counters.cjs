// Held-out check of the Ranked matchup ("counter") term: node scripts/check-counters.cjs . battles.json
// battles.json comes from: DUMP_ONLY=1 DUMP_BATTLES=battles.json node scripts/update.mjs
// Builds Ranked-only counts from half the sampled players, predicts the other half's Ranked games with and
// without counters, and reports which K_VS / weight predicts best. Always a player split (see CLAUDE.md).
const fs = require("fs");
const E = require(require("path").resolve(process.argv[2], "js/engine.js"));
const RANKED = new Set(["soloRanked", "teamRanked"]);
const B = JSON.parse(fs.readFileSync(process.argv[3])).filter((b) => RANKED.has(b[2]));
const lg = (w, g) => Math.log((w + 0.5) / (g - w + 0.5)), sig = (x) => 1 / (1 + Math.exp(-x));
const combos = (ids, k) => { const o = []; const r = (s, p) => { if (p.length === k) return o.push(p.join("-")); for (let i = s; i < ids.length; i++) r(i + 1, [...p, ids[i]]); }; r(0, []); return o; };
const hash = (t) => { let h = 2166136261; for (const c of t) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

const train = [], test = [];
let mixed = 0;
for (const b of B) { const g = new Set(b[6].map((t) => hash(t) % 2)); if (g.size > 1) { mixed++; continue; } (g.has(0) ? train : test).push(b); }
console.log(`Ranked battles ${B.length}: train ${train.length}, test ${test.length}, dropped mixed ${mixed}`);

// Side edge per mode, from train.
const tally = {};
for (const [mode, , , , win, has] of train) if (has[0] !== has[1]) { const s = has[0] ? 0 : 1; (tally[mode] ||= [0, 0]); tally[mode][0]++; tally[mode][1] += win === s ? 1 : 0; }
const all = Object.values(tally).reduce((a, [g, w]) => [a[0] + g, a[1] + w], [0, 0]);
const hAll = lg(all[1], all[0]);
const H = {};
for (const [m, [g, w]] of Object.entries(tally)) H[m] = (g * lg(w, g) + 300 * hAll) / (g + 300);

// Same counting and debiasing as update.mjs, including matchups.
const maps = {};
for (const [mode, map, , teams, win, has] of train) {
  const k = mode + "|" + map;
  const m = maps[k] || (maps[k] = { mode, map, battles: 0, brawlers: {}, pairs: {}, trios: {}, vs: {} });
  m.battles++;
  teams.forEach((t, i) => {
    const side = has[i] && has[1 - i] ? 2 : has[i] ? 0 : 1;
    const w = win === i;
    const add = (f, key) => { const c = m[f][key] || (m[f][key] = [0, 0, 0, 0, 0, 0]); c[side * 2]++; c[side * 2 + 1] += w ? 1 : 0; };
    const ids = [...new Set(t)].sort((a, b) => a - b);
    ids.forEach((id) => add("brawlers", id));
    combos(ids, 2).forEach((p) => add("pairs", p));
    if (ids.length === 3) add("trios", ids.join("-"));
    for (const a of ids) for (const b of teams[1 - i]) if (a < b) add("vs", a + "-" + b);
  });
}
for (const m of Object.values(maps)) {
  const h = H[m.mode] ?? hAll;
  for (const f of ["brawlers", "pairs", "trios", "vs"]) for (const [key, [gS, wS, gO, wO, gN, wN]] of Object.entries(m[f])) {
    let w = wN; if (gS) w += gS * sig(lg(wS, gS) - h); if (gO) w += gO * sig(lg(wO, gO) + h); m[f][key] = [gS + gO + gN, w];
  }
}
const meta = { maps };
const totals = E.modeTotals(meta);

function points(k) {
  E.setVs(k, 1);
  const models = {}, pts = [];
  for (const [mode, map, , teams, win, has] of test) {
    const key = mode + "|" + map;
    if (!meta.maps[key]) continue;
    const md = models[key] || (models[key] = E.mapModel(meta, key, totals));
    const [t0, t1] = teams.map((t) => [...new Set(t)]);
    let h = 0; if (has[0] && !has[1]) h = H[mode] ?? hAll; else if (has[1] && !has[0]) h = -(H[mode] ?? hAll);
    // Same scale as the engine's draft(): counters enter as TEAM_SCALE x VS_WEIGHT x raw, so b below is VS_WEIGHT.
    pts.push([h, md.team(t0).L - md.team(t1).L, E.TEAM_SCALE * md.counters(t0, t1), win === 0 ? 1 : 0]);
  }
  return pts;
}
const score = (pts, a, b) => { let ll = 0, acc = 0; for (const [h, d, c, y] of pts) { const p = sig(h + a * d + b * c); ll -= y ? Math.log(p) : Math.log(1 - p); acc += (p > 0.5) === (y === 1) ? 1 : 0; } return [ll / pts.length, acc / pts.length]; };
const fmt = ([l, a]) => `logloss ${l.toFixed(4)} acc ${(a * 100).toFixed(1)}%`;

const base = points(150);
let bestA = [1, Infinity];
for (let a = 0; a <= 2.01; a += 0.05) { const [l] = score(base, a, 0); if (l < bestA[1]) bestA = [a, l]; }
console.log(`n=${base.length} | side edge only: ${fmt(score(base, 0, 0))} | comps, no counters (a=1): ${fmt(score(base, 1, 0))} | best a=${bestA[0].toFixed(2)}`);
for (const k of [25, 50, 100, 150, 300, 600, 1200]) {
  const pts = points(k);
  let best = [0, Infinity];
  for (let b = 0; b <= 3.01; b += 0.05) { const [l] = score(pts, 1, b); if (l < best[1]) best = [b, l]; }
  console.log(`K_VS ${String(k).padStart(4)}: counters at weight 1 ${fmt(score(pts, 1, 1))} | best weight ${best[0].toFixed(2)} ${fmt(score(pts, 1, best[0]))}`);
}
