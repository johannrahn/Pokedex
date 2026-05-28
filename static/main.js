/**
 * Pokédex — main.js
 * Handles: Load More, Type Filter, Ability Panel, Favorites, Ripple, Stat Bars
 */

// ── Constants ────────────────────────────────────────────────
const FAV_KEY = "pokedex_favorites";
const SEEN_KEY = "pokedex_seen";
const PAGE_SIZE = 24;

// ── Favorites ────────────────────────────────────────────────
function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); }
  catch { return []; }
}

function saveFavorites(favs) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
}

function isFavorite(id) {
  return getFavorites().includes(String(id));
}

function toggleFavorite(id) {
  id = String(id);
  const favs = getFavorites();
  const idx = favs.indexOf(id);
  if (idx === -1) favs.push(id);
  else favs.splice(idx, 1);
  saveFavorites(favs);
  return idx === -1;  // true = now a fav
}

function initFavoriteButtons() {
  document.querySelectorAll("[data-fav-id]").forEach(btn => {
    const id = btn.dataset.favId;
    if (isFavorite(id)) {
      btn.classList.add("is-fav");
      btn.title = "Quitar de favoritos";
      if (btn.dataset.favLabel != null) btn.querySelector(".fav-label").textContent = "En favoritos";
    }
    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      const added = toggleFavorite(id);
      btn.classList.toggle("is-fav", added);
      btn.title = added ? "Quitar de favoritos" : "Agregar a favoritos";
      if (btn.querySelector(".fav-label")) {
        btn.querySelector(".fav-label").textContent = added ? "En favoritos" : "Favorito";
      }
      btn.style.transform = "scale(1.3)";
      setTimeout(() => btn.style.transform = "", 200);
    });
  });
}

// ── Seen Counter ─────────────────────────────────────────────
function getSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); }
  catch { return new Set(); }
}

function markSeen(id) {
  const seen = getSeen();
  seen.add(String(id));
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
}

function updateSeenCounter() {
  const size = getSeen().size;
  const els = [document.getElementById("seen-counter"), document.getElementById("hud-seen-count")];
  els.forEach(el => {
    if (el) el.textContent = size;
  });
}

function initSeenTracking() {
  // Mark all currently visible cards as "seen"
  document.querySelectorAll("[data-poke-id]").forEach(el => markSeen(el.dataset.pokeId));
  updateSeenCounter();
}

// ── Ripple Effect ─────────────────────────────────────────────
function addRipple(el, event) {
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = event.clientX - rect.left - size / 2;
  const y = event.clientY - rect.top - size / 2;
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  ripple.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
  el.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove());
}

function initRipple() {
  document.querySelectorAll(".ripple-container").forEach(el => {
    el.addEventListener("click", e => addRipple(el, e));
  });
}

// ── Stat Bars (IntersectionObserver) ─────────────────────────
function initStatBars() {
  const fills = document.querySelectorAll(".stat-fill[data-value]");
  if (!fills.length) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const val = parseFloat(el.dataset.value) || 0;
        el.style.width = val + "%";
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.2 });

  fills.forEach(el => observer.observe(el));
}

// ── Load More (Index page) ────────────────────────────────────
let loadMoreOffset = 0;
let loadMoreType = "";
let loadMoreHasNext = true;
let loadMoreBusy = false;

function getGenLabel(id) {
  if (id <= 151) return "GEN I";
  if (id <= 251) return "GEN II";
  return "GEN III";
}

function buildCard(poke) {
  const id = String(poke.id || "");
  const name = poke.name || "";
  const sprite = poke.sprite_url || "";
  const padId = id.padStart(3, "0");
  const isFav = isFavorite(id);
  const genLabel = getGenLabel(parseInt(id));
  const types = (poke.types || []);
  const typeBadges = types.map(t =>
    `<span class="card-type-mini" style="background:${t.color}">${t.name}</span>`
  ).join("");

  return `
    <a href="/pokemon/${name}" class="pokemon-card ripple-container scanner-card" data-poke-id="${id}" draggable="true" ondragstart="dragStart(event)">
      <div class="scanner-beam"></div>
      <div class="scanner-target-reticle"></div>
      <div class="card-gen-badge">${genLabel}</div>
      <button class="card-fav-btn ${isFav ? "is-fav" : ""}" data-fav-id="${id}" title="Favorito">★</button>
      <div class="card-img-container">
        <img class="pokemon-sprite" src="${sprite}" alt="${name}"
          loading="lazy"
          onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'">
      </div>
      <div class="card-body">
        <div class="pokemon-id">#${padId}</div>
        <div class="pokemon-name">${name}</div>
      </div>
      ${typeBadges ? `<div class="card-type-strip">${typeBadges}</div>` : ""}
    </a>`;
}

