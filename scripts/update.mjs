// Weekly data refresh. Pulls recent battles from top players through the official Brawl Stars API,
// turns them into per-map win counts (brawlers, pairs, trios), and refreshes every squad profile.
//
//   BS_API_KEY=... node scripts/update.mjs
//
// The key must be created at developer.brawlstars.com with IP 45.79.218.79 whitelisted, because
// requests go through RoyaleAPI's proxy (set BS_API_BASE=https://api.brawlstars.com/v1 to call
// Supercell directly from a whitelisted machine instead).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const API = process.env.BS_API_BASE || "https://bsproxy.royaleapi.dev/v1";
const KEY = process.env.BS_API_KEY;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 1500);
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
// Last week's counts are kept at half weight, so the data leans on this week but small maps keep a sample.
const DECAY = 0.5;
const COUNTRIES = ["global", "US", "CA", "MX", "BR", "GB", "FR", "DE", "ES", "IT", "TR", "PL", "KR", "JP", "AU", "ID", "PH", "EG", "SA", "AR"];
const COUNTED_TYPES = new Set(["ranked", "soloRanked", "teamRanked"]);

if (!KEY) {
  console.error("BS_API_KEY is not set. Create a key at https://developer.brawlstars.com (whitelist 45.79.218.79).");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (tag) => encodeURIComponent(tag.startsWith("#") ? tag : "#" + tag);

async function api(path, tries = 4) {
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetch(API + path, { headers: { Authorization: "Bearer " + KEY, Accept: "application/json" } });
    } catch (e) {
      await sleep(1000 * 2 ** i);
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (res.status === 403) {
      const body = await res.text();
      throw new Error("API refused the key (403): " + body + " — check the key and that 45.79.218.79 is whitelisted.");
    }
    await sleep(1000 * 2 ** i);
  }
  return null;
}

async function pool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value) + "\n");
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const round1 = (x) => Math.round(x * 10) / 10;

// ---------- static game data (names, classes, images) from Brawlify's public API ----------

async function refreshGameData() {
  const get = async (p) => {
    const res = await fetch("https://api.brawlapi.com/v1/" + p, { headers: { "User-Agent": "brawl-comps (github.com/andyqueyl/brawl-comps)" } });
    if (!res.ok) throw new Error("brawlapi " + p + " " + res.status);
    return (await res.json()).list;
  };
  try {
    const [brawlers, maps, modes] = await Promise.all([get("brawlers"), get("maps"), get("gamemodes")]);
    const game = {
      brawlers: brawlers.map((b) => ({ id: b.id, name: b.name, cls: b.class?.name || "", rarity: b.rarity?.name || "", color: b.rarity?.color || "", img: b.imageUrl2 || b.imageUrl })),
      maps: Object.fromEntries(maps.map((m) => [m.id, { name: m.name, mode: m.gameMode?.name || "", img: m.imageUrl }])),
      modes: Object.fromEntries(modes.map((m) => [norm(m.name), { name: m.name, color: m.color, img: m.imageUrl }])),
    };
    await writeJson(join(DATA, "game.json"), game);
    console.log(`game data: ${game.brawlers.length} brawlers, ${maps.length} maps`);
  } catch (e) {
    console.warn("Could not refresh game data, keeping the old copy:", e.message);
  }
}

// ---------- battle parsing ----------

function teamBattle(entry) {
  const b = entry.battle;
  if (!b || !Array.isArray(b.teams) || b.teams.length !== 2) return null;
  if (b.result !== "victory" && b.result !== "defeat") return null;
  const mode = entry.event?.mode && entry.event.mode !== "unknown" ? entry.event.mode : b.mode;
  const map = entry.event?.map;
  if (!mode || !map) return null;
  const teams = b.teams.map((t) => t.map((p) => ({ tag: p.tag, id: p.brawler?.id, power: p.brawler?.power })));
  if (teams.some((t) => t.some((p) => !p.id))) return null;
  return { time: entry.battleTime, type: b.type, mode, map, mapId: entry.event?.id || null, result: b.result, teams };
}

const battleKey = (bt) => bt.time + "|" + bt.map + "|" + bt.teams.flat().map((p) => p.tag).sort().join(",");

function combos(ids, k) {
  const out = [];
  const rec = (start, pick) => {
    if (pick.length === k) return out.push(pick.join("-"));
    for (let i = start; i < ids.length; i++) rec(i + 1, [...pick, ids[i]]);
  };
  rec(0, []);
  return out;
}

function addCount(obj, key, win) {
  const c = obj[key] || (obj[key] = [0, 0]);
  c[0] += 1;
  c[1] += win ? 1 : 0;
}

// ---------- meta sample from top players ----------

async function collectMeta() {
  const tags = new Set();
  for (const c of COUNTRIES) {
    const r = await api(`/rankings/${c}/players?limit=200`);
    for (const p of r?.items || []) tags.add(p.tag);
    if (tags.size >= MAX_PLAYERS) break;
  }
  const players = [...tags].slice(0, MAX_PLAYERS);
  console.log(`sampling battle logs of ${players.length} top players`);

  const seen = new Set();
  const maps = {};
  let done = 0;
  await pool(players, async (tag) => {
    const log = await api(`/players/${enc(tag)}/battlelog`);
    if (++done % 250 === 0) console.log(`  ${done}/${players.length} logs`);
    for (const entry of log?.items || []) {
      const bt = teamBattle(entry);
      if (!bt || !COUNTED_TYPES.has(bt.type)) continue;
      const key = battleKey(bt);
      if (seen.has(key)) continue;
      seen.add(key);
      const mine = bt.teams.findIndex((t) => t.some((p) => p.tag === tag));
      if (mine < 0) continue;
      const k = bt.mode + "|" + bt.map;
      const m = maps[k] || (maps[k] = { mode: bt.mode, map: bt.map, mapId: bt.mapId, battles: 0, ranked: 0, brawlers: {}, pairs: {}, trios: {} });
      m.battles += 1;
      if (bt.type !== "ranked") m.ranked += 1;
      bt.teams.forEach((team, i) => {
        const win = (i === mine) === (bt.result === "victory");
        const ids = [...new Set(team.map((p) => p.id))].sort((a, b) => a - b);
        for (const id of ids) addCount(m.brawlers, id, win);
        for (const pk of combos(ids, 2)) addCount(m.pairs, pk, win);
        if (ids.length === 3) addCount(m.trios, ids.join("-"), win);
      });
    }
  });
  return { maps, battles: seen.size, players: players.length };
}

