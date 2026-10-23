// Renders the pages (home, one map, ranked, squad, method) from the data files. Routing is by hash.
(function () {
  const E = window.BrawlEngine;
  const view = document.getElementById("view");
  // We mostly play these two; they lead every list and are the default filter.
  const FOCUS = ["brawlBall", "knockout"];
  const state = { game: null, meta: null, squad: null, rotation: null, totals: null, selected: [], minPower: 1, query: "", filter: "focus", metaTab: "brawlers", locks: {}, lockMap: null, excluded: {}, ranked: null, rtotals: null, draft: null };

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
  const mapHref = (m, rk) => (rk ? "#/ranked/" : "#/map/") + encodeURIComponent(mapKey(m));
  const playerIcon = (p) => p.iconImg || (p.icon ? `https://cdn.brawlify.com/profile-icons/regular/${p.icon}.png` : "");
  const avatar = (p) => { const i = playerIcon(p); return i ? `<img src="${esc(i)}" alt="">` : `<span class="ph">${esc(p.name[0])}</span>`; };
  const selectedPlayers = () => (state.squad?.players || []).filter((p) => state.selected.includes(p.tag));
  const liveSlot = (m) => (state.rotation || []).find((r) => r.map === m.map && r.mode === m.mode && apiTime(r.end) > Date.now());
  // rk: the Ranked-only numbers (data/ranked.json) instead of all top-player games.
  const model = (key, rk) => (rk ? E.mapModel(state.ranked, key, state.rtotals) : E.mapModel(state.meta, key, state.totals));
  const modeRank = (mode) => (FOCUS.includes(mode) ? FOCUS.indexOf(mode) : 9);
  const recommend = (md, players, limit, locked, excluded, more) => E.recommend(md, players, { minPower: state.minPower, limit, locked, excluded, now: Date.now(), ...more });
  // Ranked ranks on top players' win rates only (Andy, Oct 23); the regular maps keep the personal nudge.
  const RANKED_PW = 0;
  const pw = () => (state.rk ? RANKED_PW : E.PERSONAL_WEIGHT);

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
    const modesOrdered = [...new Set(maps.map((m) => m.mode))].sort((a, b) => modeRank(a) - modeRank(b) || (state.totals[b]?.battles || 0) - (state.totals[a]?.battles || 0));
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

  function tile(m, rk) {
    const top = model(mapKey(m), rk).topBrawlers(4, 3);
    return `<a class="card tile" href="${mapHref(m, rk)}" style="--mode:${modeColor(m.mode)}">
      <span class="art" style="${artStyle(m)}">${!rk && liveSlot(m) ? '<span class="live">Live</span>' : ""}</span>
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

  function mapView(key, rk) {
    const md = rk ? state.ranked && model(key, true) : model(key);
    const back = rk ? `<a href="#/ranked">Ranked</a>` : `<a href="#/">Maps</a>`;
    if (!md) { view.innerHTML = `<nav class="crumbs">${back}</nav><p class="note">No data for this map yet.</p>`; return; }
    const m = md.info;
    const players = selectedPlayers();
    const best = md.topBrawlers(1, 10)[0];
    // Picks already made in the lobby (and in a Ranked draft, bans and the other team's picks). They belong
    // to one game, so they reset when you open another map.
    state.rk = !!rk;
    const lockKey = (rk ? "ranked:" : "") + key;
    if (state.lockMap !== lockKey) { state.locks = {}; state.draft = newDraft(); state.lockMap = lockKey; }
    // Teammates outside the squad fill whatever slots the selected squad doesn't. Extra ones are kept
    // (selection changes shouldn't lose them) but only the first that fit are used.
    const d = (state.dv = { ...state.draft, allies: state.draft.allies.slice(0, allySlots(players)) });
    const locked = players.map((p) => state.locks[p.tag] ?? null);
    const gone = rk ? draftGone(d) : [];
    const excluded = players.map((p) => [...(state.excluded[p.tag] || []), ...gone]);
    comboOpts = {};

    let comps, recs = [];
    if (!players.length) comps = `<p class="note">Pick who's playing above and this fills with comps from your own brawlers.</p>`;
    else if (players.length > 3) comps = `<p class="note">${players.length} people picked, but it's 3v3. Tap whoever's sitting out.</p>`;
    else {
      // In a Ranked draft the comps and your own picks live in the drafter; this section keeps "Don't suggest".
      if (!rk) recs = recommend(md, players, players.length === 1 ? 8 : 6, locked, excluded);
      comps = rk ? banRow(players, locked, md) : (players.length > 1 ? lockRow(players, locked, md) : "") + banRow(players, locked, md) +
        (recs.length ? `<div class="comps">${recs.map((r, i) => compRow(r, players, i, rk && d.theirs.length ? "vs their picks" : "top players")).join("")}</div>`
          : `<p class="note">${excluded.some((x) => x.length) ? `No brawlers left at power ${state.minPower}+ once the left-out ones are removed.` : `Nobody picked owns a brawler at power ${state.minPower}+.`}</p>`);
    }

    view.innerHTML = `
      <nav class="crumbs">${back}<span>/</span><span>${esc(modeInfo(m.mode).name)}</span></nav>
      <header class="map-head">
        <span class="art" style="${artStyle(m)}"></span>
        <div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${modeTag(m.mode)}${rk ? '<span class="live ranked-tag">Ranked</span>' : liveSlot(m) ? '<span class="live">Live</span>' : ""}</div>
          <h1>${esc(m.map)}</h1>
          <div class="stats">
            <div class="stat"><span class="label">${rk ? "Ranked battles" : "Battles"}</span><b>${fmt(m.battles)}</b></div>
            <div class="stat"><span class="label">Brawlers seen</span><b>${Object.keys(m.brawlers).length}</b></div>
            ${best ? `<div class="stat"><span class="label">Best brawler</span><b>${esc(bName(best.id))}</b></div>` : ""}
          </div>
        </div>
      </header>

      ${rk ? (players.length > 3 ? drafter(md, [], [], `${players.length} people are on, but it's 3v3: tap whoever's sitting out below to get picks for your squad. Until then this works as a drafter for any team.`) : drafter(md, players, locked)) : ""}

      <section class="section">
        <div class="section-head"><div><span class="eyebrow">${rk ? "Who's on" : "Ranked for your squad"}</span><h2>${rk ? "Squad" : "Your comps"}</h2>
          <p>${rk ? "Pick who's playing; the drafter above builds comps from the brawlers you own. Anyone not in the squad is filled in by the drafter as a teammate who can play anything."
            : "Ranked mostly by how each comp does for top players on this map (the %), then nudged toward what each of you is good on (recent games, then highest trophies)."}</p></div></div>
        ${picker(true)}
        <div style="height:12px"></div>
        ${comps}
      </section>

      <section class="section">
        <div class="section-head"><div><span class="eyebrow">${rk ? "Top players' Ranked games" : "Top-player battles"}</span><h2>Meta</h2></div>
          <div class="seg" role="group" aria-label="Meta view" id="metaTabs">${[["brawlers", "Brawlers"], ["trios", "Trios"], ["pairs", "Pairs"]].map(([v, l]) => `<button type="button" data-meta="${v}" aria-pressed="${state.metaTab === v}">${l}</button>`).join("")}</div>
        </div>
        <div class="card panel"><div class="table-wrap" id="metaBody"></div></div>
      </section>`;

    if (rk && !inPlaceRender && matchMedia("(pointer: fine)").matches) view.querySelector('[data-draft-input="bans"]')?.focus({ preventScroll: true });
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
  // In a Ranked draft (dr = { ours, theirs }), the % and order are against what the other team has picked.
  function ranked(p, md, keep, dr) {
    const now = Date.now();
    return p.brawlers.filter(keep).map((b) => {
      const meta = dr ? md.draft([...dr.ours, b.id], dr.theirs) : md.brawler(b.id);
      const pers = E.personal(p, b.id, { mode: md.info.mode, now });
      return { id: b.id, name: bName(b.id), ...nameKeys(bName(b.id)), sub: `${pct(meta.p)} ${dr?.theirs.length ? "vs them" : "here"} · P${b.power}`, p: meta.p, pers, fit: meta.L + pw() * pers.L };
    }).sort((a, b) => b.fit - a.fit);
  }
  function lockRow(players, locked, md, rk) {
    const open = players.filter((_, i) => locked[i] == null);
    const done = players.length - open.length;
    const head = rk ? (!done ? "Lock each of your picks as you make them (type it, or tap one in a comp below)." : !open.length ? "All your picks are in." : `Still to pick: ${open.map((p) => esc(p.name)).join(", ")}.`)
      : !done ? "Someone already picked in the lobby? Type their brawler, or tap one in a comp below."
      : !open.length ? "Everyone's locked in. This is how your comp rates."
      : `Showing the best ${open.length === 1 ? "pick" : "picks"} for ${open.map((p) => esc(p.name)).join(" and ")}.`;
    return `<div class="card locks">
      <div class="locks-head"><span class="label">${rk ? "Your squad's picks" : "Already picked"}</span>${done ? `<button type="button" class="link" data-unlock-all>Clear all</button>` : ""}</div>
      <div class="lock-grid" style="--n:${players.length}">${players.map((p, i) => {
        if (locked[i] != null) {
          const id = locked[i];
          return `<div class="lock on"><span class="who">${esc(p.name)}</span>
            <div class="chosen">${bImg(id)}<b>${esc(bName(id))}</b><button type="button" class="x" data-unlock="${esc(p.tag)}" aria-label="Unlock ${esc(bName(id))} for ${esc(p.name)}">×</button></div></div>`;
        }
        const taken = new Set([...locked.filter((x) => x != null), ...(rk ? draftGone(state.dv) : [])]);
        const dr = rk ? { ours: [...state.dv.allies, ...locked.filter((x) => x != null)], theirs: state.dv.theirs } : null;
        comboOpts["lock:" + p.tag] = ranked(p, md, (b) => !taken.has(b.id), dr);
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

  const COMBO = "[data-lock-input],[data-ban-input],[data-draft-input]";
  const comboKey = (input) => input.dataset.lockInput != null ? "lock:" + input.dataset.lockInput : input.dataset.banInput != null ? "ban:" + input.dataset.banInput : "draft:" + input.dataset.draftInput;
  function comboPick(input, o, fromKeyboard) {
    if (input.dataset.lockInput != null) lockIn(input.dataset.lockInput, o.id, fromKeyboard);
    else if (input.dataset.banInput != null) banIn(input.dataset.banInput, o.id, fromKeyboard);
    else draftIn(input.dataset.draftInput, o.id, fromKeyboard);
  }
  // Matching ignores spaces and punctuation ("8bit" finds 8-Bit, "mrp" Mr. P, "elp" El Primo).
  // Order: name starts with it, then a later word does ("primo"), then it appears anywhere.
  const nameKeys = (name) => ({ key: norm(name), words: String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w, i, a) => a.slice(i).join("")) });
  function comboMatches(key, q) {
    const all = comboOpts[key] || [];
    q = norm(q);
    if (!q) return all.slice(0, 6);
    const rank = (o) => (o.key.startsWith(q) ? 0 : o.words.some((w) => w.startsWith(q)) ? 1 : o.key.includes(q) ? 2 : 3);
    return all.map((o) => [rank(o), o]).filter(([r]) => r < 3).sort((a, b) => a[0] - b[0]).map(([, o]) => o).slice(0, 8);
  }
  function drawCombo(input, active = 0) {
    const list = input.nextElementSibling;
    const q = input.value;
    const items = comboMatches(comboKey(input), q);
    input._items = items;
    input._active = Math.min(active, items.length - 1);
    const gone = comboKey(input).startsWith("draft:");
    list.innerHTML = (!q.trim() && items.length ? `<li class="combo-head" role="presentation">${gone ? "Most picked here" : "Best for this map"}</li>` : "") +
      (items.length ? items.map((o, k) => `<li role="option" id="${input.id}-o${k}" data-k="${k}" aria-selected="${k === input._active}">${bImg(o.id)}<span><b>${esc(o.name)}</b><small>${esc(o.sub)}</small></span></li>`).join("")
        : `<li class="combo-empty" role="presentation">${gone ? "No brawler" : "No brawler they own"} matches “${esc(q.trim())}”</li>`);
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
    // Typing flow: jump straight to the next person who hasn't picked (in a Ranked draft, to whoever's turn it is).
    if (fromKeyboard) (view.querySelector(".draft") ? focusTurn() : view.querySelector("[data-lock-input]")?.focus());
  }
  function banIn(tag, id, fromKeyboard) {
    state.excluded[tag] = [...(state.excluded[tag] || []).filter((x) => x !== id), id];
    store.set("excluded", state.excluded);
    rerender();
    // Stay in the same box so several can be left out in a row.
    if (fromKeyboard) view.querySelector(`[data-ban-input="${CSS.escape(tag)}"]`)?.focus();
  }

  // ---------- ranked ----------
  // Ranked is a draft (bans, then picks in turn) on its own map pool, so it gets its own numbers: top
  // players' Ranked games only, debiased separately (data/ranked.json). Same engine as the other maps.
  const RANK_TIERS = ["Bronze", "Silver", "Gold", "Diamond", "Mythic", "Legendary", "Masters", "Pro"];
  const rankedPool = () => (state.ranked?.pool || []).map((k) => state.ranked.maps[k]).filter(Boolean);

  // Ban suggestions: how much each brawler would cut our chances if the other team took it (against our
  // planned comp, counters included), times how often top players pick it. Our own planned picks are
  // skipped. A rule of thumb for "most likely to beat us if left open", not tested like the comp model.
  function banCandidates(md, plan, theirs, skip, n) {
    const base = md.draft(plan, theirs).L;
    return md.topBrawlers(500, 10)
      .filter((b) => !skip.has(b.id) && b.pick >= 0.02)
      .map((b) => ({ ...b, threat: b.pick * (base - md.draft(plan, [...theirs, b.id]).L) }))
      .filter((b) => b.threat > 0)
      .sort((a, b) => b.threat - a.threat)
      .slice(0, n);
  }

  // ---------- ranked drafter ----------
  // Ranked draft: each player bans one, then picks go 1-2-2-1 starting with whoever has first pick.
  const ORDER = { us: ["us", "them", "them", "us", "us", "them"], them: ["them", "us", "us", "them", "them", "us"] };
  const LIMITS = { bans: 6, theirs: 3, allies: 3 };
  const newDraft = () => ({ first: "us", bans: [], theirs: [], allies: [] });
  // allies = picks by teammates outside the squad (solo queue).
  const draftGone = (d) => [...d.bans, ...d.theirs, ...d.allies];
  const allySlots = (players) => 3 - (players.length > 3 ? 0 : players.length);

  function draftIn(field, id, fromKeyboard) {
    const d = state.draft;
    for (const f of ["bans", "theirs", "allies"]) d[f] = d[f].filter((x) => x !== id);
    for (const t of Object.keys(state.locks)) if (state.locks[t] === id) delete state.locks[t];
    d[field] = [...d[field], id].slice(-LIMITS[field]);
    rerender();
    if (fromKeyboard) focusTurn(field);
  }

  // Typing flow in a draft: stay in the bans box until all six are in, then follow the pick order.
  function focusTurn(field) {
    const box = (f) => view.querySelector(`[data-draft-input="${f}"]`);
    if (field === "bans" && box("bans")) return box("bans").focus();
    const side = view.querySelector(".steps .now")?.classList.contains("them") ? "them" : "us";
    const target = side === "them" ? box("theirs") : view.querySelector(".draft [data-lock-input]") || box("allies");
    (target || box("bans"))?.focus();
  }

  // Which of the six picks are made, and whose turn it is. Picks are matched to the order by count, so
  // entering them a little out of order still works.
  function draftSteps(d, ours) {
    let u = ours, t = d.theirs.length;
    const steps = ORDER[d.first].map((side) => ({ side, done: side === "us" ? u-- > 0 : t-- > 0 }));
    const at = steps.findIndex((x) => !x.done);
    let n = 0;
    if (at >= 0) while (steps[at + n] && steps[at + n].side === steps[at].side && !steps[at + n].done) n++;
    return { steps, at, side: at >= 0 ? steps[at].side : null, n };
  }

  function draftBox(field, label, d, max) {
    const ids = d[field];
    return `<div class="lock draft-box"><div class="draft-label"><span class="who">${label}</span><span class="who">${ids.length}/${max}</span></div>
      ${ids.length ? `<div class="ban-chips${field === "bans" ? "" : " picked"}">${ids.map((id) => `<span class="ban-chip">${bImg(id)}<b>${esc(bName(id))}</b><button type="button" class="x" data-undraft="${field}" data-id="${id}" aria-label="Remove ${esc(bName(id))}">×</button></span>`).join("")}</div>` : ""}
      ${ids.length < max ? `<div class="combo"><input id="dr-${field}" data-draft-input="${field}" type="text" placeholder="Type a brawler…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"
        role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="dr-${field}-list" aria-label="${label}"><ul class="combo-list" id="dr-${field}-list" role="listbox" hidden></ul></div>` : ""}
    </div>`;
  }

  function drafter(md, players, locked, warn) {
    const d = state.dv;
    const squadPicks = players.length <= 3 ? locked.filter((x) => x != null) : [];
    const ours = [...d.allies, ...squadPicks];
    const gone = new Set([...draftGone(d), ...squadPicks]);
    const turn = draftSteps(d, ours.length);
    const allyMax = allySlots(players);

    // Every brawler for the draft search boxes, most picked here first.
    const all = Object.keys(brawlerById).map(Number).filter((id) => !gone.has(id)).map((id) => {
      const b = md.brawler(id);
      return { id, name: bName(id), ...nameKeys(bName(id)), sub: `${pct(b.p)} here · ${pct(b.pick)} picked`, pick: b.pick };
    }).sort((a, b) => b.pick - a.pick);
    comboOpts["draft:bans"] = comboOpts["draft:theirs"] = comboOpts["draft:allies"] = all;

    // Best still open: on our turn, what adds most to our side; on theirs, what would hurt us most.
    // The % is our chance with that pick made (unknown slots count as average).
    const base = md.draft(ours, d.theirs).L;
    const open = all.filter((o) => md.brawler(o.id).games >= 10).map((o) => {
      const after = turn.side === "them" ? md.draft(ours, [...d.theirs, o.id]) : md.draft([...ours, o.id], d.theirs);
      return { ...o, gain: turn.side === "them" ? base - after.L : after.L - base, p: after.p };
    }).sort((a, b) => b.gain - a.gain).slice(0, 5);

    // The team we're drafting for: the selected squad, plus a stand-in for each slot a teammate outside the
    // squad will fill (they could play anything), so every suggestion is a full three-brawler comp. Comps
    // are ranked on top players' Ranked win rates against what they've picked (pair/trio synergy and
    // counters included); no comp repeats, and nobody gets the same brawler in more than two of them.
    const free = Math.max(0, 3 - players.length - d.allies.length);
    const anyone = Object.keys(brawlerById).map((id) => ({ id: +id, power: 11, highest: 0 }));
    const team = [...players, ...Array.from({ length: free }, (_, k) => ({ name: players.length || d.allies.length ? `Teammate ${k + 1}` : `Pick ${k + 1}`, tag: "", brawlers: anyone, games: [] }))];
    const draftOpts = {
      minPower: state.minPower, now: Date.now(), enemies: d.theirs, allies: d.allies, personalWeight: RANKED_PW,
      locked: team.map((_, i) => locked[i] ?? null),
      excluded: team.map((p) => [...(p.tag ? state.excluded[p.tag] || [] : []), ...draftGone(d)]),
    };
    const comps = team.length ? E.recommend(md, team, { ...draftOpts, limit: 3 }) : [];
    // On our turn, each open squad member's 8 best options, each scored by the best comp it fits into.
    const options = turn.side === "us" ? players.map((p, j) => (locked[j] != null ? null : { p, opts: E.nextPicks(md, team, j, { ...draftOpts, limit: 8 }) })).filter(Boolean) : [];

    let status;
    if (turn.at < 0) status = `<b>Draft done.</b> Your chance against their comp: <b>${pct(md.draft(ours, d.theirs).p)}</b>.`;
    else if (turn.side === "us") status = `<b>Your turn: ${turn.n} pick${turn.n > 1 ? "s" : ""}.</b> Best comps from here, by top players' win rates against what they've picked, then 8 options for each of you. Tap any brawler to lock it in.`;
    else status = `<b>Their turn: ${turn.n} pick${turn.n > 1 ? "s" : ""}.</b> Enter them as they lock in. What would hurt you most (your chance if they take it):`;
    // Bans are judged against the comp we'd most likely end up with (the top suggestion), or any average team.
    const plan = [...d.allies, ...(comps[0]?.picks.map((x) => x.id) || squadPicks)];
    // Banned ones stay in the grid (greyed) so a mistaken tap can be undone.
    const ban = banCandidates(md, plan, d.theirs, new Set([...d.theirs, ...d.allies, ...squadPicks, ...plan]), 8 + d.bans.length);
    // Flag a ban candidate that's also one of our own best picks: banning it hurts us too.
    const oursBest = {};
    for (const p of players.slice(0, 3)) for (const o of ranked(p, md, (b) => b.power >= state.minPower && !(state.excluded[p.tag] || []).includes(b.id)).slice(0, 3)) (oursBest[o.id] ||= []).push(p.name);

    const optChip = (id, p) => `<button type="button" class="next-opt" data-next="${id}" data-side="them">${bImg(id)}<span><b>${esc(bName(id))}</b><small>${pct(p)}</small></span></button>`;
    // One suggested comp: teammates' picks so far, then each slot (locked, or tap to lock / count it).
    const rec = (pers) => (pers?.recentGames ? `${pers.recentWins}-${pers.recentGames - pers.recentWins} · 30d` : "");
    const slot = (inner, cls = "") => `<span class="dslot${cls}">${inner}</span>`;
    const compLine = (r, i) => `<div class="dcomp${i === 0 ? " top" : ""}"><span class="rank">${i + 1}</span><div class="dslots">
      ${d.allies.map((id) => slot(`${bImg(id)}<span><small>Teammate</small><b>${esc(bName(id))}</b></span>`, " locked")).join("")}
      ${r.picks.map((c, k) => c.locked ? slot(`${bImg(c.id)}<span><small>${esc(team[k].name)}</small><b>${esc(bName(c.id))}</b></span>`, " locked")
        : `<button type="button" class="dslot" data-next="${c.id}" data-side="us" data-for="${esc(team[k].tag)}" title="Lock ${esc(bName(c.id))} for ${esc(team[k].name)}">${bImg(c.id)}<span><small>${esc(team[k].name)}</small><b>${esc(bName(c.id))}</b>${team[k].tag && rec(c.pers) ? `<small>${esc(rec(c.pers))}</small>` : ""}</span></button>`).join("")}
      </div><span class="dpct"><b>${pct(r.comp.p)}</b><small>${d.theirs.length ? "vs their picks" : "top players"}</small></span></div>`;
    return `<section class="section">
      <div class="section-head"><div><span class="eyebrow">Ranked draft</span><h2>Drafter</h2>
        <p>Enter the bans and each pick as the draft happens. It tracks whose turn it is and gives the best next pick against what they've taken so far.</p></div>
        <div class="draft-ctl"><span class="label">First pick</span><div class="seg" role="group" aria-label="Who picks first">${[["us", "Us"], ["them", "Them"]].map(([v, l]) => `<button type="button" data-first="${v}" aria-pressed="${d.first === v}">${l}</button>`).join("")}</div>
          ${draftGone(d).length || squadPicks.length ? `<button type="button" class="link" data-draft-reset>New draft</button>` : ""}</div></div>
      <div class="card draft">
        ${warn ? `<p class="note" style="margin:0">${esc(warn)}</p>` : ""}
        <ol class="steps" aria-label="Pick order">${turn.steps.map((x, i) => `<li class="${x.side}${x.done ? " done" : ""}${i === turn.at ? " now" : ""}"><span>${i + 1}</span>${x.side === "us" ? "You" : "Them"}</li>`).join("")}</ol>
        <div class="draft-grid${allyMax ? "" : " two-col"}">
          ${draftBox("bans", "Bans (both teams)", d, LIMITS.bans)}
          ${draftBox("theirs", "Their picks", d, LIMITS.theirs)}
          ${allyMax ? draftBox("allies", players.length ? "Teammates' picks (not in squad)" : "Your team's picks", d, allyMax) : ""}
        </div>
        <p class="draft-status">${status}</p>
        ${turn.at >= 0 ? `<div class="next">${turn.side === "us"
          ? (comps.map(compLine).join("") || `<p class="muted">No comps left with what you own at power ${state.minPower}+.</p>`) +
            (options.length ? `<span class="label next-label">8 options each · % is the best comp it fits into</span>` + options.map((f) => `<div class="next-who"><span class="who">${esc(f.p.name)}</span><div class="next-opts eight">${f.opts.map((o, k) => `<button type="button" class="next-opt" data-next="${o.id}" data-side="us" data-for="${esc(f.p.tag)}" title="Lock ${esc(bName(o.id))} for ${esc(f.p.name)}">${bImg(o.id)}<span><b>${esc(bName(o.id))}</b><small>${pct(o.comp.p)} · #${k + 1}</small>${o.mates.length ? `<small>w/ ${esc(o.mates.map((m) => bName(m.id)).join(" + "))}</small>` : ""}</span></button>`).join("") || `<span class="muted">Nothing left they own</span>`}</div></div>`).join("") : "")
          : `<div class="next-opts">${open.map((o) => optChip(o.id, o.p)).join("")}</div>`}</div>` : ""}
        ${players.length && players.length <= 3 ? lockRow(players, locked, md, true) : ""}
      </div>
      <div class="section-head" style="margin:22px 0 10px"><div><span class="eyebrow">Ban calculator</span><h3 class="sub-h">Best bans${plan.length ? ` against ${esc(plan.map(bName).join(" + "))}` : ""}</h3>
        <p>How much each would hurt ${plan.length ? "that comp (your top suggestion)" : "an average team"} if the other team got it, counters included, weighted by how often top players pick it. Your own planned picks are left off. Tap one to mark it banned.</p></div></div>
      <div class="ban-grid">${ban.map((b) => `<button type="button" class="card ban-pick" data-ban-toggle="${b.id}" aria-pressed="${d.bans.includes(b.id)}">
        ${bImg(b.id)}<span><b>${esc(bName(b.id))}</b><small>${pct(b.p)} · ${pct(b.pick)} picked</small>${oursBest[b.id] ? `<small class="ours">Also good for ${esc(oursBest[b.id].join(", "))}</small>` : ""}</span></button>`).join("")}</div>
    </section>`;
  }

  function rankCard(p, now) {
    const r = p.ranked;
    // Only games logged since Oct 22, 2026 carry the Ranked flag.
    const games = (p.games || []).filter((g) => g[5] === 1 && now - g[0] <= 30 * DAY);
    const w = games.reduce((s, g) => s + g[3], 0);
    const fact = (label, value) => `<div><dt class="label">${label}</dt><dd>${value}</dd></div>`;
    return `<article class="card rank-card">
      <div class="prof-head">${avatar(p)}<div><h3>${esc(p.name)}</h3><span class="num">${r?.elo != null ? fmt(r.elo) + " elo" : "No Ranked games this season"}</span></div></div>
      <div class="rank-now">${esc(r?.rank || "Unranked")}</div>
      <dl class="rank-facts">
        ${fact("Season best", r?.seasonBest ? esc(r.seasonBest) : "—")}
        ${fact("All-time best", r?.allTimeBest ? esc(r.allTimeBest) : "—")}
        ${fact("Ranked, 30d", games.length ? `${w}-${games.length - w}` : "—")}
      </dl>
    </article>`;
  }

  function rankedView() {
    if (!state.ranked) { view.innerHTML = `<p class="note">No Ranked data yet. It arrives with the next Monday update.</p>`; return; }
    const players = state.squad?.players || [];
    const maps = rankedPool();
    const s = state.ranked.sample || {};
    const tiers = RANK_TIERS.filter((t) => s.tiers?.[t]).map((t) => [t, s.tiers[t]]);
    const tierTotal = tiers.reduce((a, [, n]) => a + n, 0);
    const modes = [...new Set(maps.map((m) => m.mode))].sort((a, b) => modeRank(a) - modeRank(b));
    const now = Date.now();
    view.innerHTML = `
      <div class="section-head"><div><span class="eyebrow">Draft with bans · ${maps.length} maps in the pool · as of ${esc(shortDate(state.ranked.updated))}</span><h2 style="font-size:clamp(48px,9vw,88px)">Ranked</h2>
        <p>Pick who's on, type the map and press Enter. The drafter then suggests bans and your next pick as you type in what gets banned and picked. Numbers come only from top players' Ranked games (${fmt(s.battles || 0)} last pull), not trophy games.</p></div></div>
      ${picker(true)}
      <div class="filters" style="margin-top:14px"><input class="search" id="rq" type="search" placeholder="Type the map, then Enter" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Find a Ranked map"></div>
      <div id="rgroups"></div>

      <section class="section">
        <div class="section-head"><div><span class="eyebrow">This season</span><h2>Your ranks</h2></div></div>
      ${players.length ? `<div class="ranks">${players.map((p) => rankCard(p, now)).join("")}</div>
      <p class="muted ranks-note">Ranks are from the official API as of ${esc(shortDate(state.squad.updated))}. Ranked records count games since Oct 22, when the site started telling Ranked games apart.</p>` : ""}
      ${tierTotal ? `<div class="tier-bar" role="img" aria-label="Ranks the sampled Ranked games were played at">${tiers.map(([t, n]) => `<span style="--w:${(n / tierTotal) * 100}%" title="${esc(t)} ${pct(n / tierTotal)}">${n / tierTotal >= 0.04 ? `<b>${esc(t)}</b> ${Math.round((n / tierTotal) * 100)}%` : ""}</span>`).join("")}</div>
      <p class="muted ranks-note">The ranks the sampled Ranked games were played at (every player in them). It's top <i>trophy</i> players' games, so mostly high-rank but not a Masters or Pro meta.</p>` : ""}
      </section>`;

    const groups = document.getElementById("rgroups");
    const input = document.getElementById("rq");
    let shown = maps;
    function draw() {
      const qn = norm(input.value);
      shown = maps.filter((m) => !qn || norm(m.map).includes(qn) || nameKeys(m.map).words.some((w) => w.startsWith(qn)))
        .sort((a, b) => (qn ? norm(b.map).startsWith(qn) - norm(a.map).startsWith(qn) : 0) || modeRank(a.mode) - modeRank(b.mode) || b.battles - a.battles);
      if (!maps.length) { groups.innerHTML = `<p class="note">No Ranked maps in the last pull.</p>`; return; }
      if (!shown.length) { groups.innerHTML = `<p class="note">No Ranked map matches “${esc(input.value.trim())}”.</p>`; return; }
      // While typing, one flat list with the best match first (Enter opens it); otherwise grouped by mode.
      groups.innerHTML = qn ? `<ul class="tiles">${shown.map((m, i) => `<li${i === 0 ? ' class="first"' : ""}>${tile(m, true)}</li>`).join("")}</ul>`
        : modes.map((mode) => {
          const list = shown.filter((m) => m.mode === mode);
          return list.length ? `<div class="group"><div class="group-head">${modeIcon(mode)}<h3>${esc(modeInfo(mode).name)}</h3><span class="count">${list.length}</span></div>
            <ul class="tiles">${list.map((m) => `<li>${tile(m, true)}</li>`).join("")}</ul></div>` : "";
        }).join("");
    }
    draw();
    input.addEventListener("input", draw);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && shown.length && input.value.trim()) location.hash = mapHref(shown[0], true); });
    // On a laptop, start typing the map right away (no keyboard popping up on phones).
    if (matchMedia("(pointer: fine)").matches) input.focus();
  }

  function compRow(r, players, i, cap = "top players") {
    const seen = r.comp.trio ? ` · ${fmt(r.comp.trio.games)} games seen` : "";
    // With two or more people on, each brawler is a button that locks it in for that person.
    const slot = (p, j) => players.length === 1 ? `<div class="slot">${bImg(p.id)}<div><div class="who">${esc(players[j].name)}</div><div class="bn">${esc(bName(p.id))}</div><div class="form">${esc(form(p.pers, players[j], p.id))}</div></div></div>` : `<button type="button" class="slot${p.locked ? " locked" : ""}" data-pick="${esc(players[j].tag)}" data-id="${p.id}" title="${p.locked ? "Unlock" : "Lock in"} ${esc(bName(p.id))} for ${esc(players[j].name)}">${bImg(p.id)}<div><div class="who">${esc(players[j].name)}${p.locked ? ' · <span class="picked">Picked</span>' : ""}</div><div class="bn">${esc(bName(p.id))}</div><div class="form">${esc(form(p.pers, players[j], p.id))}</div></div></button>`;
    return `<article class="card comp${i === 0 ? " top" : ""}">
      <span class="rank">${String(i + 1).padStart(2, "0")}</span>
      <div class="slots" style="--n:${players.length}">${r.picks.map(slot).join("")}</div>
      <div class="score">${i === 0 ? '<span class="top-badge">Top pick</span>' : ""}<div class="pct-big">${pct(r.comp.p)}</div><div class="pct-cap">${cap}${seen}</div></div>
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
    const models = Object.keys(state.meta.maps).map((k) => model(k));
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
      <p>Two things go into every comp on the regular maps: how brawlers do on that map for top players, which counts most, and what each of us has been good on. Ranked uses top players' numbers only (see Ranked below).</p>
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
        <li>The blend is 70% top players' win rate, 30% what you're good on. Because your records swing much more than top-player win rates do (a main can be 56-21), that 30% still decides most picks: nearly every top pick is someone's main. These weights are judgment calls; there aren't enough of our games yet to fit them from data.</li>
        <li><b>Not in Ranked:</b> the Ranked drafter ranks on top players' win rates only. Your own stats just decide which brawlers you own; your recent record is shown for reference.</li>
      </ul>
      <h2>The meta</h2>
      <p>Every Monday the official Brawl Stars API gives the last 25 battles of about ${fmt(s.players || 20000)} top-ranked players (the top 200 in every country with a leaderboard). Trophy and Ranked 3v3 games count; 5v5, Showdown, Duels and friendlies don't. Last week's counts stay in at half weight so smaller maps keep a sample.</p>
      <p>Top players win far more than half their games, so whatever they pick would look stronger than it is. That edge is measured each week and taken back out. Win rates are pulled toward each brawler's mode-wide rate until there are enough games, so a 4-0 brawler doesn't top the list. Pair and trio records count only lightly, because they mostly reflect a few pre-made top teams.</p>
      <p>The model was checked by building it from half the top players and predicting games of the other half. After tuning, its percentages matched how often teams actually won.</p>
      <h2>Ranked</h2>
      <p>The Ranked page uses only top players' Ranked games${state.ranked?.sample?.battles ? ` (${fmt(state.ranked.sample.battles)} last pull, about ${fmt(state.ranked.sample.battles / Math.max(1, (state.ranked.pool || []).length))} per map)` : ""}, debiased on their own the same way. The players sampled are top <i>trophy</i> players, so their Ranked games are spread across ranks: the bar on the Ranked page shows the split (in Oct 2026 mostly Mythic, Legendary and Diamond, almost no Masters or Pro). What wins there may not be what wins at Silver.</p>
      <p><b>The drafter</b> follows the pick order (1-2-2-1 from whoever picks first). As you enter bans and picks, everything banned or taken is removed and it builds the top 3 full comps from here, plus 8 options for each of you (each scored by the best comp it fits into): three brawlers that work together (pair and trio records from top players' Ranked games), against what the other team has picked so far, from brawlers each of you owns. No comp repeats and nobody is on the same brawler in more than two, so each person sees real alternatives. Teammates outside the squad are filled in as players who can take anything. In Ranked your own records don't change the order; they're shown for reference. On their turn it shows what would hurt you most.</p>
      <p><b>Counters</b> (how one brawler does against another) are measured per mode from the Ranked games. Tested on players held out of the data, they barely helped: knowing the counters improved predictions by a hair and didn't change the share of games called right (61.2% either way), and at full strength they made predictions worse. So they count at a quarter weight. Don't expect magic counter-picks; the drafter mostly helps by tracking what's gone and picking the strongest comp that's left.</p>
      <p>Ban suggestions: how much each brawler would cut your chances if the other team got it (against the comp you'd most likely end up with), times how often top players pick it. That's a rule of thumb, not tested the way the comp model was.</p>
      <h2>What it can't tell you</h2>
      <ul>
        <li><b>Picks matter less than skill.</b> On players the model hadn't seen, knowing both teams' brawlers raised the share of games called correctly only from 66.0% to 66.6% (Oct 2026, about 146,000 held-out games). A better comp tilts the odds a few points.</li>
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
    const bt = e.target.closest("[data-ban-toggle]");
    if (bt) {
      const id = +bt.dataset.banToggle;
      if (state.draft.bans.includes(id)) { state.draft.bans = state.draft.bans.filter((x) => x !== id); rerender(); } else draftIn("bans", id, false);
      return;
    }
    const ud = e.target.closest("[data-undraft]");
    if (ud) { const f = ud.dataset.undraft; state.draft[f] = state.draft[f].filter((x) => x !== +ud.dataset.id); rerender(); view.querySelector(`[data-draft-input="${f}"]`)?.focus(); return; }
    const fp = e.target.closest("[data-first]");
    if (fp) { state.draft.first = fp.dataset.first; rerender(); return; }
    if (e.target.closest("[data-draft-reset]")) { state.draft = newDraft(); state.locks = {}; rerender(); return; }
    // A tapped suggestion: their pick on their turn; on ours, that slot's person or a teammate's pick.
    const nx = e.target.closest("[data-next]");
    if (nx) {
      const id = +nx.dataset.next;
      if (nx.dataset.side === "them") draftIn("theirs", id, false);
      // A squad member's slot locks it for them; a stand-in slot counts as a teammate's pick.
      else if (nx.dataset.for) lockIn(nx.dataset.for, id, false);
      else draftIn("allies", id, false);
      return;
    }
    if (e.target.closest("[data-unban-all]")) {
      for (const p of selectedPlayers()) delete state.excluded[p.tag];
      store.set("excluded", state.excluded);
      rerender();
    }
  });
  // Type-to-search boxes in the "Already picked" and "Don't suggest" rows and the Ranked drafter.
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
      // Draft boxes list the most-picked brawlers before you type; Enter there needs a typed name.
      if (i.dataset.draftInput != null && !i.value.trim()) return;
      const o = i._items[i._active];
      if (o) comboPick(i, o, true);
    } else if (e.key === "Escape") { i.value = ""; closeCombo(i); i.blur(); }
  });
  // On desktop, keep focus in the box while clicking a suggestion; the click handler does the locking.
  view.addEventListener("mousedown", (e) => { if (e.target.closest(".combo-list")) e.preventDefault(); });
  // Picker clicks re-render in place, without the page-enter animation or a jump to the top.
  let inPlaceRender = false;
  function rerender() { const y = window.scrollY; inPlaceRender = true; route(true); inPlaceRender = false; window.scrollTo(0, y); }

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
    else if (h.startsWith("ranked/")) { tab = "ranked"; mapView(decodeURIComponent(h.slice(7)), true); }
    else if (h === "ranked") { tab = "ranked"; rankedView(); }
    else if (h === "squad") { tab = "squad"; squadView(); }
    else if (h === "method") { tab = "method"; methodView(); }
    else homeView();
    document.querySelectorAll(".links a").forEach((a) => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  }
  window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });

  async function load() {
    const get = (f) => fetch("data/" + f, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [game, meta, squad, rotation, ranked] = await Promise.all([get("game.json"), get("meta.json"), get("squad.json"), get("rotation.json"), get("ranked.json")]);
    if (!meta) { view.innerHTML = `<p class="note">No data yet. The first update hasn't run.</p>`; return; }
    for (const k of Object.keys(meta.maps)) if (/5v5/i.test(meta.maps[k].mode)) delete meta.maps[k];
    Object.assign(state, { game, meta, squad: squad || { players: [] }, rotation: rotation?.slots || meta.rotation || [], totals: E.modeTotals(meta), ranked, rtotals: ranked ? E.modeTotals(ranked) : null });
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