function buildSkeletons(n) {
  return Array.from({ length: n }, () => `
    <div class="skeleton-card">
      <div class="skeleton-block skeleton-img"></div>
      <div class="skeleton-block skeleton-id"></div>
      <div class="skeleton-block skeleton-name"></div>
    </div>`).join("");
}

async function loadMore() {
  if (loadMoreBusy || !loadMoreHasNext) return;
  loadMoreBusy = true;

  const btn = document.getElementById("btn-load-more");
  const grid = document.getElementById("pokemon-grid");
  if (!btn || !grid) { loadMoreBusy = false; return; }

  btn.disabled = true;
  btn.classList.add("loading");

  // Insert skeletons
  const skeletonIds = [];
  for (let i = 0; i < PAGE_SIZE; i++) {
    const div = document.createElement("div");
    div.innerHTML = buildSkeletons(1);
    const child = div.firstElementChild;
    const sid = "sk-" + Date.now() + "-" + i;
    child.id = sid;
    skeletonIds.push(sid);
    grid.appendChild(child);
  }

  try {
    const typeParam = loadMoreType ? `&type=${encodeURIComponent(loadMoreType)}` : "";
    const url = `/api/pokemon-list?offset=${loadMoreOffset}&limit=${PAGE_SIZE}${typeParam}`;
    const res = await fetch(url);
    const data = await res.json();

    // Remove skeletons
    skeletonIds.forEach(sid => document.getElementById(sid)?.remove());

    if (data.error) throw new Error(data.error);

    // Append real cards
    data.pokemon.forEach(poke => {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = buildCard(poke);
      const card = wrapper.firstElementChild;
      grid.appendChild(card);
      markSeen(poke.id);
    });

    updateSeenCounter();
    loadMoreOffset += data.pokemon.length;
    loadMoreHasNext = data.has_next;

    // Re-init favorites, ripple, and drag for new cards
    initFavoriteButtons();
    initRipple();
    grid.querySelectorAll('.pokemon-card').forEach(c => {
      if (!c.hasAttribute('draggable')) makeDraggable(c);
    });

    if (!loadMoreHasNext) {
      btn.textContent = "¡Has visto todos!";
      btn.disabled = true;
    }

  } catch (err) {
    // Remove skeletons on error
    skeletonIds.forEach(sid => document.getElementById(sid)?.remove());
    console.error("Load More error:", err);
  }

  btn.classList.remove("loading");
  loadMoreBusy = false;
  if (loadMoreHasNext) btn.disabled = false;
}

function initLoadMore() {
  const btn = document.getElementById("btn-load-more");
  if (!btn) return;

  // Read initial state from data attrs set by the template
  loadMoreOffset = parseInt(btn.dataset.offset || "0", 10);
  loadMoreType = btn.dataset.type || "";
  loadMoreHasNext = btn.dataset.hasNext === "true";

  if (!loadMoreHasNext) {
    btn.disabled = true;
    btn.textContent = "¡Has visto todos!";
    return;
  }

  btn.addEventListener("click", loadMore);
}

// ── Ability Panel (Detail page) ───────────────────────────────
let activePanelAbility = null;

async function openAbilityPanel(abilityName) {
  const container = document.getElementById("ability-panel-container");
  if (!container) return;

  // Toggle off if same ability clicked again
  if (activePanelAbility === abilityName) {
    container.innerHTML = "";
    activePanelAbility = null;
    return;
  }

  activePanelAbility = abilityName;

  // Show loading state
  container.innerHTML = `
    <div class="ability-panel">
      <div class="ability-panel-title">Cargando ${abilityName}…</div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        ${buildSkeletons(6)}
      </div>
    </div>`;

  try {
    const slug = abilityName.toLowerCase().replace(/\s+/g, "-");
    const res = await fetch(`/api/ability/${encodeURIComponent(slug)}`);
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    const pokemonCards = data.pokemon.map(p => `
      <a href="/pokemon/${p.name}" class="ability-poke-card">
        <img class="ability-poke-sprite" src="${p.sprite_url}" alt="${p.name}"
          loading="lazy"
          onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'">
        <span class="ability-poke-name">${p.name}</span>
      </a>`).join("");

    const totalNote = data.total > 30
      ? `<small style="color:var(--text-muted);display:block;margin-top:0.6rem">Mostrando 30 de ${data.total} Pokémon</small>`
      : "";

    container.innerHTML = `
      <div class="ability-panel">
        <div class="ability-panel-title">✦ ${data.name}</div>
        ${data.description ? `<p class="ability-panel-desc">${data.description}</p>` : ""}
        <div class="ability-pokemon-grid">${pokemonCards}</div>
        ${totalNote}
      </div>`;

  } catch (err) {
    container.innerHTML = `
      <div class="ability-panel">
        <p style="color:var(--accent-red)">Error al cargar la habilidad. Intenta de nuevo.</p>
      </div>`;
    activePanelAbility = null;
    console.error("Ability panel error:", err);
  }
}

