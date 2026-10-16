// Renders the pages (home, one map, squad, method) from the data files. Routing is by hash.
(function () {
  const E = window.BrawlEngine;
  const view = document.getElementById("view");
  // We mostly play these two; they lead every list and are the default filter.
  const FOCUS = ["brawlBall", "knockout"];
  const state = { game: null, meta: null, squad: null, rotation: null, totals: null, selected: [], minPower: 1, query: "", filter: "focus", metaTab: "brawlers", locks: {}, lockMap: null, excluded: {} };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pct = (p) => (p * 100).toFixed(1) + "%";
  const fmt = (n) => Math.round(n).toLocaleString();
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bc:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("bc:" + k, JSON.stringify(v)); } catch {} },
  };
  const DAY = 864e5;
  const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const apiTime = (t) => Date.parse(String(t).replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)/, "$1-$2-$3T$4:$5:$6"));
  const check = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5l2.2 2.2L9.5 3.5"/></svg>`;

  let brawlerById = {};
  const bName = (id) => brawlerById[id]?.name || "#" + id;
  const bImg = (id) => {
    const b = brawlerById[id];
    return b?.img ? `<img src="${esc(b.img)}" alt="${esc(b.name)}" title="${esc(b.name)}" loading="lazy" width="52" height="52">` : `<span class="ph" title="${esc(bName(id))}">${esc(bName(id).slice(0, 2))}</span>`;
  };
  function modeInfo(mode) {
    const m = state.game?.modes?.[norm(mode)];
    const name = m?.name || String(mode).replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
    return { name, img: m?.img };
  }
  const modeColor = (mode) => (mode === "brawlBall" ? "var(--ball)" : mode === "knockout" ? "var(--ko)" : "var(--other)");
  const modeIcon = (mode) => { const m = modeInfo(mode); return m.img ? `<img src="${esc(m.img)}" alt="" loading="lazy">` : ""; };
  const modeTag = (mode) => `<span class="mode-tag" style="--mode:${modeColor(mode)}">${modeIcon(mode)}${esc(modeInfo(mode).name)}</span>`;
  const mapImg = (m) => (m.mapId && state.game?.maps?.[m.mapId]?.img) || "";
  const artStyle = (m) => { const i = mapImg(m); return i ? `background-image:url('${esc(i)}')` : ""; };
  const mapKey = (m) => m.mode + "|" + m.map;
  const mapHref = (m) => "#/map/" + encodeURIComponent(mapKey(m));
  const playerIcon = (p) => p.iconImg || (p.icon ? `https://cdn.brawlify.com/profile-icons/regular/${p.icon}.png` : "");
  const avatar = (p) => { const i = playerIcon(p); return i ? `<img src="${esc(i)}" alt="">` : `<span class="ph">${esc(p.name[0])}</span>`; };
  const selectedPlayers = () => (state.squad?.players || []).filter((p) => state.selected.includes(p.tag));
  const liveSlot = (m) => (state.rotation || []).find((r) => r.map === m.map && r.mode === m.mode && apiTime(r.end) > Date.now());
  const model = (key) => E.mapModel(state.meta, key, state.totals);
  const recommend = (md, players, limit, locked, excluded) => E.recommend(md, players, { minPower: state.minPower, limit, locked, excluded, now: Date.now() });

  // ---------- squad picker ----------
  function picker(compact) {
    const players = state.squad?.players || [];
    if (!players.length) return `<div class="card picker"><p class="note">No squad yet. Add names and player tags to squad.config.json.</p></div>`;
    const powers = [[1, "Any"], [9, "9+"], [10, "10+"], [11, "11"]];
    return `<div class="card picker${compact ? " compact" : ""}">
      ${compact ? "" : `<div class="picker-head"><span class="label">Who's on?</span><span class="label">${Math.min(state.selected.length, 3)}/3 picked</span></div>`}
      <div class="players">${players.map((p) => `<button type="button" class="player" data-tag="${esc(p.tag)}" aria-pressed="${state.selected.includes(p.tag)}">
        ${avatar(p)}<span><b>${esc(p.name)}</b><small>${fmt(p.trophies)} trophies</small></span><span class="tick">${check}</span></button>`).join("")}</div>
      ${compact ? "" : `<div class="picker-foot"><span class="label">Min power</span><div class="seg" role="group" aria-label="Minimum power">${powers.map(([v, l]) => `<button type="button" data-power="${v}" aria-pressed="${state.minPower === v}">${l}</button>`).join("")}</div></div>`}
    </div>`;
  }

  // ---------- home ----------
  function homeView() {
    const players = selectedPlayers();
    const maps = Object.values(state.meta.maps).filter((m) => m.battles >= 3);
    const live = maps.filter((m) => FOCUS.includes(m.mode) && liveSlot(m)).sort((a, b) => FOCUS.indexOf(a.mode) - FOCUS.indexOf(b.mode) || b.battles - a.battles);

    view.innerHTML = `
      <section class="hero">
        <div>
          <span class="eyebrow">Squad comps · Brawl Ball + Knockout · 3v3</span>
          <h1>Brawl<br><em>Comps</em></h1>
          <p class="lede">Pick who's on, and every map shows the best trio <b>built from the brawlers you own</b>: ranked mostly by what wins for top players, with a nudge toward what each of you is good on.</p>
        </div>
        ${picker(false)}
      </section>

      ${live.length ? `<section class="section">
        <div class="section-head"><div><span class="eyebrow">In rotation now</span><h2>Live maps</h2></div></div>
        <div class="live-grid">${live.map((m) => featureCard(m, players)).join("")}</div>
      </section>` : ""}

      <section class="section" id="all">
        <div class="section-head"><div><span class="eyebrow">${fmt(maps.length)} maps with data</span><h2>All maps</h2></div></div>
        <div class="filters">
          <div class="seg" role="group" aria-label="Mode" id="filter">
            ${[["focus", "Brawl Ball + Knockout"], ["brawlBall", "Brawl Ball"], ["knockout", "Knockout"], ["all", "All modes"]].map(([v, l]) => `<button type="button" data-filter="${v}" aria-pressed="${state.filter === v}">${l}</button>`).join("")}
          </div>
          <input class="search" id="q" type="search" placeholder="Search maps" value="${esc(state.query)}" autocomplete="off">
        </div>
        <div id="groups"></div>
      </section>`;

    const groups = document.getElementById("groups");
    const rank = (mode) => (FOCUS.includes(mode) ? FOCUS.indexOf(mode) : 9);
    const modesOrdered = [...new Set(maps.map((m) => m.mode))].sort((a, b) => rank(a) - rank(b) || (state.totals[b]?.battles || 0) - (state.totals[a]?.battles || 0));
    function draw() {
      const q = norm(state.query);
      const pass = (m) => (state.filter === "all" || (state.filter === "focus" ? FOCUS.includes(m.mode) : m.mode === state.filter)) && (!q || norm(m.map).includes(q));
      const shown = maps.filter(pass);
      if (!shown.length) { groups.innerHTML = `<p class="note">No maps match. A map shows up once top players have played it in the last couple of weeks.</p>`; return; }
      groups.innerHTML = modesOrdered.map((mode) => {
        const list = shown.filter((m) => m.mode === mode).sort((a, b) => !!liveSlot(b) - !!liveSlot(a) || b.battles - a.battles);
        if (!list.length) return "";
        return `<div class="group"><div class="group-head">${modeIcon(mode)}<h3>${esc(modeInfo(mode).name)}</h3><span class="count">${list.length}</span></div>
          <ul class="tiles">${list.map((m) => `<li>${tile(m)}</li>`).join("")}</ul></div>`;
      }).join("");
    }
    draw();
    document.getElementById("q").addEventListener("input", (e) => { state.query = e.target.value; draw(); });
    document.getElementById("filter").addEventListener("click", (e) => {
      const b = e.target.closest("[data-filter]");
      if (!b) return;
      state.filter = b.dataset.filter;
      store.set("filter", state.filter);
      document.querySelectorAll("#filter [data-filter]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.filter === state.filter));
      draw();
    });
  }

  function featureCard(m, players) {
    const md = model(mapKey(m));
    const slot = liveSlot(m);
    const hoursLeft = slot ? Math.max(0, Math.round((apiTime(slot.end) - Date.now()) / 36e5)) : 0;
    let pick = "";
    if (players.length >= 1 && players.length <= 3) {
      const r = recommend(md, players, 1)[0];
      if (r) pick = `<span class="trio">${r.picks.map((p) => bImg(p.id)).join("")}</span><span><span class="pct-big">${pct(r.comp.p)}</span><br><span class="pct-cap">your best comp</span></span>`;
    } else {
      const top = md.topBrawlers(3, 10);
      pick = `<span class="trio">${top.map((b) => bImg(b.id)).join("")}</span><span class="pct-cap">${players.length > 3 ? "pick 3 people for your comp" : "top brawlers here"}</span>`;
    }
    return `<a class="card feature" href="${mapHref(m)}">
      <span class="art" style="${artStyle(m)}"></span>
      <span>
        ${modeTag(m.mode)}
        <h3>${esc(m.map)}</h3>
        <span class="sub">${hoursLeft ? `${hoursLeft}h left · ` : ""}${fmt(m.battles)} battles</span>
        <span class="pick-row">${pick}</span>
      </span>
    </a>`;
  }

  function tile(m) {
    const top = model(mapKey(m)).topBrawlers(4, 3);
    return `<a class="card tile" href="${mapHref(m)}" style="--mode:${modeColor(m.mode)}">
      <span class="art" style="${artStyle(m)}">${liveSlot(m) ? '<span class="live">Live</span>' : ""}</span>
      <span class="body">
        <span class="mode-tag">${esc(modeInfo(m.mode).name)}</span>
        <h4>${esc(m.map)}</h4>
        <span class="meta"><span class="num">${fmt(m.battles)} battles</span><span class="mini">${top.map((b) => bImg(b.id)).join("")}</span></span>
      </span>
    </a>`;
  }

  // ---------- one map ----------
  function trophyRank(player, id) {
    const mine = player.brawlers.find((b) => b.id === id)?.highest || 0;
    return 1 + player.brawlers.filter((b) => (b.highest || 0) > mine).length;
  }
  const record = (pers) => `${pers.recentWins}-${pers.recentGames - pers.recentWins}`;
  function form(pers, player, id) {
    const bits = [`P${pers.owned.power}`];
    if (pers.recentGames) bits.push(`${record(pers)} last 30d`);
    bits.push(`#${trophyRank(player, id)} in trophies`);
    return bits.join(" · ");
  }

  function mapView(key) {
    const md = model(key);
    if (!md) { view.innerHTML = `<nav class="crumbs"><a href="#/">Maps</a></nav><p class="note">No data for this map yet.</p>`; return; }
    const m = md.info;
    const players = selectedPlayers();
    const best = md.topBrawlers(1, 10)[0];
    // Picks already made in the lobby. They belong to one game, so they reset when you open another map.
    if (state.lockMap !== key) { state.locks = {}; state.lockMap = key; }
    const locked = players.map((p) => state.locks[p.tag] ?? null);
    const excluded = players.map((p) => state.excluded[p.tag] || []);

    let comps;
    if (!players.length) comps = `<p class="note">Pick who's playing above and this fills with comps from your own brawlers.</p>`;
    else if (players.length > 3) comps = `<p class="note">${players.length} people picked, but it's 3v3. Tap whoever's sitting out.</p>`;
    else {
      const recs = recommend(md, players, players.length === 1 ? 8 : 6, locked, excluded);
      comboOpts = {};
      comps = (players.length > 1 ? lockRow(players, locked, md) : "") + banRow(players, locked, md) +
        (recs.length ? `<div class="comps">${recs.map((r, i) => compRow(r, players, i)).join("")}</div>`
          : `<p class="note">${excluded.some((x) => x.length) ? `No brawlers left at power ${state.minPower}+ once the left-out ones are removed.` : `Nobody picked owns a brawler at power ${state.minPower}+.`}</p>`);
    }

    view.innerHTML = `
      <nav class="crumbs"><a href="#/">Maps</a><span>/</span><span>${esc(modeInfo(m.mode).name)}</span></nav>
      <header class="map-head">
        <span class="art" style="${artStyle(m)}"></span>
        <div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${modeTag(m.mode)}${liveSlot(m) ? '<span class="live">Live</span>' : ""}</div>
          <h1>${esc(m.map)}</h1>
          <div class="stats">
            <div class="stat"><span class="label">Battles</span><b>${fmt(m.battles)}</b></div>
            <div class="stat"><span class="label">Brawlers seen</span><b>${Object.keys(m.brawlers).length}</b></div>
            ${best ? `<div class="stat"><span class="label">Best brawler</span><b>${esc(bName(best.id))}</b></div>` : ""}
          </div>
        </div>
      </header>

      <section class="section">
        <div class="section-head"><div><span class="eyebrow">Ranked for your squad</span><h2>Your comps</h2>
          <p>Ranked mostly by how each comp does for top players on this map (the %), then nudged toward what each of you is good on (recent games, then highest trophies).</p></div></div>
        ${picker(true)}
        <div style="height:12px"></div>
        ${comps}
      </section>

      <section class="section">
        <div class="section-head"><div><span class="eyebrow">Top-player battles</span><h2>Meta</h2></div>
          <div class="seg" role="group" aria-label="Meta view" id="metaTabs">${[["brawlers", "Brawlers"], ["trios", "Trios"], ["pairs", "Pairs"]].map(([v, l]) => `<button type="button" data-meta="${v}" aria-pressed="${state.metaTab === v}">${l}</button>`).join("")}</div>
        </div>
        <div class="card panel"><div class="table-wrap" id="metaBody"></div></div>
      </section>`;

    const body = document.getElementById("metaBody");
    const drawMeta = () => { body.innerHTML = state.metaTab === "brawlers" ? brawlerTable(md) : teamTable(md, state.metaTab); };
    drawMeta();
    document.getElementById("metaTabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-meta]");
      if (!b) return;
      state.metaTab = b.dataset.meta;
      document.querySelectorAll("#metaTabs [data-meta]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.meta === state.metaTab));
      drawMeta();
    });
  }

  // "Already picked" row: lock what people have chosen in the lobby, and the list fills the open spots.
  // Each open player gets a type-to-search box. Before you type it lists that player's best brawlers
  // for this map; as you type it narrows by name, names that start with what you typed first.
  let comboOpts = {};
  // A person's brawlers for a search box, best for this map first (same score as the comps).
  function ranked(p, md, keep) {
    const now = Date.now();
    return p.brawlers.filter(keep).map((b) => {
      const meta = md.brawler(b.id);
      const pers = E.personal(p, b.id, { mode: md.info.mode, now });
      return { id: b.id, name: bName(b.id), lower: bName(b.id).toLowerCase(), power: b.power, p: meta.p, fit: meta.L + E.PERSONAL_WEIGHT * pers.L };
    }).sort((a, b) => b.fit - a.fit);
  }
  function lockRow(players, locked, md) {
    const open = players.filter((_, i) => locked[i] == null);
    const done = players.length - open.length;
    const head = !done ? "Someone already picked in the lobby? Type their brawler, or tap one in a comp below."
      : !open.length ? "Everyone's locked in. This is how your comp rates."
      : `Showing the best ${open.length === 1 ? "pick" : "picks"} for ${open.map((p) => esc(p.name)).join(" and ")}.`;
    return `<div class="card locks">
      <div class="locks-head"><span class="label">Already picked</span>${done ? `<button type="button" class="link" data-unlock-all>Clear all</button>` : ""}</div>
      <div class="lock-grid" style="--n:${players.length}">${players.map((p, i) => {
        if (locked[i] != null) {
          const id = locked[i];
          return `<div class="lock on"><span class="who">${esc(p.name)}</span>
            <div class="chosen">${bImg(id)}<b>${esc(bName(id))}</b><button type="button" class="x" data-unlock="${esc(p.tag)}" aria-label="Unlock ${esc(bName(id))} for ${esc(p.name)}">×</button></div></div>`;
        }
        const taken = new Set(locked.filter((x) => x != null));
        comboOpts["lock:" + p.tag] = ranked(p, md, (b) => !taken.has(b.id));
        return `<div class="lock"><label class="who" for="lk-${i}">${esc(p.name)}</label>
          <div class="combo"><input id="lk-${i}" data-lock-input="${esc(p.tag)}" type="text" placeholder="Type a brawler…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"
            role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="lk-list-${i}"><ul class="combo-list" id="lk-list-${i}" role="listbox" hidden></ul></div></div>`;
      }).join("")}</div>
      <p class="locks-note">${head}</p>
    </div>`;
  }

  // "Don't suggest" row: brawlers someone won't play. Unlike locks these are a standing preference,
  // so they're saved on the device and apply on every map until removed.
  function banRow(players, locked, md) {
    const any = players.some((p) => (state.excluded[p.tag] || []).length);
    return `<div class="card locks bans">
      <div class="locks-head"><span class="label">Don't suggest</span>${any ? `<button type="button" class="link" data-unban-all>Clear all</button>` : ""}</div>
      <div class="lock-grid" style="--n:${players.length}">${players.map((p, i) => {
        const ex = state.excluded[p.tag] || [];
        comboOpts["ban:" + p.tag] = ranked(p, md, (b) => !ex.includes(b.id) && b.id !== locked[i]);
        return `<div class="lock"><label class="who" for="bn-${i}">${esc(p.name)}</label>
          ${ex.length ? `<div class="ban-chips">${ex.map((id) => `<span class="ban-chip">${bImg(id)}<b>${esc(bName(id))}</b><button type="button" class="x" data-unban="${esc(p.tag)}" data-id="${id}" aria-label="Suggest ${esc(bName(id))} for ${esc(p.name)} again">×</button></span>`).join("")}</div>` : ""}
          <div class="combo"><input id="bn-${i}" data-ban-input="${esc(p.tag)}" type="text" placeholder="Leave out a brawler…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"
            role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="bn-list-${i}"><ul class="combo-list" id="bn-list-${i}" role="listbox" hidden></ul></div></div>`;
      }).join("")}</div>
      <p class="locks-note">${any ? "Left out on every map, saved on this device until you remove them." : "Someone won't play a brawler? Type it and it's left out of their suggestions on every map."}</p>
    </div>`;
  }

  const COMBO = "[data-lock-input],[data-ban-input]";
  const comboKey = (input) => input.dataset.lockInput != null ? "lock:" + input.dataset.lockInput : "ban:" + input.dataset.banInput;
  function comboPick(input, o, fromKeyboard) {
    if (input.dataset.lockInput != null) lockIn(input.dataset.lockInput, o.id, fromKeyboard);
    else banIn(input.dataset.banInput, o.id, fromKeyboard);
  }
  function comboMatches(key, q) {
    const all = comboOpts[key] || [];
    q = q.trim().toLowerCase();
    if (!q) return all.slice(0, 6);
    const starts = all.filter((o) => o.lower.startsWith(q)), rest = all.filter((o) => !o.lower.startsWith(q) && o.lower.includes(q));
    return [...starts, ...rest].slice(0, 8);
  }
  function drawCombo(input, active = 0) {
    const list = input.nextElementSibling;
    const q = input.value;
    const items = comboMatches(comboKey(input), q);
    input._items = items;
    input._active = Math.min(active, items.length - 1);
    list.innerHTML = (!q.trim() && items.length ? `<li class="combo-head" role="presentation">Best for this map</li>` : "") +
      (items.length ? items.map((o, k) => `<li role="option" id="${input.id}-o${k}" data-k="${k}" aria-selected="${k === input._active}">${bImg(o.id)}<span><b>${esc(o.name)}</b><small>${pct(o.p)} here · P${o.power}</small></span></li>`).join("")
        : `<li class="combo-empty" role="presentation">No brawler they own matches “${esc(q.trim())}”</li>`);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (input._active >= 0) input.setAttribute("aria-activedescendant", `${input.id}-o${input._active}`);
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }
  function closeCombo(input) {
    input.nextElementSibling.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function lockIn(tag, id, fromKeyboard) {
    state.locks[tag] = id;
    rerender();
    // Typing flow: jump straight to the next person who hasn't picked.
    if (fromKeyboard) view.querySelector("[data-lock-input]")?.focus();
  }
  function banIn(tag, id, fromKeyboard) {
    state.excluded[tag] = [...(state.excluded[tag] || []).filter((x) => x !== id), id];
    store.set("excluded", state.excluded);
    rerender();
    // Stay in the same box so several can be left out in a row.
    if (fromKeyboard) view.querySelector(`[data-ban-input="${CSS.escape(tag)}"]`)?.focus();
  }

  function compRow(r, players, i) {
    const seen = r.comp.trio ? ` · ${fmt(r.comp.trio.games)} games seen` : "";
    // With two or more people on, each brawler is a button that locks it in for that person.
    const slot = (p, j) => players.length === 1 ? `<div class="slot">${bImg(p.id)}<div><div class="who">${esc(players[j].name)}</div><div class="bn">${esc(bName(p.id))}</div><div class="form">${esc(form(p.pers, players[j], p.id))}</div></div></div>` : `<button type="button" class="slot${p.locked ? " locked" : ""}" data-pick="${esc(players[j].tag)}" data-id="${p.id}" title="${p.locked ? "Unlock" : "Lock in"} ${esc(bName(p.id))} for ${esc(players[j].name)}">${bImg(p.id)}<div><div class="who">${esc(players[j].name)}${p.locked ? ' · <span class="picked">Picked</span>' : ""}</div><div class="bn">${esc(bName(p.id))}</div><div class="form">${esc(form(p.pers, players[j], p.id))}</div></div></button>`;
    return `<article class="card comp${i === 0 ? " top" : ""}">
      <span class="rank">${String(i + 1).padStart(2, "0")}</span>
      <div class="slots" style="--n:${players.length}">${r.picks.map(slot).join("")}</div>
      <div class="score">${i === 0 ? '<span class="top-badge">Top pick</span>' : ""}<div class="pct-big">${pct(r.comp.p)}</div><div class="pct-cap">top players${seen}</div></div>
    </article>`;
  }

  // Win rate with a bar scaled from 30% (empty) to 70% (full).
  const wr = (p) => `<span class="wr"><span class="num ${p >= 0.5 ? "pos" : "neg"}">${pct(p)}</span><i style="--w:${Math.max(0, Math.min(100, ((p - 0.3) / 0.4) * 100))}%;--c:${p >= 0.5 ? "var(--good)" : "var(--bad)"}"></i></span>`;

  function brawlerTable(md) {
    const list = md.topBrawlers(20, 3);
    const owners = (id) => (state.squad?.players || []).filter((p) => p.brawlers.some((b) => b.id === id && b.power >= state.minPower)).map((p) => p.name);
    return `<table><thead><tr><th>Brawler</th><th class="num">Win rate</th><th class="num hide-sm">Pick rate</th><th class="num">Games</th></tr></thead><tbody>
      ${list.map((b) => { const o = owners(b.id); return `<tr><td><span class="bcell">${bImg(b.id)}<span>${esc(bName(b.id))}${o.length ? `<span class="owners">${esc(o.join(", "))}</span>` : ""}</span></span></td><td class="num">${wr(b.p)}</td><td class="num hide-sm">${pct(b.pick)}</td><td class="num">${fmt(b.games)}</td></tr>`; }).join("")}
    </tbody></table>`;
  }

  function teamTable(md, field) {
    const list = md.topTeams(field, 12, field === "trios" ? 4 : 6);
    if (!list.length) return `<p class="note" style="margin:10px 0">Not enough games yet to rank ${field} on this map.</p>`;
    return `<table><thead><tr><th>${field === "trios" ? "Trio" : "Pair"}</th><th class="num">Win rate</th><th class="num">Games</th></tr></thead><tbody>
      ${list.map((t) => `<tr><td><span class="team-cell">${t.ids.map(bImg).join("")}<span class="team-names hide-sm">${esc(t.ids.map(bName).join(" · "))}</span></span></td><td class="num">${wr(t.p)}</td><td class="num">${fmt(t.games)}</td></tr>`).join("")}
    </tbody></table>`;
  }

  // ---------- squad ----------
  function squadView() {
    const players = state.squad?.players || [];
    if (!players.length) { view.innerHTML = `<p class="note">No squad yet. Add names and player tags to squad.config.json.</p>`; return; }
    const models = Object.keys(state.meta.maps).map(model);
    const now = Date.now();

    // Best brawlers for a mode: personal fit plus average meta strength over that mode's maps.
    function bestFor(p, mode, n) {
      const ms = models.filter((md) => md.info.mode === mode);
      const w = ms.reduce((s, md) => s + md.info.battles, 0) || 1;
      return p.brawlers
        .filter((b) => b.power >= state.minPower && !(state.excluded[p.tag] || []).includes(b.id))
        .map((b) => {
          const pers = E.personal(p, b.id, { mode, now });
          const L = ms.reduce((s, md) => s + md.brawler(b.id).L * md.info.battles, 0) / w;
          return { id: b.id, pers, s: L + E.PERSONAL_WEIGHT * pers.L };
        })
        .sort((a, b) => b.s - a.s)
        .slice(0, n);
    }

    view.innerHTML = `
      <div class="section-head"><div><span class="eyebrow">${players.length} players · brawlers as of ${esc(shortDate(state.squad.updated))}</span><h2 style="font-size:clamp(48px,9vw,88px)">Squad</h2>
        <p>Best picks lean on the meta for that mode, nudged toward what each of you has been playing and winning with lately, then your highest trophies.</p></div></div>
      <div class="profiles">${players.map((p) => {
        const games = p.games || [];
        const month = games.filter((g) => now - g[0] <= 30 * DAY);
        const mWins = month.reduce((s, g) => s + g[3], 0);
        const byB = {};
        for (const [, id, , won] of month) { const c = (byB[id] ||= [0, 0]); c[0]++; c[1] += won; }
        const mostPlayed = Object.entries(byB).sort((a, b) => b[1][0] - a[1][0]).slice(0, 5);
        const topTrophies = [...p.brawlers].sort((a, b) => (b.highest || 0) - (a.highest || 0)).slice(0, 5);
        const tog = {};
        for (const [, , , won, mates] of games) if (mates?.length) { const k = mates.join(","); const c = (tog[k] ||= [0, 0]); c[0]++; c[1] += won; }
        const together = Object.entries(tog).map(([tags, [g, w]]) => ({ names: tags.split(",").map((t) => players.find((x) => x.tag === t)?.name || t), g, w })).sort((a, b) => b.g - a.g).slice(0, 4);
        return `<article class="card profile">
          <div class="prof-head">${avatar(p)}<div><h2>${esc(p.name)}</h2><span class="num">${esc(p.ign)} · ${esc(p.tag)}</span></div></div>
          <div class="kpis">
            <div class="kpi"><span class="label">Trophies</span><b>${fmt(p.trophies)}</b></div>
            <div class="kpi"><span class="label">Won, 30 days</span><b>${month.length ? pct(mWins / month.length) : "—"}</b></div>
            <div class="kpi"><span class="label">Power 11</span><b>${p.brawlers.filter((b) => b.power >= 11).length}<span class="muted" style="font-size:15px">/${p.brawlers.length}</span></b></div>
          </div>
          ${FOCUS.map((mode) => `<div class="picks"><h3>${modeIcon(mode)}Best in ${esc(modeInfo(mode).name)}</h3><div class="pick-list">${bestFor(p, mode, 5).map((x) => `<div class="pick">${bImg(x.id)}<span>${esc(bName(x.id))}</span><small>${x.pers.recentGames ? record(x.pers) : `#${trophyRank(p, x.id)} trophies`}</small></div>`).join("")}</div></div>`).join("")}
          ${(state.excluded[p.tag] || []).length ? `<p class="muted" style="font-size:13px;margin:0">Left out of suggestions: ${state.excluded[p.tag].map((id) => esc(bName(id))).join(", ")}. Change this under "Don't suggest" on any map.</p>` : ""}
          <div class="two">
            <div class="mini-table"><h4>Most played · 30 days</h4>${mostPlayed.length ? `<table><tbody>${mostPlayed.map(([id, [g, w]]) => `<tr><td><span class="bcell">${bImg(+id)}${esc(bName(+id))}</span></td><td class="num">${w}-${g - w}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No tracked games yet.</p>`}</div>
            <div class="mini-table"><h4>Highest trophies</h4><table><tbody>${topTrophies.map((b) => `<tr><td><span class="bcell">${bImg(b.id)}${esc(bName(b.id))}</span></td><td class="num">${fmt(b.highest || 0)}</td></tr>`).join("")}</tbody></table></div>
          </div>
          ${together.length ? `<div class="mini-table"><h4>Playing together</h4><table><tbody>${together.map((t) => `<tr><td>with ${esc(t.names.join(" + "))}</td><td class="num">${t.w}-${t.g - t.w}</td></tr>`).join("")}</tbody></table></div>` : ""}
        </article>`;
      }).join("")}</div>`;
  }

  // ---------- method ----------
  function methodView() {
    const s = state.meta.sample || {};
    view.innerHTML = `<article class="prose">
      <span class="eyebrow">How the picks are made</span>
      <h1>Method</h1>
      <p>Two things go into every comp: how brawlers do on that map for top players, which counts most, and what each of us has been good on.</p>
      <div class="facts">
        <div><span class="label">Battles, last pull</span><b>${fmt(s.battles || 0)}</b></div>
        <div><span class="label">Top players sampled</span><b>${fmt(s.players || 0)}</b></div>
        <div><span class="label">Top-player side wins</span><b>${s.sampledSideWin?.all ? s.sampledSideWin.all + "%" : "—"}</b></div>
      </div>
      <h2>What you're good on</h2>
      <ul>
        <li>Only brawlers each person owns at the chosen power or higher.</li>
        <li><b>Recent games count most:</b> your record on a brawler and how much you've been playing it. A game three weeks old counts half as much as one today, and games in other modes count half.</li>
        <li><b>Then highest trophies:</b> your best brawler by highest trophies gets a boost, your lowest a penalty.</li>
        <li>Every power level under 11 costs a little.</li>
        <li>All of this together counts at 0.3 times the meta's weight. Our own records come from lower-trophy games, where a main can win 85% or more, so at full weight they buried the meta. These weights are judgment calls; there aren't enough of our games yet to fit them from data.</li>
      </ul>
      <h2>The meta</h2>
      <p>Every Monday the official Brawl Stars API gives the last 25 battles of about ${fmt(s.players || 3000)} top-ranked players. Trophy and Ranked 3v3 games count; 5v5, Showdown, Duels and friendlies don't. Last week's counts stay in at half weight so smaller maps keep a sample.</p>
      <p>Top players win far more than half their games, so whatever they pick would look stronger than it is. That edge is measured each week and taken back out. Win rates are pulled toward each brawler's mode-wide rate until there are enough games, so a 4-0 brawler doesn't top the list. Pair and trio records count only lightly, because they mostly reflect a few pre-made top teams.</p>
      <p>The model was checked by building it from half the top players and predicting games of the other half. After tuning, its percentages matched how often teams actually won.</p>
      <h2>What it can't tell you</h2>
      <ul>
        <li><b>Picks matter less than skill.</b> On players the model hadn't seen, knowing both teams' brawlers raised the share of games called correctly only from 64.3% to 64.8%. A better comp tilts the odds a few points.</li>
        <li>It's top-player data. What wins at the top isn't always what wins at lower trophies.</li>
        <li>Balance changes show up the next Monday.</li>
        <li>The API only shows each player's last 25 games. Squad games are pulled daily, so only a day with more than 25 loses some.</li>
      </ul>
    </article>`;
  }

  // ---------- events ----------
  view.addEventListener("click", (e) => {
    const p = e.target.closest("[data-tag]");
    if (p) {
      const tag = p.dataset.tag;
      if (state.selected.includes(tag)) state.selected = state.selected.filter((t) => t !== tag);
      else { state.selected.push(tag); if (state.selected.length > 4) state.selected.shift(); }
      store.set("selected", state.selected);
      rerender();
      return;
    }
    const pw = e.target.closest("[data-power]");
    if (pw) { state.minPower = +pw.dataset.power; store.set("minPower", state.minPower); rerender(); return; }
    const li = e.target.closest(".combo-list [data-k]");
    if (li) {
      const i = li.closest(".combo").querySelector(COMBO);
      const o = i._items?.[+li.dataset.k];
      if (o) comboPick(i, o, false);
      return;
    }
    // Tapping a brawler in a comp locks it in for that player (or unlocks it). Only with 2+ people on.
    const s = e.target.closest("[data-pick]");
    if (s && selectedPlayers().length > 1) {
      const tag = s.dataset.pick, id = +s.dataset.id;
      if (state.locks[tag] === id) delete state.locks[tag];
      else {
        for (const t of Object.keys(state.locks)) if (state.locks[t] === id) delete state.locks[t];
        state.locks[tag] = id;
      }
      rerender();
      return;
    }
    const un = e.target.closest("[data-unlock]");
    if (un) { const tag = un.dataset.unlock; delete state.locks[tag]; rerender(); view.querySelector(`[data-lock-input="${CSS.escape(tag)}"]`)?.focus(); return; }
    if (e.target.closest("[data-unlock-all]")) { state.locks = {}; rerender(); return; }
    const ub = e.target.closest("[data-unban]");
    if (ub) {
      const tag = ub.dataset.unban;
      state.excluded[tag] = (state.excluded[tag] || []).filter((x) => x !== +ub.dataset.id);
      if (!state.excluded[tag].length) delete state.excluded[tag];
      store.set("excluded", state.excluded);
      rerender();
      view.querySelector(`[data-ban-input="${CSS.escape(tag)}"]`)?.focus();
      return;
    }
    if (e.target.closest("[data-unban-all]")) {
      for (const p of selectedPlayers()) delete state.excluded[p.tag];
      store.set("excluded", state.excluded);
      rerender();
    }
  });
  // Type-to-search boxes in the "Already picked" and "Don't suggest" rows.
  view.addEventListener("focusin", (e) => { const i = e.target.closest(COMBO); if (i) drawCombo(i); });
  view.addEventListener("input", (e) => { const i = e.target.closest(COMBO); if (i) drawCombo(i); });
  view.addEventListener("focusout", (e) => {
    const i = e.target.closest(COMBO);
    // A short delay lets a tap on a suggestion register before the list closes (phones blur first).
    if (i) setTimeout(() => { if (document.activeElement !== i && i.isConnected) closeCombo(i); }, 150);
  });
  view.addEventListener("keydown", (e) => {
    const i = e.target.closest(COMBO);
    if (!i || !i._items) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = i._items.length;
      if (n) drawCombo(i, (i._active + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = i._items[i._active];
      if (o) comboPick(i, o, true);
    } else if (e.key === "Escape") { i.value = ""; closeCombo(i); i.blur(); }
  });
  // On desktop, keep focus in the box while clicking a suggestion; the click handler does the locking.
  view.addEventListener("mousedown", (e) => { if (e.target.closest(".combo-list")) e.preventDefault(); });
  // Picker clicks re-render in place, without the page-enter animation or a jump to the top.
  function rerender() { const y = window.scrollY; route(true); window.scrollTo(0, y); }

  // Brawlify sometimes lacks art for the newest brawlers; swap a broken portrait for its initials.
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || !img.alt) return;
    const ph = document.createElement("span");
    ph.className = "ph";
    ph.title = img.alt;
    ph.textContent = img.alt.slice(0, 2);
    img.replaceWith(ph);
  }, true);

  // ---------- routing ----------
  function route(inPlace) {
    if (!state.meta) return;
    const h = location.hash.replace(/^#\/?/, "");
    let tab = "maps";
    if (!inPlace) { view.style.animation = "none"; void view.offsetWidth; view.style.animation = ""; }
    if (h.startsWith("map/")) mapView(decodeURIComponent(h.slice(4)));
    else if (h === "squad") { tab = "squad"; squadView(); }
    else if (h === "method") { tab = "method"; methodView(); }
    else homeView();
    document.querySelectorAll(".links a").forEach((a) => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  }
  window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });

  async function load() {
    const get = (f) => fetch("data/" + f, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [game, meta, squad, rotation] = await Promise.all([get("game.json"), get("meta.json"), get("squad.json"), get("rotation.json")]);
    if (!meta) { view.innerHTML = `<p class="note">No data yet. The first update hasn't run.</p>`; return; }
    for (const k of Object.keys(meta.maps)) if (/5v5/i.test(meta.maps[k].mode)) delete meta.maps[k];
    Object.assign(state, { game, meta, squad: squad || { players: [] }, rotation: rotation?.slots || meta.rotation || [], totals: E.modeTotals(meta) });
    brawlerById = Object.fromEntries((game?.brawlers || []).map((b) => [b.id, b]));
    const tags = new Set(state.squad.players.map((p) => p.tag));
    state.selected = store.get("selected", []).filter((t) => tags.has(t)).slice(0, 4);
    state.minPower = store.get("minPower", 1);
    state.excluded = store.get("excluded", {});
    state.filter = store.get("filter", "focus");
    document.getElementById("stamp").textContent = `Squad ${state.squad.updated ? shortDate(state.squad.updated) : "—"} · Meta ${shortDate(meta.updated)}`;
    document.getElementById("foot").innerHTML = `<span>Brawl Comps · data from the official Brawl Stars API · art from <a href="https://brawlify.com">Brawlify</a> · not affiliated with Supercell</span><span><a href="https://github.com/andyqueyl/brawl-comps">Source on GitHub</a></span>`;
    route();
  }
  load().catch((e) => { view.innerHTML = `<p class="note">Couldn't load the data: ${esc(e.message)}</p>`; });
})();