// Blend this week's counts with last week's at DECAY weight, then drop thin pair/trio rows to keep the file small.
function blend(fresh, previous) {
  const out = {};
  const keys = new Set([...Object.keys(fresh), ...Object.keys(previous || {})]);
  for (const k of keys) {
    const a = fresh[k];
    const b = previous?.[k];
    const base = a || b;
    const m = { mode: base.mode, map: base.map, mapId: base.mapId || b?.mapId || null, battles: 0, ranked: 0, brawlers: {}, pairs: {}, trios: {} };
    for (const [src, w] of [[a, 1], [b, DECAY]]) {
      if (!src) continue;
      m.battles += src.battles * w;
      m.ranked += (src.ranked || 0) * w;
      for (const field of ["brawlers", "pairs", "trios"]) {
        for (const [id, [g, wins]] of Object.entries(src[field])) {
          const c = m[field][id] || (m[field][id] = [0, 0]);
          c[0] += g * w;
          c[1] += wins * w;
        }
      }
    }
    if (m.battles < 2) continue;
    m.battles = round1(m.battles);
    m.ranked = round1(m.ranked);
    for (const [field, min] of [["brawlers", 0.5], ["pairs", 2], ["trios", 2]]) {
      for (const [id, c] of Object.entries(m[field])) {
        if (c[0] < min) delete m[field][id];
        else m[field][id] = [round1(c[0]), round1(c[1])];
      }
    }
    out[k] = m;
  }
  return out;
}

// ---------- squad profiles ----------

async function refreshSquad() {
  const config = await readJson(join(ROOT, "squad.config.json"), { players: [] });
  const history = await readJson(join(DATA, "squad-history.json"), {});
  const squadTags = new Set(config.players.map((p) => p.tag.toUpperCase()));
  const profiles = [];

  for (const member of config.players) {
    const tag = member.tag.toUpperCase();
    const player = await api(`/players/${enc(tag)}`);
    if (!player) {
      console.warn(`  could not load ${member.name} (${tag})`);
      continue;
    }
    const log = await api(`/players/${enc(tag)}/battlelog`);
    const h = history[tag] || (history[tag] = { seen: [], brawlers: {}, modes: {}, together: {} });
    const seen = new Set(h.seen);
    let added = 0;
    for (const entry of log?.items || []) {
      const bt = teamBattle(entry);
      if (!bt || bt.type === "friendly" || seen.has(bt.time)) continue;
      seen.add(bt.time);
      h.seen.push(bt.time);
      added++;
      const team = bt.teams.find((t) => t.some((p) => p.tag === tag));
      const me = team.find((p) => p.tag === tag);
      const win = bt.result === "victory";
      addCount(h.brawlers, me.id, win);
      addCount(h.modes, bt.mode + "|" + me.id, win);
      const mates = team.filter((p) => p.tag !== tag && squadTags.has(p.tag)).map((p) => p.tag).sort();
      if (mates.length) addCount(h.together, mates.join(","), win);
    }
    h.seen = h.seen.slice(-600);
    console.log(`  ${member.name}: ${player.brawlers.length} brawlers, ${added} new battles`);

    profiles.push({
      name: member.name,
      tag,
      ign: player.name,
      trophies: player.trophies,
      highest: player.highestTrophies,
      icon: player.icon?.id || null,
      club: player.club?.name || null,
      brawlers: player.brawlers.map((b) => ({
        id: b.id,
        power: b.power,
        rank: b.rank,
        trophies: b.trophies,
        highest: b.highestTrophies,
        gadgets: (b.gadgets || []).length,
        starPowers: (b.starPowers || []).length,
        gears: (b.gears || []).length,
        hyper: (b.hyperCharges || []).length,
      })),
      record: { brawlers: h.brawlers, modes: h.modes, together: h.together },
    });
  }
  await writeJson(join(DATA, "squad-history.json"), history);
  return profiles;
}

// ---------- main ----------

const started = Date.now();
await refreshGameData();

const rotation = ((await api("/events/rotation")) || []).map((s) => ({
  start: s.startTime,
  end: s.endTime,
  mode: s.event?.mode,
  map: s.event?.map,
  mapId: s.event?.id,
}));

console.log("refreshing squad");
const squad = await refreshSquad();

const sample = await collectMeta();
const prev = await readJson(join(DATA, "meta.json"), { maps: {} });
const maps = blend(sample.maps, prev.maps);

const updated = new Date().toISOString();
await writeJson(join(DATA, "meta.json"), {
  updated,
  sample: { players: sample.players, battles: sample.battles, decay: DECAY },
  rotation,
  maps,
});
await writeJson(join(DATA, "squad.json"), { updated, players: squad });
console.log(`done in ${Math.round((Date.now() - started) / 1000)}s: ${sample.battles} new battles across ${Object.keys(sample.maps).length} maps`);
