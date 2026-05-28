"""
Centralized configuration for the Pokédex application.

All constants, timeouts, and display settings are defined here
to avoid hardcoding values throughout the codebase.
"""

# ── PokeAPI Settings ──────────────────────────────────────────
POKEAPI_BASE_URL: str = "https://pokeapi.co/api/v2"
REQUEST_TIMEOUT: int = 10  # seconds
MAX_RETRIES: int = 3
RETRY_BACKOFF_FACTOR: float = 0.3

# ── Cache TTL (seconds) ──────────────────────────────────────
CACHE_TTL_POKEMON: int = 300    # 5 min — individual Pokémon detail
CACHE_TTL_LIST: int = 120       # 2 min — paginated listings
CACHE_TTL_TYPES: int = 3600     # 1 hour — types rarely change

# ── Scope: First 3 Generations only ──────────────────────────
MAX_POKEMON: int = 386

GENERATION_RANGES: dict = {
    1: (1,   151, "Kanto"),
    2: (152, 251, "Johto"),
    3: (252, 386, "Hoenn"),
}

# ── Pagination ────────────────────────────────────────────────
PAGE_SIZE: int = 24

# ── Pokémon Type Colors (for UI badges) ───────────────────────
TYPE_COLORS: dict[str, str] = {
    "normal":   "#A8A77A",
    "fire":     "#EE8130",
    "water":    "#6390F0",
    "electric": "#F7D02C",
    "grass":    "#7AC74C",
    "ice":      "#96D9D6",
    "fighting": "#C22E28",
    "poison":   "#A33EA1",
    "ground":   "#E2BF65",
    "flying":   "#A98FF3",
    "psychic":  "#F95587",
    "bug":      "#A6B91A",
    "rock":     "#B6A136",
    "ghost":    "#735797",
    "dragon":   "#6F35FC",
    "dark":     "#705746",
    "steel":    "#B7B7CE",
    "fairy":    "#D685AD",
    "stellar":  "#7CC7B2",
    "unknown":  "#68A090",
}

# ── Sprite URL Templates ─────────────────────────────────────
SPRITE_URL: str = (
    "https://raw.githubusercontent.com/PokeAPI/sprites/"
    "master/sprites/pokemon/other/official-artwork/{id}.png"
)

SPRITE_URL_SMALL: str = (
    "https://raw.githubusercontent.com/PokeAPI/sprites/"
    "master/sprites/pokemon/{id}.png"
)

# ── Pokemon Cry URL (OGG audio) ──────────────────────────────
CRY_URL: str = (
    "https://raw.githubusercontent.com/PokeAPI/cries/"
    "main/cries/pokemon/latest/{id}.ogg"
)