function initAbilityBadges() {
  document.querySelectorAll(".ability-badge[data-ability]").forEach(badge => {
    badge.addEventListener("click", () => {
      openAbilityPanel(badge.dataset.ability);
      // visual active state
      document.querySelectorAll(".ability-badge").forEach(b => b.classList.remove("active-ability"));
      badge.classList.toggle("active-ability", activePanelAbility === badge.dataset.ability);
    });
  });
}

// ── Audio Cries ───────────────────────────────────────────────
let currentAudio = null;

function playCry(audioUrl) {
  if (!audioUrl) return;
  const btn = document.querySelector('.btn-audio');

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }

  if (btn) btn.classList.add('playing');

  currentAudio = new Audio(audioUrl);
  currentAudio.volume = 0.4;
  currentAudio.play().catch(e => console.error("Error playing cry:", e));

  currentAudio.onended = () => {
    if (btn) btn.classList.remove('playing');
  };
}

// ── Dynamic Particles ─────────────────────────────────────────
function initParticles() {
  const container = document.getElementById('particles-container');
  const hero = document.getElementById('detail-hero');
  if (!container || !hero) return;

  const type = hero.dataset.bgType;
  if (!type) return;

  const particleCount = 25;

  let pClass = 'particle-generic';
  if (type === 'water') pClass = 'particle-water';
  else if (type === 'fire') pClass = 'particle-fire';
  else if (type === 'electric') pClass = 'particle-electric';

  for (let i = 0; i < particleCount; i++) {
    const p = document.createElement('div');
    p.classList.add('particle', pClass);

    const x = Math.random() * 100;
    const y = Math.random() * 100;
    p.style.left = x + '%';
    p.style.top = y + '%';

    const duration = 2 + Math.random() * 4;
    const delay = Math.random() * 5;

    p.style.animationDelay = delay + 's';
    p.style.setProperty('--duration', duration + 's');

    if (pClass === 'particle-water') {
      const size = 5 + Math.random() * 15;
      p.style.width = size + 'px';
      p.style.height = size + 'px';
    }
    else if (pClass === 'particle-fire') {
      const size = 3 + Math.random() * 8;
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.setProperty('--drift', (Math.random() * 40 - 20) + 'px');
    }
    else if (pClass === 'particle-electric') {
      const width = 2 + Math.random() * 3;
      const height = 15 + Math.random() * 20;
      p.style.width = width + 'px';
      p.style.height = height + 'px';
      p.style.setProperty('--rot', (Math.random() * 360) + 'deg');
    }
    else {
      const size = 5 + Math.random() * 10;
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.setProperty('--dx', (Math.random() * 60 - 30) + 'px');
      p.style.setProperty('--dy', (Math.random() * -60 - 20) + 'px');
    }
    container.appendChild(p);
  }
}

// ── Dynamic Environment ───────────────────────────────────────
function initDynamicEnvironment() {
  const body = document.body;
  const weatherBg = document.getElementById('global-weather-bg');
  const hour = new Date().getHours();

  // Theme Detection (6 AM - 6 PM Day, else Night)
  const isDay = hour >= 6 && hour < 18;
  body.classList.add(isDay ? 'theme-day' : 'theme-night');

  if (weatherBg) {
    if (!isDay) {
      weatherBg.classList.add('weather-stars');
    }

    // Add a random weather effect for variety (optional but fun)
    // 20% chance of rain
    if (Math.random() < 0.2) {
      weatherBg.classList.add('weather-rain');
    }
  }
}

// ── Poké-Recreo (Click Interactions) ──────────────────────────
function initPokeRecreo() {
  const sprite = document.querySelector('.detail-sprite');
  if (!sprite) return;

  const audioUrl = sprite.dataset.cryUrl;

  sprite.addEventListener('click', () => {
    // Random Animation
    const animations = ['bounce', 'shake', 'rotate-jump'];
    const anim = animations[Math.floor(Math.random() * animations.length)];

    sprite.classList.add('recreo-' + anim);
    if (audioUrl) playCry(audioUrl);

    setTimeout(() => {
      sprite.classList.remove('recreo-' + anim);
    }, 1000);
  });
}


