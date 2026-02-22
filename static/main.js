/**
 * Pokédex — main.js
 * Handles: Load More, Type Filter, Ability Panel, Favorites, Ripple, Stat Bars
 */

// ── Constants ────────────────────────────────────────────────
const FAV_KEY    = "pokedex_favorites";
const SEEN_KEY   = "pokedex_seen";
const PAGE_SIZE  = 20;

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
  const idx  = favs.indexOf(id);
  if (idx === -1) favs.push(id);
  else            favs.splice(idx, 1);
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
  const el = document.getElementById("seen-counter");
  if (el) el.textContent = getSeen().size;
}

function initSeenTracking() {
  // Mark all currently visible cards as "seen"
  document.querySelectorAll("[data-poke-id]").forEach(el => markSeen(el.dataset.pokeId));
  updateSeenCounter();
}

// ── Ripple Effect ─────────────────────────────────────────────
function addRipple(el, event) {
  const rect   = el.getBoundingClientRect();
  const size   = Math.max(rect.width, rect.height);
  const x      = event.clientX - rect.left - size / 2;
  const y      = event.clientY - rect.top  - size / 2;
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
        const el  = entry.target;
        const val = parseFloat(el.dataset.value) || 0;
        el.style.width = val + "%";
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.2 });

  fills.forEach(el => observer.observe(el));
}

// ── Load More (Index page) ────────────────────────────────────
let loadMoreOffset  = 0;
let loadMoreType    = "";
let loadMoreHasNext = true;
let loadMoreBusy    = false;

function buildCard(poke) {
  const id      = String(poke.id || "");
  const name    = poke.name || "";
  const sprite  = poke.sprite_url || "";
  const padId   = id.padStart(4, "0");
  const isFav   = isFavorite(id);

  return `
    <a href="/pokemon/${name}" class="pokemon-card ripple-container" data-poke-id="${id}">
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
    </a>`;
}

function buildSkeletons(n) {
  return Array.from({length: n}, () => `
    <div class="skeleton-card">
      <div class="skeleton-block skeleton-img"></div>
      <div class="skeleton-block skeleton-id"></div>
      <div class="skeleton-block skeleton-name"></div>
    </div>`).join("");
}

async function loadMore() {
  if (loadMoreBusy || !loadMoreHasNext) return;
  loadMoreBusy = true;

  const btn  = document.getElementById("btn-load-more");
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
    const res  = await fetch(url);
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

    // Re-init favorites and ripple for new cards
    initFavoriteButtons();
    initRipple();

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
  loadMoreOffset  = parseInt(btn.dataset.offset  || "0",  10);
  loadMoreType    = btn.dataset.type    || "";
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
    const res  = await fetch(`/api/ability/${encodeURIComponent(slug)}`);
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

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initFavoriteButtons();
  initSeenTracking();
  initRipple();
  initStatBars();
  initLoadMore();
  initAbilityBadges();
});
