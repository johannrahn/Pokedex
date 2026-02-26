"""
PokeAPI client service.

Handles all communication with the PokeAPI, including request retries,
timeout handling, caching, and data normalization for templates.
"""

import re
from typing import Any, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import (
    CACHE_TTL_LIST,
    CACHE_TTL_POKEMON,
    CACHE_TTL_TYPES,
    MAX_RETRIES,
    PAGE_SIZE,
    POKEAPI_BASE_URL,
    REQUEST_TIMEOUT,
    RETRY_BACKOFF_FACTOR,
    SPRITE_URL,
    SPRITE_URL_SMALL,
    TYPE_COLORS,
)
from services.cache import TTLCache


# ── Custom Exception ──────────────────────────────────────────

class PokeAPIError(Exception):
    """Raised when the PokeAPI returns an error or is unreachable.

    Attributes:
        message: Human-readable error description.
        status_code: HTTP status code, if available.
    """

    def __init__(self, message: str, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# ── Cache Instances ───────────────────────────────────────────

_pokemon_cache = TTLCache(default_ttl=CACHE_TTL_POKEMON)
_list_cache = TTLCache(default_ttl=CACHE_TTL_LIST)
_type_cache = TTLCache(default_ttl=CACHE_TTL_TYPES)


# ── HTTP Session ──────────────────────────────────────────────

def _create_session() -> requests.Session:
    """Create a requests session with retry logic and connection pooling.

    Returns:
        Configured requests.Session instance.
    """
    session = requests.Session()

    retry_strategy = Retry(
        total=MAX_RETRIES,
        backoff_factor=RETRY_BACKOFF_FACTOR,
        status_forcelist=[502, 503, 504],
        allowed_methods=["GET"],
    )

    adapter = HTTPAdapter(
        max_retries=retry_strategy,
        pool_connections=10,
        pool_maxsize=20,
    )

    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


_session = _create_session()


# ── Internal Helpers ──────────────────────────────────────────

def _make_request(endpoint: str) -> dict[str, Any]:
    """Execute a GET request to the PokeAPI.

    Args:
        endpoint: API path relative to the base URL (e.g., '/pokemon/1').

    Returns:
        Parsed JSON response as a dictionary.

    Raises:
        PokeAPIError: On network errors, timeouts, or non-200 responses.
    """
    url = f"{POKEAPI_BASE_URL}{endpoint}"

    try:
        response = _session.get(url, timeout=REQUEST_TIMEOUT)
    except requests.exceptions.Timeout:
        raise PokeAPIError(
            "La PokeAPI no respondió a tiempo. Intenta de nuevo.",
            status_code=504,
        )
    except requests.exceptions.ConnectionError:
        raise PokeAPIError(
            "No se pudo conectar con la PokeAPI. Verifica tu conexión.",
            status_code=503,
        )
    except requests.exceptions.RequestException as exc:
        raise PokeAPIError(f"Error inesperado al contactar la PokeAPI: {exc}")

    if response.status_code == 404:
        raise PokeAPIError("Pokémon no encontrado.", status_code=404)

    if response.status_code != 200:
        raise PokeAPIError(
            f"La PokeAPI respondió con un error (HTTP {response.status_code}).",
            status_code=response.status_code,
        )

    try:
        return response.json()
    except ValueError:
        raise PokeAPIError("La respuesta de la PokeAPI no es válida.")


def _extract_id_from_url(url: str) -> Optional[int]:
    """Extract the numeric ID from a PokeAPI resource URL.

    Args:
        url: A PokeAPI URL like 'https://pokeapi.co/api/v2/pokemon/25/'.

    Returns:
        The integer ID, or None if extraction fails.
    """
    match = re.search(r"/(\d+)/?$", url)
    return int(match.group(1)) if match else None


def _sanitize_input(value: str) -> str:
    """Sanitize and normalize user input for Pokémon lookup.

    Args:
        value: Raw user input (name or ID).

    Returns:
        Lowercased, stripped input string.

    Raises:
        PokeAPIError: If input is empty or excessively long.
    """
    cleaned = value.strip().lower()

    if not cleaned:
        raise PokeAPIError("Debes ingresar un nombre o ID de Pokémon.", status_code=400)

    if len(cleaned) > 50:
        raise PokeAPIError("La búsqueda es demasiado larga.", status_code=400)

    return cleaned


def _calculate_type_relations(type_names: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Calculates offensive advantages and defensive weaknesses for a combination of types."""
    defensive_multipliers = {}
    offensive_advantages = set()
    
    for type_name in type_names:
        cache_key = f"type_data:{type_name}"
        type_data = _type_cache.get(cache_key)
        if not type_data:
            type_data = _make_request(f"/type/{type_name}")
            _type_cache.set(cache_key, type_data)
            
        damage_relations = type_data.get("damage_relations", {})
        
        # Offensive
        for t in damage_relations.get("double_damage_to", []):
            offensive_advantages.add(t["name"])
            
        # Defensive
        for t in damage_relations.get("double_damage_from", []):
            defensive_multipliers[t["name"]] = defensive_multipliers.get(t["name"], 1) * 2
        for t in damage_relations.get("half_damage_from", []):
            defensive_multipliers[t["name"]] = defensive_multipliers.get(t["name"], 1) * 0.5
        for t in damage_relations.get("no_damage_from", []):
            defensive_multipliers[t["name"]] = defensive_multipliers.get(t["name"], 1) * 0
            
    weaknesses = []
    resistances = []
    
    for t_name, mult in defensive_multipliers.items():
        if mult > 1:
            weaknesses.append({
                "name": t_name,
                "multiplier": f"{int(mult)}x" if mult == int(mult) else f"{mult}x",
                "color": TYPE_COLORS.get(t_name, "#777")
            })
        elif mult < 1:
            if mult == 0:
                mult_str = "0x"
            elif mult == 0.5:
                mult_str = "½x"
            elif mult == 0.25:
                mult_str = "¼x"
            else:
                mult_str = f"{mult}x"
                
            resistances.append({
                "name": t_name,
                "multiplier": mult_str,
                "color": TYPE_COLORS.get(t_name, "#777")
            })
            
    advantages = [{"name": t_name, "color": TYPE_COLORS.get(t_name, "#777")} for t_name in offensive_advantages]
    
    weaknesses.sort(key=lambda x: x["name"])
    resistances.sort(key=lambda x: x["name"])
    advantages.sort(key=lambda x: x["name"])
    
    return {
        "weaknesses": weaknesses,
        "resistances": resistances,
        "advantages": advantages
    }


# ── Public API ────────────────────────────────────────────────

def get_pokemon_list(
    limit: int = PAGE_SIZE,
    offset: int = 0,
) -> dict[str, Any]:
    """Fetch a paginated list of Pokémon.

    Args:
        limit: Number of items per page.
        offset: Starting position in the full list.

    Returns:
        Dictionary with keys:
            - pokemon: List of dicts with 'name', 'id', 'sprite_url'.
            - total: Total number of Pokémon available.
            - has_next: Whether there is a next page.
            - has_prev: Whether there is a previous page.
    """
    cache_key = f"list:{limit}:{offset}"
    cached = _list_cache.get(cache_key)
    if cached is not None:
        return cached

    data = _make_request(f"/pokemon?limit={limit}&offset={offset}")

    pokemon_list = []
    for entry in data.get("results", []):
        poke_id = _extract_id_from_url(entry["url"])
        pokemon_list.append({
            "name": entry["name"],
            "id": poke_id,
            "sprite_url": SPRITE_URL_SMALL.format(id=poke_id) if poke_id else None,
        })

    result = {
        "pokemon": pokemon_list,
        "total": data.get("count", 0),
        "has_next": data.get("next") is not None,
        "has_prev": data.get("previous") is not None,
    }

    _list_cache.set(cache_key, result)
    return result


def get_pokemon_detail(name_or_id: str) -> dict[str, Any]:
    """Fetch detailed information about a specific Pokémon.

    Args:
        name_or_id: Pokémon name (e.g., 'pikachu') or ID (e.g., '25').

    Returns:
        Normalized dictionary with Pokémon details ready for templates.

    Raises:
        PokeAPIError: If the Pokémon doesn't exist or API fails.
    """
    identifier = _sanitize_input(name_or_id)

    cache_key = f"pokemon:{identifier}"
    cached = _pokemon_cache.get(cache_key)
    if cached is not None:
        return cached

    data = _make_request(f"/pokemon/{identifier}")

    # Fetch species data for lore (flavor text)
    try:
        species_data = _make_request(f"/pokemon-species/{identifier}")
        flavor_entries = species_data.get("flavor_text_entries", [])
        es_texts = [f["flavor_text"] for f in flavor_entries if f.get("language", {}).get("name") == "es"]
        en_texts = [f["flavor_text"] for f in flavor_entries if f.get("language", {}).get("name") == "en"]
        flavor = es_texts[-1] if es_texts else (en_texts[-1] if en_texts else "Descripción no disponible.")
        flavor_text = flavor.replace("\n", " ").replace("\f", " ")
        
        evo_url = species_data.get("evolution_chain", {}).get("url", "")
    except PokeAPIError:
        flavor_text = "Descripción no disponible."
        evo_url = ""

    pokemon_types = [t["type"]["name"] for t in data.get("types", [])]
    type_relations = _calculate_type_relations(pokemon_types)

    # Normalize the response for template consumption
    detail = {
        "id": data["id"],
        "name": data["name"],
        "height": data["height"] / 10,  # Convert to meters
        "weight": data["weight"] / 10,  # Convert to kilograms
        "base_experience": data.get("base_experience", "N/A"),
        "flavor_text": flavor_text,
        "evo_url": evo_url,
        "sprite_url": SPRITE_URL.format(id=data["id"]),
        "sprite_small": SPRITE_URL_SMALL.format(id=data["id"]),
        "footprint_url": f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/footprints/{data['id']}.png",
        "cry_url": data.get("cries", {}).get("latest", ""),
        "types": [
            {
                "name": t_name,
                "color": TYPE_COLORS.get(t_name, "#777"),
            }
            for t_name in pokemon_types
        ],
        "weaknesses": type_relations["weaknesses"],
        "resistances": type_relations["resistances"],
        "advantages": type_relations["advantages"],
        "abilities": [
            {
                "name": a["ability"]["name"].replace("-", " ").title(),
                "is_hidden": a["is_hidden"],
            }
            for a in data.get("abilities", [])
        ],
        "stats": [
            {
                "name": _format_stat_name(s["stat"]["name"]),
                "value": s["base_stat"],
                "percentage": min(round(s["base_stat"] / 255 * 100), 100),
            }
            for s in data.get("stats", [])
        ],
        "all_moves": sorted(list(set([m["move"]["name"] for m in data.get("moves", [])]))),
    }

    _pokemon_cache.set(cache_key, detail)
    return detail


def get_types() -> list[dict[str, str]]:
    """Fetch all available Pokémon types.

    Returns:
        List of dicts with 'name' and 'color' for each type.
    """
    cache_key = "all_types"
    cached = _type_cache.get(cache_key)
    if cached is not None:
        return cached

    data = _make_request("/type")

    # Filter out non-standard types (stellar, unknown, shadow)
    excluded = {"stellar", "unknown", "shadow"}
    types = [
        {
            "name": t["name"],
            "color": TYPE_COLORS.get(t["name"], "#777"),
        }
        for t in data.get("results", [])
        if t["name"] not in excluded
    ]

    _type_cache.set(cache_key, types)
    return types


def get_pokemon_by_type(type_name: str) -> list[dict[str, Any]]:
    """Fetch all Pokémon of a specific type.

    Args:
        type_name: The type name (e.g., 'fire', 'water').

    Returns:
        List of dicts with 'name', 'id', and 'sprite_url' for each Pokémon.

    Raises:
        PokeAPIError: If the type doesn't exist or API fails.
    """
    cleaned = _sanitize_input(type_name)

    cache_key = f"type:{cleaned}"
    cached = _type_cache.get(cache_key)
    if cached is not None:
        return cached

    data = _make_request(f"/type/{cleaned}")

    pokemon_list = []
    for entry in data.get("pokemon", []):
        poke_data = entry.get("pokemon", {})
        poke_id = _extract_id_from_url(poke_data.get("url", ""))

        # Only include Pokémon with valid IDs (skip forms/variants with high IDs)
        if poke_id and poke_id <= 1025:
            pokemon_list.append({
                "name": poke_data["name"],
                "id": poke_id,
                "sprite_url": SPRITE_URL_SMALL.format(id=poke_id),
            })

    # Sort by ID for consistent ordering
    pokemon_list.sort(key=lambda p: p["id"])

    _type_cache.set(cache_key, pokemon_list)
    return pokemon_list


def _format_stat_name(raw_name: str) -> str:
    """Convert API stat names to display-friendly format.

    Args:
        raw_name: Raw stat name from the API (e.g., 'special-attack').

    Returns:
        Formatted name (e.g., 'Sp. Atk').
    """
    stat_map = {
        "hp": "HP",
        "attack": "Attack",
        "defense": "Defense",
        "special-attack": "Sp. Atk",
        "special-defense": "Sp. Def",
        "speed": "Speed",
    }
    return stat_map.get(raw_name, raw_name.replace("-", " ").title())

def get_evolution_chain(chain_id: int) -> list[dict[str, Any]]:
    """Fetch the evolution chain for a Pokémon."""
    cache_key = f"evo:{chain_id}"
    cached = _pokemon_cache.get(cache_key)
    if cached is not None:
        return cached

    data = _make_request(f"/evolution-chain/{chain_id}")
    chain = []
    current = data.get("chain")
    while current:
        species_url = current["species"]["url"]
        poke_id = _extract_id_from_url(species_url)
        chain.append({
            "name": current["species"]["name"],
            "id": poke_id,
            "sprite_url": SPRITE_URL_SMALL.format(id=poke_id) if poke_id else None
        })
        if current.get("evolves_to"):
            current = current["evolves_to"][0]  # Simplification
        else:
            break
            
    _pokemon_cache.set(cache_key, chain)
    return chain


def get_pokemon_moves(name_or_id: str, count: int = 4) -> list[dict[str, Any]]:
    """Fetch battle-ready moves for a Pokémon.

    Selects the best damaging moves with highest power, ensuring type
    diversity. Falls back to 'Tackle' if no moves are available.

    Args:
        name_or_id: Pokémon name or ID.
        count: Number of moves to return (default 4).

    Returns:
        List of dicts with name, power, accuracy, pp, type, type_color,
        and damage_class for each move.
    """
    identifier = _sanitize_input(name_or_id)

    cache_key = f"moves:{identifier}"
    cached = _pokemon_cache.get(cache_key)
    if cached is not None:
        return cached

    data = _make_request(f"/pokemon/{identifier}")
    raw_moves = data.get("moves", [])
    pokemon_types = [t["type"]["name"] for t in data.get("types", [])]

    # Collect candidate move names (prefer level-up learned moves)
    candidates = []
    for m in raw_moves:
        move_name = m["move"]["name"]
        # Check if learnable by level-up
        level_up = any(
            vg.get("move_learn_method", {}).get("name") == "level-up"
            for vg in m.get("version_group_details", [])
        )
        candidates.append({"name": move_name, "level_up": level_up})

    if not candidates:
        # Fallback: tackle
        fallback = [{
            "name": "Tackle", "power": 40, "accuracy": 100, "pp": 35,
            "type": "normal", "type_color": TYPE_COLORS.get("normal", "#777"),
            "damage_class": "physical",
        }]
        _pokemon_cache.set(cache_key, fallback)
        return fallback

    # Fetch details for up to 10 candidate moves concurrently
    candidates.sort(key=lambda c: (0 if c["level_up"] else 1))
    to_fetch = candidates[:10]

    move_details = []
    
    import concurrent.futures
    def fetch_move(c):
        try:
            md = _make_request(f"/move/{c['name']}")
            power = md.get("power") or 0
            accuracy = md.get("accuracy") or 100
            pp = md.get("pp") or 5
            move_type = md.get("type", {}).get("name", "normal")
            damage_class = md.get("damage_class", {}).get("name", "physical")

            return {
                "name": c["name"].replace("-", " ").title(),
                "power": power,
                "accuracy": accuracy,
                "pp": pp,
                "type": move_type,
                "type_color": TYPE_COLORS.get(move_type, "#777"),
                "damage_class": damage_class,
                "is_stab": move_type in pokemon_types,
            }
        except Exception:
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        results = executor.map(fetch_move, to_fetch)
        for r in results:
            if r:
                move_details.append(r)

    # Filter: prefer damaging moves (power > 0)
    damaging = [m for m in move_details if m["power"] > 0]
    status_moves = [m for m in move_details if m["power"] == 0]

    # Sort damaging by effective power (STAB bonus considered)
    damaging.sort(key=lambda m: m["power"] * (1.5 if m["is_stab"] else 1), reverse=True)

    # Pick top moves: prefer variety of types
    selected = []
    seen_types = set()
    # First pass: one per type
    for m in damaging:
        if m["type"] not in seen_types and len(selected) < count:
            selected.append(m)
            seen_types.add(m["type"])
    # Fill remaining with strongest
    for m in damaging:
        if m not in selected and len(selected) < count:
            selected.append(m)

    # If still not enough, add status moves
    for m in status_moves:
        if len(selected) < count:
            selected.append(m)

    # Final fallback
    if not selected:
        selected = [{
            "name": "Tackle", "power": 40, "accuracy": 100, "pp": 35,
            "type": "normal", "type_color": TYPE_COLORS.get("normal", "#777"),
            "damage_class": "physical",
        }]

    # Remove helper field
    for m in selected:
        m.pop("is_stab", None)

    _pokemon_cache.set(cache_key, selected)
    return selected


def get_custom_moves(move_names: list[str]) -> list[dict[str, Any]]:
    """Fetch battle-ready details for a list of specific moves.
    
    Args:
        move_names: List of move names to fetch.
        
    Returns:
        List of dicts with name, power, accuracy, pp, type, type_color,
        and damage_class for each move requested.
    """
    if not move_names:
        return []
        
    move_details = []
    
    import concurrent.futures
    def fetch_move(name):
        # Clean the name just in case
        clean_name = name.lower().replace(" ", "-")
        try:
            # We don't cache individual moves here yet, since this is for the custom league feature
            md = _make_request(f"/move/{clean_name}")
            power = md.get("power") or 0
            accuracy = md.get("accuracy") or 100
            pp = md.get("pp") or 5
            move_type = md.get("type", {}).get("name", "normal")
            damage_class = md.get("damage_class", {}).get("name", "physical")

            return {
                "name": clean_name.replace("-", " ").title(),
                "power": power,
                "accuracy": accuracy,
                "pp": pp,
                "type": move_type,
                "type_color": TYPE_COLORS.get(move_type, "#777"),
                "damage_class": damage_class,
            }
        except Exception as e:
            print(f"Error fetching custom move {clean_name}: {e}")
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        results = executor.map(fetch_move, move_names)
        for r in results:
            if r:
                move_details.append(r)
                
    return move_details