// ── 3D Tilt Effect ────────────────────────────────────────────
function initTiltEffect() {
  const hero = document.getElementById('detail-hero');
  if (!hero) return;

  if (window.matchMedia("(pointer: coarse)").matches) return;

  hero.classList.add('tilt-enabled');
  hero.classList.add('glow-bleed-enabled');

  const baseColor = hero.dataset.typeColor || '#ffffff';

  let glowColor = 'rgba(255,255,255,0.2)';
  if (baseColor.startsWith('#') && baseColor.length >= 7) {
    const r = parseInt(baseColor.slice(1, 3), 16);
    const g = parseInt(baseColor.slice(3, 5), 16);
    const b = parseInt(baseColor.slice(5, 7), 16);
    glowColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
  }
  hero.style.setProperty('--glow-color', glowColor);

  hero.addEventListener('mousemove', e => {
    const rect = hero.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const tiltX = ((y - centerY) / centerY) * -10;
    const tiltY = ((x - centerX) / centerX) * 10;

    hero.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;

    const px = (x / rect.width) * 100;
    const py = (y / rect.height) * 100;
    hero.style.setProperty('--glow-x', px + '%');
    hero.style.setProperty('--glow-y', py + '%');

    const sprite = hero.querySelector('.detail-sprite');
    if (sprite) {
      const sx = ((x - centerX) / centerX) * -15;
      const sy = ((y - centerY) / centerY) * -15;
      sprite.style.filter = `drop-shadow(${sx}px ${sy}px 24px rgba(0,0,0,0.8))`;
    }
  });

  hero.addEventListener('mouseleave', () => {
    hero.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg)`;
    hero.style.setProperty('--glow-x', '50%');
    hero.style.setProperty('--glow-y', '50%');
    const sprite = hero.querySelector('.detail-sprite');
    if (sprite) {
      sprite.style.filter = '';
    }
  });
}

// ── Scan Effect ───────────────────────────────────────────────
function playScanEffect() {
  const hero = document.getElementById('detail-hero');
  if (!hero) return;

  const scanLine = document.createElement('div');
  scanLine.classList.add('scan-line');
  hero.appendChild(scanLine);

  setTimeout(() => scanLine.remove(), 1500);
}

// ── Evolution Chain ───────────────────────────────────────────
async function initEvolutionChain() {
  const card = document.getElementById('evolution-card');
  const container = document.getElementById('evolution-container');
  if (!card || !container) return;

  const evoUrl = card.dataset.evoUrl;
  if (!evoUrl) return;

  const match = evoUrl.match(/\/(\d+)\/?$/);
  if (!match) return;
  const chainId = match[1];

  try {
    const res = await fetch(`/api/evolution/${chainId}`);
    const chain = await res.json();

    if (chain.error) throw new Error(chain.error);
    if (chain.length < 2) return; // Don't show if no evolution

    card.style.display = 'block';

    const currentName = document.querySelector('.detail-hero-name')?.textContent.trim().toLowerCase();

    const html = chain.map((p, i) => `
      <div class="evo-item ${p.name.toLowerCase() === currentName ? 'is-current' : ''}">
        <a href="/pokemon/${p.name}" class="ripple-container">
          <img src="${p.sprite_url}" alt="${p.name}" onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'">
          <span>${p.name}</span>
        </a>
      </div>
      ${i < chain.length - 1 ? '<div class="evo-arrow">→</div>' : ''}
    `).join('');

    container.innerHTML = `<div class="evo-row">${html}</div>`;
  } catch (e) {
    console.error("Error loading evolution chain:", e);
  }
}

// ── Retro Pokédex Mode ────────────────────────────────────────
function initRetroMode() {
  const btn = document.getElementById('btn-retro-toggle');
  if (!btn) return;

  const isRetro = localStorage.getItem('pokedex_retro') === 'true';
  if (isRetro) {
    document.body.classList.add('retro-mode');
    btn.innerHTML = '💻 Modo Moderno';
  }

  btn.addEventListener('click', () => {
    const isNowRetro = document.body.classList.toggle('retro-mode');
    localStorage.setItem('pokedex_retro', isNowRetro);
    btn.innerHTML = isNowRetro ? '💻 Modo Moderno' : '📺 Modo Retro';
  });
}

// ── Capture / Release Transitions ─────────────────────────────


// ── Who's That Pokémon? ──────────────────────────────────────
const WTP_API = "/api/pokemon/all";
let wtpCurrent = null;

async function initWTP() {
  const widget = document.getElementById('wtp-widget');
  const toggle = document.getElementById('wtp-toggle');
  const img = document.getElementById('wtp-silhouette');
  const input = document.getElementById('wtp-input');
  const btn = document.getElementById('wtp-btn');
  const result = document.getElementById('wtp-result');

  if (!widget || !toggle) return;

  toggle.addEventListener('click', () => {
    widget.classList.toggle('open');
    if (widget.classList.contains('open') && !wtpCurrent) {
      loadNewWTP();
    }
  });

  async function loadNewWTP() {
    result.textContent = "Cargando...";
    result.className = "wtp-result";
    img.classList.remove('revealed');
    input.value = "";

    try {
      const res = await fetch(WTP_API);
      const data = await res.json();
      const pokes = data.pokemon;
      wtpCurrent = pokes[Math.floor(Math.random() * pokes.length)];

      img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${wtpCurrent.id}.png`;
      result.textContent = "";
    } catch (e) {
      result.textContent = "Error al cargar";
      console.error(e);
    }
  }

  btn.addEventListener('click', () => {
    if (!wtpCurrent) return;
    const guess = input.value.toLowerCase().trim();
    if (guess === wtpCurrent.name.toLowerCase()) {
      result.textContent = "¡Correcto! Es " + wtpCurrent.name.toUpperCase();
      result.className = "wtp-result success";
      img.classList.add('revealed');
      setTimeout(loadNewWTP, 3000);
    } else {
      result.textContent = "¡Intenta de nuevo!";
      result.className = "wtp-result error";
    }
  });

  input.addEventListener('keypress', e => { if (e.key === 'Enter') btn.click(); });
}

