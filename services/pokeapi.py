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

    # Normalize the response for template consumption
    detail = {
        "id": data["id"],
        "name": data["name"],
        "height": data["height"] / 10,  # Convert to meters
        "weight": data["weight"] / 10,  # Convert to kilograms
        "base_experience": data.get("base_experience", "N/A"),
        "sprite_url": SPRITE_URL.format(id=data["id"]),
        "sprite_small": SPRITE_URL_SMALL.format(id=data["id"]),
        "types": [
            {
                "name": t["type"]["name"],
                "color": TYPE_COLORS.get(t["type"]["name"], "#777"),
            }
            for t in data.get("types", [])
        ],
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
