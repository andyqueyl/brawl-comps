// Builds the private Claude page version of the site into artifact/ (gitignored).
//
//   node scripts/build-artifact.mjs
//
// That page can't load images from other sites or link its own stylesheet, so this inlines the CSS and JS
// into one HTML file and embeds every portrait, map and icon as a data URI inside data/game.json.
// Downloaded art is cached in artifact/.imgcache, so weekly rebuilds only fetch new brawlers and maps.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "artifact");
const CACHE = join(OUT, ".imgcache");
const read = async (f) => JSON.parse(await readFile(join(ROOT, f), "utf8"));
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

await mkdir(join(OUT, "data"), { recursive: true });
await mkdir(CACHE, { recursive: true });

const [game, meta, squad] = await Promise.all([read("data/game.json"), read("data/meta.json"), read("data/squad.json")]);
for (const k of Object.keys(meta.maps)) if (/5v5/i.test(meta.maps[k].mode)) delete meta.maps[k];
meta.rotation = (meta.rotation || []).filter((r) => !/5v5/i.test(r.mode || ""));

let fetched = 0;
let missing = 0;
async function dataUri(url) {
  if (!url) return "";
  const file = join(CACHE, createHash("sha1").update(url).digest("hex") + ".png");
  if (!existsSync(file)) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) {
      missing++;
      return "";
    }
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    fetched++;
  }
  return "data:image/png;base64," + (await readFile(file)).toString("base64");
}

// Only the art the page can show: every brawler, the maps and modes that have data, the squad's icons.
const mapIds = new Set(Object.values(meta.maps).map((m) => String(m.mapId)));
const modeKeys = new Set(Object.values(meta.maps).map((m) => norm(m.mode)));
const out = { brawlers: [], maps: {}, modes: {} };
await Promise.all([
  ...game.brawlers.map(async (b) => out.brawlers.push({ ...b, img: await dataUri(b.img) })),
  ...Object.entries(game.maps).filter(([id]) => mapIds.has(id)).map(async ([id, m]) => (out.maps[id] = { ...m, img: await dataUri(m.img) })),
  ...Object.entries(game.modes).filter(([k]) => modeKeys.has(k)).map(async ([k, m]) => (out.modes[k] = { ...m, img: await dataUri(m.img) })),
  ...squad.players.map(async (p) => (p.iconImg = p.icon ? await dataUri(`https://cdn.brawlify.com/profile-icons/regular/${p.icon}.png`) : "")),
]);
out.brawlers.sort((a, b) => a.id - b.id);

await writeFile(join(OUT, "data/game.json"), JSON.stringify(out));
await writeFile(join(OUT, "data/meta.json"), JSON.stringify(meta));
await writeFile(join(OUT, "data/squad.json"), JSON.stringify(squad));

// One self-contained page: the publish step wraps it in its own <html>/<head>/<body>.
const html = await readFile(join(ROOT, "index.html"), "utf8");
const css = (await readFile(join(ROOT, "css/style.css"), "utf8"))
  // The page runs edge to edge on phones; keep the sticky bar below the status bar.
  .replace(".squadbar { position: sticky; top: 0;", ".squadbar { position: sticky; top: env(safe-area-inset-top, 0px);");
const engine = await readFile(join(ROOT, "js/engine.js"), "utf8");
const app = await readFile(join(ROOT, "js/app.js"), "utf8");
const title = html.match(/<title>.*?<\/title>/)[0];
const fonts = html.match(/<link rel="preconnect"[\s\S]*?display=swap">/)[0];
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("<script src="));
const page = `${title}
${fonts}
<style>
${css}
</style>
${body.trim()}
<script>
${engine}
</script>
<script>
${app}
</script>
`;
await writeFile(join(OUT, "brawl-comps.html"), page);

const kb = (f) => Math.round(Buffer.byteLength(f) / 1024);
console.log(`built artifact/: page ${kb(page)} KB, game.json ${kb(JSON.stringify(out))} KB, meta.json ${kb(JSON.stringify(meta))} KB`);
console.log(`art: ${fetched} downloaded, ${missing} unavailable (shown as initials)`);