// ── Capture Minigame ──────────────────────────────────────────


// ── Team Builder ─────────────────────────────────────────────
// Migrate from old string array to object array if necessary
let rawTeam = JSON.parse(localStorage.getItem('pkTeam') || '[]');
let pkTeam = rawTeam.map(item => {
  if (typeof item === 'string') {
    return { id: item, moves: [] };
  }
  return item;
});

function initTeamBuilder() {
  const tray = document.getElementById('team-builder-tray');
  const toggle = document.getElementById('team-toggle-btn');
  const clearBtn = document.getElementById('clear-team-btn');
  const analyzeBtn = document.getElementById('analyze-team-btn');
  const exportBtn = document.getElementById('export-team-btn');
  const panel = document.getElementById('team-analysis-panel');
  const closeBtn = document.getElementById('close-analysis-btn');

  if (!tray || !toggle) return;

  toggle.addEventListener('click', () => tray.classList.toggle('open'));
  clearBtn.addEventListener('click', () => { pkTeam = []; saveTeam(); renderTeam(); if (panel) panel.style.display = 'none'; });

  if (analyzeBtn && panel) {
    analyzeBtn.addEventListener('click', analyzeTeam);
    closeBtn.addEventListener('click', () => panel.style.display = 'none');
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', exportTrainerCard);
  }

  // Init Draggable on existing cards
  document.querySelectorAll('.pokemon-card').forEach(c => makeDraggable(c));
  renderTeam();
}

function makeDraggable(card) {
  card.setAttribute('draggable', true);
  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', card.dataset.pokeId);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
}

