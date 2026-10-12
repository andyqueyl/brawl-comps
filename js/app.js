// Renders the three views (maps, one map, squad) from the weekly data files.
(function () {
  const E = window.BrawlEngine;
  const view = document.getElementById("view");
  const who = document.getElementById("who");
  const minPowerSel = document.getElementById("minPower");
  const state = { game: null, meta: null, squad: null, totals: null, selected: [], minPower: 1, query: "", mode: "all" };

  // ---------- small helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pct = (p) => (p * 100).toFixed(1) + "%";
  const fmt = (n) => Math.round(n).toLocaleString();
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bc:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("bc:" + k, JSON.stringify(v)); } catch {} },
  };

  let brawlerById = {};
  const bName = (id) => brawlerById[id]?.name || "#" + id;
  const bImg = (id, cls = "") => {
    const b = brawlerById[id];
    return b?.img ? `<img class="${cls}" src="${esc(b.img)}" alt="${esc(b.name)}" title="${esc(b.name)}" loading="lazy" width="56" height="56">` : `<span class="ph ${cls}" title="${esc(bName(id))}"></span>`;
  };
  function modeInfo(mode) {
    const m = state.game?.modes?.[norm(mode)];
    const name = m?.name || String(mode).replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
    return { name, img: m?.img, color: m?.color };
  }
  const modeIcon = (mode) => { const m = modeInfo(mode); return m.img ? `<img src="${esc(m.img)}" alt="" loading="lazy">` : ""; };
  function mapImg(m) {
    const byId = m.mapId && state.game?.maps?.[m.mapId];
    return byId?.img || "";
  }
  const playerIcon = (p) => (p.icon ? `https://cdn.brawlify.com/profile-icons/regular/${p.icon}.png` : "");
  const selectedPlayers = () => (state.squad?.players || []).filter((p) => state.selected.includes(p.tag));
  const inRotation = (m) => (state.meta.rotation || []).some((r) => r.map === m.map && r.mode === m.mode);
  const mapKey = (m) => m.mode + "|" + m.map;
  const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  // ---------- squad bar ----------
  function renderWho() {
    const players = state.squad?.players || [];
    if (!players.length) {
      who.innerHTML = `<span class="chip empty">No profiles yet — add tags to squad.config.json</span>`;
      return;
    }
    who.innerHTML = players
      .map((p) => {
        const icon = playerIcon(p);
        const on = state.selected.includes(p.tag);
        return `<button class="chip" type="button" data-tag="${esc(p.tag)}" aria-pressed="${on}">${icon ? `<img src="${esc(icon)}" alt="">` : `<span class="ini">${esc(p.name[0])}</span>`}${esc(p.name)}</button>`;
      })
      .join("");
  }
  who.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tag]");
    if (!btn) return;
    const tag = btn.dataset.tag;
    if (state.selected.includes(tag)) state.selected = state.selected.filter((t) => t !== tag);
    else {
      state.selected.push(tag);
      if (state.selected.length > 3) state.selected.shift();
    }
    store.set("selected", state.selected);
    renderWho();
    route();
  });
  minPowerSel.addEventListener("change", () => {
    state.minPower = +minPowerSel.value;
    store.set("minPower", state.minPower);
    route();
  });

  // ---------- maps list ----------
  function mapsView() {
    const maps = Object.values(state.meta.maps).filter((m) => m.battles >= 3);
    const modes = [...new Set(maps.map((m) => m.mode))].sort((a, b) => modeTotal(b) - modeTotal(a));
    function modeTotal(mode) { return state.totals[mode]?.battles || 0; }

    view.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Pick a map</h1>
          <p class="sub">${state.selected.length ? "Comps built from " + esc(selectedPlayers().map((p) => p.name).join(", ")) + "'s brawlers." : "Pick who's playing above to get comps from your own brawlers."}</p>
        </div>
      </div>
      <input class="search" id="q" type="search" placeholder="Search maps or modes" value="${esc(state.query)}" autocomplete="off">
      <div class="modes" id="modeChips">
        <button class="mode-chip" data-mode="all" aria-pressed="${state.mode === "all"}">All modes</button>
        ${modes.map((m) => `<button class="mode-chip" data-mode="${esc(m)}" aria-pressed="${state.mode === m}">${modeIcon(m)}${esc(modeInfo(m).name)}</button>`).join("")}
      </div>
      <div id="groups"></div>`;

    const groups = document.getElementById("groups");
    function draw() {
      const q = norm(state.query);
      const shown = maps.filter((m) => (state.mode === "all" || m.mode === state.mode) && (!q || norm(m.map).includes(q) || norm(modeInfo(m.mode).name).includes(q)));
      if (!shown.length) {
        groups.innerHTML = `<p class="note">No maps match. Maps only show up once top players have played them in the last couple of weeks.</p>`;
        return;
      }
      const byMode = {};
      for (const m of shown) (byMode[m.mode] ||= []).push(m);
      groups.innerHTML = modes
        .filter((mode) => byMode[mode])
        .map((mode) => {
          const list = byMode[mode].sort((a, b) => inRotation(b) - inRotation(a) || b.battles - a.battles);
          return `<section class="group"><h2>${modeIcon(mode)}${esc(modeInfo(mode).name)}</h2><div class="map-grid">${list.map(mapCard).join("")}</div></section>`;
        })
        .join("");
    }
    function mapCard(m) {
      const model = E.mapModel(state.meta, mapKey(m), state.totals);
      const top = model.topBrawlers(4, 3);
      const img = mapImg(m);
      return `<a class="map-card" href="#/map/${encodeURIComponent(mapKey(m))}">
        <span class="map-thumb" style="${img ? `background-image:url('${esc(img)}')` : ""}"></span>
        <span class="map-meta">
          <span class="map-name">${esc(m.map)}${inRotation(m) ? '<span class="badge">Live</span>' : ""}</span>
          <span class="map-sub">${fmt(m.battles)} battles</span>
          <span class="minis">${top.map((b) => bImg(b.id)).join("")}</span>
        </span></a>`;
    }
    draw();
    document.getElementById("q").addEventListener("input", (e) => { state.query = e.target.value; draw(); });
    document.getElementById("modeChips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]");
      if (!b) return;
      state.mode = b.dataset.mode;
      document.querySelectorAll("#modeChips [data-mode]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.mode === state.mode));
      draw();
    });
  }

  // ---------- one map ----------
  function mapView(key) {
    const model = E.mapModel(state.meta, key, state.totals);
    if (!model) {
      view.innerHTML = `<a class="back" href="#/">← All maps</a><p class="note">No data for this map yet.</p>`;
      return;
    }
    const m = model.info;
    const img = mapImg(m);
    const players = selectedPlayers();
    const teamSize = Object.keys(m.trios).length ? 3 : null;

    let squadHtml;
    if (!players.length) {
      squadHtml = `<p class="note">Tap who's playing in the bar above and this turns into comps built from your own brawlers.</p>`;
    } else {
      const recs = E.recommend(model, players, { minPower: state.minPower, limit: players.length === 1 ? 8 : 6 });
      if (!recs.length) squadHtml = `<p class="note">Nobody selected owns a brawler at power ${state.minPower}+.</p>`;
      else if (players.length === 1) squadHtml = soloPicks(recs, players[0]);
      else squadHtml = recs.map((r, i) => compRow(r, players, i === 0)).join("");
    }

    const topB = model.topBrawlers(15, 3);
    const topTrios = model.topTeams("trios", 8, 4);
    const topPairs = model.topTeams("pairs", 8, 6);

    view.innerHTML = `
      <a class="back" href="#/">← All maps</a>
      <div class="map-hero">
        <span class="map-thumb" style="${img ? `background-image:url('${esc(img)}')` : ""}"></span>
        <div>
          <div class="mode-line">${modeIcon(m.mode)}${esc(modeInfo(m.mode).name)}${inRotation(m) ? '<span class="badge">Live</span>' : ""}</div>
          <h1>${esc(m.map)}</h1>
          <p class="sub">${fmt(m.battles)} top-player battles${m.ranked ? ` · ${fmt(m.ranked)} in Ranked` : ""}</p>
        </div>
      </div>

      <section class="section">
        <h2>${players.length ? "Your comps" : "Your squad"}</h2>
        ${players.length > 1 ? `<p class="sub">Each of you on a brawler you own. The big % is the model's estimate for your squad: how the comp does for top players, adjusted for your power levels and your own records.</p>` : ""}
        ${squadHtml}
      </section>

      <section class="section">
        <h2>Meta on this map</h2>
        <p class="sub">From top-player battles, win rates pulled toward each brawler's mode average until there's enough games.</p>
        <div class="cols">
          <div class="panel">${brawlerTable(model, topB)}</div>
          <div class="panel">
            ${topTrios.length ? `<h3 style="margin-top:0">Best trios</h3>${teamTable(topTrios)}` : ""}
            ${topPairs.length ? `<h3 ${topTrios.length ? "" : 'style="margin-top:0"'}>Best pairs</h3>${teamTable(topPairs)}` : ""}
            ${!topTrios.length && !topPairs.length ? `<p class="sub">Not enough games yet to rank whole teams.</p>` : ""}
          </div>
        </div>
      </section>`;
  }

  function ownersOf(id) {
    return (state.squad?.players || []).filter((p) => p.brawlers.some((b) => b.id === id && b.power >= state.minPower)).map((p) => p.name);
  }

  function slot(pick, player) {
    const pers = pick.pers;
    const rec = pers.games ? `${pers.wins}-${pers.games - pers.wins} on it` : "";
    return `<div class="slot">
      <span class="who">${esc(player.name)}</span>
      ${bImg(pick.id)}
      <span class="bn">${esc(bName(pick.id))}</span>
      <span class="why">P${pers.owned.power} · ${pct(pick.meta.p)}${rec ? " · " + rec : ""}</span>
    </div>`;
  }

  function compRow(r, players, best) {
    const seen = r.comp.trio ? `, ${fmt(r.comp.trio.games)} games seen` : "";
    return `<div class="comp${best ? " best" : ""}">
      <div class="slots" style="--n:${players.length}">${r.picks.map((p, i) => slot(p, players[i])).join("")}</div>
      <div class="score"><div class="pct">${pct(E.sigmoid(r.score))}</div><div class="lbl">for you · top players ${pct(r.comp.p)}${seen}</div></div>
    </div>`;
  }

  function soloPicks(recs, player) {
    return `<div class="panel"><table><thead><tr><th>${esc(player.name)}'s best picks</th><th class="num">Map win</th><th class="num">Power</th><th class="num">Your record</th></tr></thead><tbody>
      ${recs.map((r) => { const c = r.picks[0]; return `<tr><td><span class="bcell">${bImg(c.id)}${esc(bName(c.id))}</span></td><td class="num">${pct(c.meta.p)}</td><td class="num">${c.pers.owned.power}</td><td class="num">${c.pers.games ? `${c.pers.wins}-${c.pers.games - c.pers.wins}` : "—"}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  }

  function brawlerTable(model, list) {
    const maxPick = Math.max(...list.map((b) => b.pick), 0.0001);
    return `<h3 style="margin-top:0">Top brawlers</h3><table><thead><tr><th>Brawler</th><th class="num">Win</th><th class="num">Pick</th><th class="num">Games</th></tr></thead><tbody>
      ${list.map((b) => {
        const owners = ownersOf(b.id);
        return `<tr><td><span class="bcell">${bImg(b.id)}<span>${esc(bName(b.id))}${owners.length ? `<br><span class="owned-by">${esc(owners.join(", "))}</span>` : ""}</span></span></td>
        <td class="num ${b.p >= 0.5 ? "pos" : "neg"}">${pct(b.p)}</td>
        <td class="num">${pct(b.pick)}<div class="bar"><i style="width:${(b.pick / maxPick) * 100}%"></i></div></td>
        <td class="num">${fmt(b.games)}</td></tr>`;
      }).join("")}
    </tbody></table>`;
  }

  function teamTable(list) {
    return `<table><thead><tr><th>Team</th><th class="num">Win</th><th class="num">Games</th></tr></thead><tbody>
      ${list.map((t) => `<tr><td><span class="team-cell">${t.ids.map((id) => bImg(id)).join("")}</span></td><td class="num ${t.p >= 0.5 ? "pos" : "neg"}">${pct(t.p)}</td><td class="num">${fmt(t.games)}</td></tr>`).join("")}
    </tbody></table>`;
  }

  // ---------- squad ----------
  function squadView() {
    const players = state.squad?.players || [];
    if (!players.length) {
      view.innerHTML = `<div class="page-head"><h1>Squad</h1></div><p class="note">No profiles yet. Add each person's name and player tag to <code>squad.config.json</code>; the next weekly update pulls their brawlers.</p>`;
      return;
    }
    const modes = Object.entries(state.totals).sort((a, b) => b[1].battles - a[1].battles).slice(0, 10).map(([mode]) => mode);
    const models = Object.keys(state.meta.maps).map((k) => E.mapModel(state.meta, k, state.totals));

    // A player's best brawlers for a mode: average meta strength over that mode's maps plus their personal fit.
    function bestForMode(p, mode) {
      const ms = models.filter((md) => md.info.mode === mode);
      return p.brawlers
        .filter((b) => b.power >= state.minPower)
        .map((b) => {
          const w = ms.reduce((s, md) => s + md.info.battles, 0) || 1;
          const L = ms.reduce((s, md) => s + md.brawler(b.id).L * md.info.battles, 0) / w;
          return { id: b.id, s: L + E.personal(p, b.id).L };
        })
        .sort((a, b) => b.s - a.s)
        .slice(0, 4);
    }

    view.innerHTML = `<div class="page-head"><div><h1>Squad</h1><p class="sub">Brawlers and records as of ${esc(shortDate(state.squad.updated))}.</p></div></div>
      <div class="profiles">${players.map((p) => {
        const maxed = p.brawlers.filter((b) => b.power >= 11).length;
        const rec = Object.values(p.record?.brawlers || {}).reduce((a, [g, w]) => [a[0] + g, a[1] + w], [0, 0]);
        const mostPlayed = Object.entries(p.record?.brawlers || {}).sort((a, b) => b[1][0] - a[1][0]).slice(0, 5);
        const together = Object.entries(p.record?.together || {}).map(([tags, [g, w]]) => ({ names: tags.split(",").map((t) => players.find((x) => x.tag === t)?.name || t), g, w })).sort((a, b) => b.g - a.g);
        const icon = playerIcon(p);
        return `<article class="panel profile">
          <div class="prof-head">${icon ? `<img src="${esc(icon)}" alt="">` : `<span class="ini">${esc(p.name[0])}</span>`}<div><h2>${esc(p.name)}</h2><span class="sub">${esc(p.ign)} · ${esc(p.tag)}${p.club ? " · " + esc(p.club) : ""}</span></div></div>
          <div class="stats">
            <div class="stat"><b>${fmt(p.trophies)}</b><span>Trophies</span></div>
            <div class="stat"><b>${p.brawlers.length}</b><span>Brawlers</span></div>
            <div class="stat"><b>${maxed}</b><span>Power 11</span></div>
          </div>
          <h3>Best picks by mode</h3>
          <div class="mode-picks">${modes.map((mode) => `<div class="mode-row"><span class="lab">${modeIcon(mode)}${esc(modeInfo(mode).name)}</span><span class="picks">${bestForMode(p, mode).map((b) => bImg(b.id)).join("")}</span></div>`).join("")}</div>
          ${mostPlayed.length ? `<h3>Most played (tracked ${rec[0]} games, ${rec[0] ? pct(rec[1] / rec[0]) : "—"} won)</h3>
            <table><tbody>${mostPlayed.map(([id, [g, w]]) => `<tr><td><span class="bcell">${bImg(+id)}${esc(bName(+id))}</span></td><td class="num">${w}-${g - w}</td></tr>`).join("")}</tbody></table>` : ""}
          ${together.length ? `<h3>Playing together</h3><table><tbody>${together.map((t) => `<tr><td>with ${esc(t.names.join(" + "))}</td><td class="num">${t.w}-${t.g - t.w}</td></tr>`).join("")}</tbody></table>` : ""}
        </article>`;
      }).join("")}</div>`;
  }

  // ---------- about ----------
  function aboutView() {
    const s = state.meta.sample || {};
    view.innerHTML = `<article class="prose">
      <h1 style="font-size:40px">How it works</h1>
      <h2>Where the numbers come from</h2>
      <p>Every Monday a GitHub Action pulls the last 25 battles of about ${fmt(s.players || 0)} top-ranked players (global plus ~20 country leaderboards) from the official Brawl Stars API. Trophy and Ranked team games count; Showdown, Duels and friendlies don't. Last update: ${fmt(s.battles || 0)} battles. The previous week's counts stay in at half weight so smaller maps keep a sample.</p>
      <p>Top players win far more than half their games${s.sampledSideWin?.all ? ` (${s.sampledSideWin.all}% last update)` : ""}, so anything they pick would look stronger than it is. That edge is measured each week and taken back out, so the win rates here are about the brawlers, not the players.</p>
      <h2>How comps are ranked</h2>
      <ul>
        <li><b>Brawler on a map:</b> win rate on that map, pulled toward the brawler's win rate across the whole mode. How hard it's pulled is fitted from the data, so a 4-0 brawler doesn't top the list.</li>
        <li><b>Pairs and trios:</b> if a pair or exact trio has been seen, its record nudges the score up or down versus what the individual brawlers predict.</li>
        <li><b>Your squad:</b> only brawlers each person owns at the chosen power or higher. Every power level under 11 costs a little, and each person's own tracked record on a brawler counts for a bit once there are enough games.</li>
      </ul>
      <p>Checked on held-out battles: the scores are well calibrated overall, and the comps ranked highest kept winning on battles the model hadn't seen.</p>
      <h2>What it can't tell you</h2>
      <ul>
        <li><b>Picks matter less than skill.</b> Knowing both teams' brawlers only raised the share of held-out games called correctly from 65% to 66%. A better comp is a few percentage points, not a guaranteed win.</li>
        <li>It's top-player data. What wins at the top isn't always what wins at lower trophies.</li>
        <li>The highest trio records often come from a few pre-made top teams, so part of "this trio wins" is "these players win".</li>
        <li>Unless a comp says "games seen", that exact trio wasn't played enough to measure; the % is built from its brawlers and pairs.</li>
        <li>Balance changes show up the next Monday, and the first week after a patch mixes old and new data.</li>
        <li>The API only returns each player's last 25 battles, so squad records miss games when someone plays more than that in a week.</li>
        <li>The "Live" badge is the rotation at update time; maps rotate daily, so it goes stale during the week.</li>
      </ul>
      <p>Brawler and map art from <a href="https://brawlify.com">Brawlify</a>. Data from the official Brawl Stars API via RoyaleAPI's proxy. Not affiliated with Supercell.</p>
    </article>`;
  }

  // ---------- routing ----------
  function route() {
    if (!state.meta) return;
    const h = location.hash.replace(/^#\/?/, "");
    let tab = "maps";
    if (h.startsWith("map/")) mapView(decodeURIComponent(h.slice(4)));
    else if (h === "squad") { tab = "squad"; squadView(); }
    else if (h === "about") { tab = "about"; aboutView(); }
    else mapsView();
    document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  }
  window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });
  // Brawlify sometimes lacks art for the newest brawlers; swap a broken portrait for its initials.
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || !img.alt) return;
    const ph = document.createElement("span");
    ph.className = "ph " + img.className;
    ph.title = img.alt;
    ph.textContent = img.alt.slice(0, 2);
    img.replaceWith(ph);
  }, true);

  async function load() {
    const get = (f) => fetch("data/" + f, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null));
    const [game, meta, squad] = await Promise.all([get("game.json"), get("meta.json"), get("squad.json")]);
    if (!meta) {
      view.innerHTML = `<p class="note">No data yet. The first weekly update hasn't run.</p>`;
      return;
    }
    Object.assign(state, { game, meta, squad: squad || { players: [] }, totals: E.modeTotals(meta) });
    brawlerById = Object.fromEntries((game?.brawlers || []).map((b) => [b.id, b]));
    const tags = new Set(state.squad.players.map((p) => p.tag));
    state.selected = store.get("selected", []).filter((t) => tags.has(t));
    state.minPower = store.get("minPower", 1);
    minPowerSel.value = String(state.minPower);
    document.getElementById("foot").innerHTML = `Updated ${esc(shortDate(meta.updated))} from ${fmt(meta.sample?.battles || 0)} top-player battles. Refreshes every Monday. Not affiliated with Supercell.`;
    renderWho();
    route();
  }
  load().catch((e) => { view.innerHTML = `<p class="note">Couldn't load data: ${esc(e.message)}</p>`; });
})();