function allowDrop(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function dropToTeam(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  let id = e.dataTransfer.getData('text/plain');

  // Validate that 'id' exists and is comprised only of digits (which is what poke.id gives us)
  if (!id || !/^\d+$/.test(id)) {
    console.warn("Invalid draggable data detected. Ensuring it is a valid ID.");
    return;
  }

  if (pkTeam.length >= 6) {
    alert("¡Equipo lleno! (Máximo 6)");
    return;
  }

  if (!pkTeam.find(p => p.id === id)) {
    pkTeam.push({ id: id, moves: [] });
    saveTeam();
    renderTeam();
  }
}

function saveTeam() { localStorage.setItem('pkTeam', JSON.stringify(pkTeam)); }

function renderTeam() {
  const slots = document.querySelectorAll('.team-slot');
  slots.forEach((s, i) => {
    const pokeObj = pkTeam[i];
    if (pokeObj) {
      const id = pokeObj.id;
      const hasCustomMoves = pokeObj.moves && pokeObj.moves.length > 0;
      s.innerHTML = `
         <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png" alt="${id}">
         <button class="slot-edit-moves" onclick="openMovesModal(${i})" title="Editar ataques" style="position:absolute; bottom:5px; left:5px; background:var(--accent-yellow); color:#000; border:none; border-radius:50%; width:24px; height:24px; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; z-index:5; opacity:0.9; box-shadow:0 2px 5px rgba(0,0,0,0.5);">✏️</button>
         ${hasCustomMoves ? `<div title="Ataques elegidos" style="position:absolute; bottom:-2px; right:-2px; background:var(--accent-green); width:12px; height:12px; border-radius:50%; border:2px solid var(--panel-bg); z-index:5;"></div>` : ''}
         <div class="slot-remove" onclick="removeFromTeam(${i})">✕</div>`;
      s.classList.add('filled');
    } else {
      s.innerHTML = `<div class="slot-empty">+</div>`;
      s.classList.remove('filled');
    }
  });

  const summary = document.getElementById('team-stats-summary');
  if (summary) {
    summary.textContent = pkTeam.length > 0
      ? `${pkTeam.length}/6 Pokémon en el equipo`
      : "Arrastra Pokémon aquí para formar tu equipo";
  }

  const analyzeBtn = document.getElementById('analyze-team-btn');
  if (analyzeBtn) {
    analyzeBtn.style.display = pkTeam.length > 0 ? 'inline-block' : 'none';
  }

  const exportBtn = document.getElementById('export-team-btn');
  if (exportBtn) {
    exportBtn.style.display = pkTeam.length > 0 ? 'inline-block' : 'none';
  }

  const leagueBtn = document.getElementById('league-team-btn');
  if (leagueBtn) {
    leagueBtn.style.display = pkTeam.length > 0 ? 'inline-block' : 'none';
  }
}

async function exportTrainerCard() {
  const template = document.getElementById('trainer-card-export');
  const slotsContainer = document.getElementById('tc-slots');
  const btn = document.getElementById('export-team-btn');

  if (!template || !slotsContainer || pkTeam.length === 0) return;

  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-sm"></span> Creando...';
  btn.disabled = true;

  try {
    // Fill the template
    slotsContainer.innerHTML = '';

    // We create exactly 6 slots format
    for (let i = 0; i < 6; i++) {
      const pokeObj = pkTeam[i];
      if (pokeObj) {
        slotsContainer.innerHTML += `
             <div class="tc-slot">
                <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokeObj.id}.png" crossorigin="anonymous">
             </div>`;
      } else {
        slotsContainer.innerHTML += `<div class="tc-slot" style="opacity:0.2;"></div>`;
      }
    }

    // Wait for images to load (simplified)
    await new Promise(r => setTimeout(r, 800));

    // Capture with html2canvas (provided via CDN)
    if (typeof html2canvas === 'undefined') {
      alert("La librería para exportar no se ha cargado. Reintenta.");
      throw new Error("html2canvas is not defined");
    }

    const canvas = await html2canvas(template, {
      backgroundColor: null,
      useCORS: true,
      scale: 2 // High quality
    });

    // Download
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = 'Pokemon_Trainer_Card.png';
    link.href = dataUrl;
    link.click();

    btn.innerHTML = '¡Descargado! ✔️';
    setTimeout(() => { btn.innerHTML = originalText; btn.disabled = false; }, 2000);

  } catch (e) {
    console.error("Export Error:", e);
    btn.innerHTML = 'Error ❌';
    setTimeout(() => { btn.innerHTML = originalText; btn.disabled = false; }, 2000);
  }
}

async function analyzeTeam() {
  const panel = document.getElementById('team-analysis-panel');
  const content = document.getElementById('analysis-content');
  if (!panel || !content || pkTeam.length === 0) return;

  panel.style.display = 'flex';
  content.innerHTML = '<div style="text-align:center;width:100%;grid-column:1/-1;">Analizando equipo... <span class="spinner-sm"></span></div>';

  try {
    const promises = pkTeam.map(pokeObj => fetch(`/api/pokemon/${pokeObj.id}`).then(r => r.json()));
    const pokes = await Promise.all(promises);

    // Calculate stats
    const statsTotal = {};
    pokes.forEach(p => {
      p.stats.forEach(s => {
        statsTotal[s.name] = (statsTotal[s.name] || 0) + s.value;
      });
    });

    const maxPossStat = 150; // Arbitrary max stat to calculate bar size nicely

    const statsHtml = Object.entries(statsTotal).map(([name, val]) => {
      const avg = Math.round(val / pokes.length);
      const pct = Math.min((avg / maxPossStat) * 100, 100);
      return `
        <div class="stat-bar-row">
            <span class="stat-label">${name}</span>
            <div class="stat-track">
                <div class="stat-fill" style="width:${pct}%"></div>
            </div>
            <span class="stat-val">${avg}</span>
        </div>`;
    }).join('');

    // Calculate Weaknesses and Resistances
    const weakCount = {};
    const resCount = {};

    pokes.forEach(p => {
      p.weaknesses.forEach(w => {
        weakCount[w.name] = (weakCount[w.name] || 0) + 1;
      });
      p.resistances.forEach(r => {
        resCount[r.name] = (resCount[r.name] || 0) + 1;
      });
    });

    // Sort and filter top 5
    const topWeak = Object.entries(weakCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topRes = Object.entries(resCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const formatTypes = (arr, isWeak) => {
      if (!arr.length) return '<div class="type-tally-item">Ninguna</div>';
      return arr.map(([t, count]) => `
            <div class="type-tally-item">
                <span style="text-transform:capitalize">Tipo ${t}</span>
                <span class="tally-count ${isWeak ? 'danger' : 'safe'}">${count} en equipo</span>
            </div>
        `).join('');
    };

    content.innerHTML = `
      <div class="analysis-section" style="grid-column: 1 / -1;">
          <h5>Promedio de Estadísticas Base</h5>
          <div class="stat-bars-list">
            ${statsHtml}
          </div>
      </div>
      <div class="analysis-section">
          <h5>Mayores Debilidades</h5>
          <div class="type-tally-list">
            ${formatTypes(topWeak, true)}
          </div>
      </div>
      <div class="analysis-section">
          <h5>Mayores Resistencias</h5>
          <div class="type-tally-list">
            ${formatTypes(topRes, false)}
          </div>
      </div>
    `;

  } catch (e) {
    content.innerHTML = '<div style="color:var(--accent-red);grid-column:1/-1;">Error al analizar el equipo. Verifica la conexión.</div>';
    console.error("Team Analysis Error:", e);
  }
}

window.removeFromTeam = (index) => {
  pkTeam.splice(index, 1);
  saveTeam();
  renderTeam();
};

// ── Move Selection Modal ──────────────────────────────────────
let activeMoveModalIndex = -1;
let currentSelectedMoves = [];
let activeMoveModalSession = 0;

window.openMovesModal = async (teamIndex) => {
  const pokeObj = pkTeam[teamIndex];
  if (!pokeObj) return;

  const currentSession = ++activeMoveModalSession;

  activeMoveModalIndex = teamIndex;
  currentSelectedMoves = [...(pokeObj.moves || [])];

  const modal = document.getElementById('move-selection-modal');
  const backdrop = document.getElementById('move-modal-backdrop');
  const title = document.getElementById('move-modal-title');
  const container = document.getElementById('moves-list-container');
  const countBadge = document.getElementById('moves-count-badge');
  const sprite = document.getElementById('move-modal-sprite');

  if (!modal) return;

  modal.style.display = 'flex';
  backdrop.style.display = 'block';
  container.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--text-muted);">Cargando ataques... <span class="spinner-sm"></span></div>`;
  countBadge.textContent = currentSelectedMoves.length;
  sprite.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokeObj.id}.png`;

  try {
    const res = await fetch(`/api/pokemon/${pokeObj.id}`);
    const data = await res.json();

    if (activeMoveModalSession !== currentSession) return; // Stale fetch ignored

    if (data.error) throw new Error(data.error);

    // Ensure the sprite img element exists and set it together with the title
    title.innerHTML = `<img id="move-modal-sprite" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokeObj.id}.png" style="width:32px; height:32px; object-fit:contain; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));"> Editar Ataques de ${data.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`;

    const allMoves = data.all_moves || [];

    if (allMoves.length === 0) {
      container.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--text-muted);">Este Pokémon no aprende ataques.</div>`;
      return;
    }

    try {
      const detailsRes = await fetch('/api/custom-moves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moves: allMoves })
      });
      const detailsData = await detailsRes.json();
      const detailedMoves = detailsData.moves || [];
      renderMovesList(allMoves, detailedMoves);
    } catch (e) {
      console.error("Error loading move details:", e);
      renderMovesList(allMoves, []); // fallback to basic names
    }

  } catch (err) {
    if (activeMoveModalSession !== currentSession) return; // Ignore errors from stale fetches
    console.error("Error loading moves:", err);
    container.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--accent-red);">Error al cargar ataques.</div>`;
  }
};

function renderMovesList(moves, detailedMoves = []) {
  const container = document.getElementById('moves-list-container');
  const countBadge = document.getElementById('moves-count-badge');

  container.innerHTML = moves.map(moveName => {
    const isSelected = currentSelectedMoves.includes(moveName);
    const displayName = moveName.replace(/-/g, ' ').replace(/\\w\\S*/g, (w) => (w.replace(/^\\w/, (c) => c.toUpperCase())));

    // Find detailed match
    const details = detailedMoves.find(m => m.name.toLowerCase().replace(/ /g, '-') === moveName.toLowerCase()) || {};
    const pow = details.power > 0 ? details.power : '--';
    const typeColor = details.type_color || '#777';

    const typeLabel = details.type ? `<span style="background:${typeColor}22; border:1px solid ${typeColor}; padding:0.1rem 0.4rem; border-radius:4px; font-size:0.65rem; color:${typeColor}; margin-left:8px;">${details.type.toUpperCase()}</span>` : '';
    const statsLabel = details.damage_class ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">Pod: ${pow}</div>` : '';

    return `
            <button class="lx-move-btn ${isSelected ? 'selected' : ''}" style="width:100%; text-align:left; padding:0.6rem; margin:0; border:1px solid ${isSelected ? 'var(--accent-yellow)' : 'rgba(255,255,255,0.1)'}; background:${isSelected ? 'rgba(255,215,0,0.1)' : 'rgba(0,0,0,0.3)'}; color:${isSelected ? 'white' : 'var(--text-secondary)'}; border-radius:8px; cursor:pointer; display:flex; flex-direction:column; justify-content:center;" onclick="toggleMoveSelection('${moveName}')">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <div style="display:flex; align-items:center;">
                        <span style="font-weight:600; font-size:0.85rem;">${displayName}</span>
                        ${typeLabel}
                    </div>
                    <span class="lx-move-check" style="color:var(--accent-yellow); font-size:0.85rem;">${isSelected ? '✓' : ''}</span>
                </div>
                ${statsLabel}
            </button>
        `;
  }).join("");

  countBadge.textContent = currentSelectedMoves.length;
}

window.toggleMoveSelection = (moveName) => {
  const idx = currentSelectedMoves.indexOf(moveName);
  if (idx !== -1) {
    currentSelectedMoves.splice(idx, 1);
  } else {
    if (currentSelectedMoves.length >= 4) {
      alert("Solo puedes seleccionar hasta 4 ataques.");
      return;
    }
    currentSelectedMoves.push(moveName);
  }

  // We don't want to re-render the whole list to keep scroll position, we just re-render UI state
  const container = document.getElementById('moves-list-container');
  const countBadge = document.getElementById('moves-count-badge');

  const buttons = container.querySelectorAll('.lx-move-btn');

  // Simply fetch current pokemon again from some cache variable ideally, but easier to just update DOM
  buttons.forEach(btn => {
    if (btn.getAttribute('onclick').includes(`'${moveName}'`)) {
      const isSelected = currentSelectedMoves.includes(moveName);
      btn.style.border = `1px solid ${isSelected ? 'var(--accent-yellow)' : 'rgba(255,255,255,0.1)'}`;
      btn.style.background = isSelected ? 'rgba(255,215,0,0.1)' : 'rgba(0,0,0,0.3)';
      btn.style.color = isSelected ? 'white' : 'var(--text-secondary)';

      const checkEl = btn.querySelector('.lx-move-check');
      if (checkEl) {
        checkEl.textContent = isSelected ? '✓' : '';
      }
    }
  });

  countBadge.textContent = currentSelectedMoves.length;
};

window.saveMoveSelection = () => {
  if (activeMoveModalIndex === -1) return;

  pkTeam[activeMoveModalIndex].moves = [...currentSelectedMoves];
  saveTeam();
  renderTeam();
  closeMovesModal();
};

window.closeMovesModal = () => {
  const modal = document.getElementById('move-selection-modal');
  const backdrop = document.getElementById('move-modal-backdrop');
  if (modal) modal.style.display = 'none';
  if (backdrop) backdrop.style.display = 'none';
  activeMoveModalIndex = -1;
};

window.allowDrop = allowDrop;
window.dropToTeam = dropToTeam;
window.dragStart = e => {
  const card = e.target.closest('[data-poke-id]');
  if (card) e.dataTransfer.setData('text/plain', card.dataset.pokeId);
};

// ── Capture Transition ───────────────────────────────────────
function initCaptureTransition() {
  const overlay = document.createElement('div');
  overlay.className = 'capture-transition-overlay';
  overlay.innerHTML = `
    <div class="pokeball-animated"></div>
    <div class="gotcha-spark"></div>
  `;
  document.body.appendChild(overlay);

  const ball = overlay.querySelector('.pokeball-animated');
  const spark = overlay.querySelector('.gotcha-spark');

  document.addEventListener('click', e => {
    // Only target cards that go to detail page
    const card = e.target.closest('.pokemon-card');
    if (!card || e.target.closest('.card-fav-btn') || e.target.closest('.slot-remove')) return;

    // Don't trigger if it's a drag start (though that's usually mousedown)
    if (card.classList.contains('dragging')) return;

    e.preventDefault();
    const href = card.href;

    // Visual feedback on card
    card.classList.add('capturing');
    overlay.classList.add('active');
    ball.classList.add('animate');

    // Gotcha spark
    setTimeout(() => {
      spark.classList.add('active');
    }, 850);

    // Navigate
    setTimeout(() => {
      window.location.href = href;
    }, 1100);
  });
}

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Move modal
  const closeMovesBtn = document.getElementById('close-moves-btn');
  const modalBackdrop = document.getElementById('move-modal-backdrop');
  const saveMovesBtn = document.getElementById('save-moves-btn');
  if (closeMovesBtn) closeMovesBtn.addEventListener('click', closeMovesModal);
  if (modalBackdrop) modalBackdrop.addEventListener('click', closeMovesModal);
  if (saveMovesBtn) saveMovesBtn.addEventListener('click', saveMoveSelection);

  initFavoriteButtons();
  initSeenTracking();
  initRipple();
  initStatBars();
  initLoadMore();
  initAbilityBadges();
  initParticles();
  initTiltEffect();
  playScanEffect();
  initEvolutionChain();
  initRetroMode();
  initTeamBuilder();
  initWTP();
  initCaptureTransition();
});
