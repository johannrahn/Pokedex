"""
Pokédex Read-Only Web Application.

A Flask application that consumes the PokeAPI to display Pokémon
information. Fully read-only — no database, no local storage.
"""

from flask import (
    Flask,
    jsonify,
    render_template,
    request,
    redirect,
    url_for,
)

from config import PAGE_SIZE, TYPE_COLORS
from services.pokeapi import (
    PokeAPIError,
    get_pokemon_by_type,
    get_pokemon_detail,
    get_pokemon_list,
    get_pokemon_moves,
    get_custom_moves,
    get_types,
    get_evolution_chain,
    _make_request,
    _extract_id_from_url,
)
from config import SPRITE_URL_SMALL

app = Flask(__name__)
app.secret_key = "pokedex-readonly-secret-key"


# ── Context Processor ─────────────────────────────────────────

@app.context_processor
def inject_globals() -> dict:
    """Inject global variables available in all templates."""
    try:
        types = get_types()
    except PokeAPIError:
        types = []

    return {
        "available_types": types,
        "type_colors": TYPE_COLORS,
    }


# ── HTML Routes ───────────────────────────────────────────────

@app.route("/")
def index():
    """Home page with paginated Pokémon listing and optional type filter."""
    page = request.args.get("page", 1, type=int)
    type_filter = request.args.get("type", "", type=str).strip().lower()

    page = max(1, page)
    offset = (page - 1) * PAGE_SIZE

    try:
        if type_filter:
            all_pokemon = get_pokemon_by_type(type_filter)
            total = len(all_pokemon)
            pokemon_slice = all_pokemon[offset : offset + PAGE_SIZE]

            result = {
                "pokemon": pokemon_slice,
                "total": total,
                "has_next": offset + PAGE_SIZE < total,
                "has_prev": page > 1,
            }
        else:
            result = get_pokemon_list(limit=PAGE_SIZE, offset=offset)

        return render_template(
            "index.html",
            pokemon_list=result["pokemon"],
            total=result["total"],
            page=page,
            page_size=PAGE_SIZE,
            has_next=result["has_next"],
            has_prev=result["has_prev"],
            current_type=type_filter,
        )

    except PokeAPIError as exc:
        return render_template(
            "error.html",
            error_code=exc.status_code or 500,
            error_title="Error al cargar Pokémon",
            error_message=exc.message,
        ), exc.status_code or 500


@app.route("/pokemon/<name_or_id>")
def detail(name_or_id: str):
    """Detail page for a specific Pokémon."""
    try:
        pokemon = get_pokemon_detail(name_or_id)
        return render_template("detail.html", pokemon=pokemon)

    except PokeAPIError as exc:
        status = exc.status_code or 500
        return render_template(
            "error.html",
            error_code=status,
            error_title="Pokémon no encontrado" if status == 404 else "Error",
            error_message=exc.message,
        ), status


@app.route("/search")
def search():
    """Process search form and redirect to Pokémon detail."""
    query = request.args.get("q", "").strip()

    if not query:
        return redirect(url_for("index"))

    return redirect(url_for("detail", name_or_id=query.lower()))


@app.route("/batalla")
def batalla():
    """Battle arena page — compare two Pokémon side by side."""
    p1 = request.args.get("p1", "").strip().lower()
    p2 = request.args.get("p2", "").strip().lower()
    return render_template("batalla.html", p1_name=p1, p2_name=p2)


@app.route("/liga")
def liga():
    """Auto Pokemon League Minigame."""
    return render_template("liga.html")


@app.route("/stats")
def stats():
    """League statistics dashboard."""
    return render_template("stats.html")


# ── JSON API Routes ───────────────────────────────────────────

@app.route("/api/pokemon-list")
def api_pokemon_list():
    """JSON endpoint for paginated Pokémon list (used by Load More / type filter JS)."""
    offset = request.args.get("offset", 0, type=int)
    limit = request.args.get("limit", PAGE_SIZE, type=int)
    type_filter = request.args.get("type", "", type=str).strip().lower()

    limit = min(max(1, limit), 100)  # clamp 1–100

    try:
        if type_filter:
            all_pokemon = get_pokemon_by_type(type_filter)
            total = len(all_pokemon)
            pokemon_slice = all_pokemon[offset : offset + limit]
            result = {
                "pokemon": pokemon_slice,
                "total": total,
                "has_next": offset + limit < total,
            }
        else:
            result = get_pokemon_list(limit=limit, offset=offset)

        return jsonify({
            "pokemon": result["pokemon"],
            "total": result["total"],
            "has_next": result["has_next"],
            "offset": offset,
            "limit": limit,
        })

    except PokeAPIError as exc:
        return jsonify({"error": exc.message}), exc.status_code or 500


@app.route("/api/pokemon/all")
def api_pokemon_all():
    """JSON endpoint for all Pokémon (used by client-side advanced filters)."""
    type_filter = request.args.get("type", "", type=str).strip().lower()

    try:
        if type_filter:
            all_pokemon = get_pokemon_by_type(type_filter)
            return jsonify({"pokemon": all_pokemon, "total": len(all_pokemon)})
        else:
            # Maximum valid ID up to Paldea is 1025
            result = get_pokemon_list(limit=1025, offset=0)
            return jsonify({
                "pokemon": result["pokemon"],
                "total": result["total"]
            })
    except PokeAPIError as exc:
        return jsonify({"error": exc.message}), exc.status_code or 500


@app.route("/api/evolution/<int:chain_id>")
def api_evolution(chain_id: int):
    """JSON endpoint for a Pokémon's evolution chain."""
    try:
        chain = get_evolution_chain(chain_id)
        return jsonify(chain)
    except PokeAPIError as exc:
        return jsonify({"error": exc.message}), exc.status_code or 500


@app.route("/api/pokemon/<name_or_id>")
def api_pokemon_detail(name_or_id: str):
    """JSON endpoint for a single Pokémon's details."""
    try:
        pokemon = get_pokemon_detail(name_or_id)
        return jsonify(pokemon)
    except PokeAPIError as exc:
        return jsonify({"error": exc.message}), exc.status_code or 500


@app.route("/api/pokemon/<name_or_id>/moves")
def api_pokemon_moves(name_or_id: str):
    """JSON endpoint for a Pokémon's battle-ready moves."""
    try:
        moves = get_pokemon_moves(name_or_id)
        return jsonify({"moves": moves})
    except PokeAPIError as exc:
        return jsonify({"error": exc.message}), exc.status_code or 500


@app.route("/api/custom-moves", methods=["GET", "POST"])
def api_custom_moves():
    """JSON endpoint for specific moves details."""
    if request.method == "POST":
        data = request.get_json() or {}
        moves_list = data.get("moves", [])
    else:
        moves_str = request.args.get("moves", "")
        if not moves_str:
            return jsonify({"moves": []})
            
        moves_list = [m.strip() for m in moves_str.split(",") if m.strip()]
    try:
        moves = get_custom_moves(moves_list)
        return jsonify({"moves": moves})
    except PokeAPIError as exc:
        return jsonify({"error": exc.message}), exc.status_code or 500

@app.route("/api/ability/<ability_name>")
def api_ability_pokemon(ability_name: str):
    """JSON endpoint: returns Pokémon that have a given ability."""
    cleaned = ability_name.strip().lower().replace(" ", "-")

    if not cleaned or len(cleaned) > 60:
        return jsonify({"error": "Nombre de habilidad inválido."}), 400

    try:
        data = _make_request(f"/ability/{cleaned}")
        pokemon_entries = data.get("pokemon", [])

        pokemon_list = []
        for entry in pokemon_entries:
            poke_data = entry.get("pokemon", {})
            poke_id = _extract_id_from_url(poke_data.get("url", ""))
            if poke_id and poke_id <= 1025:
                pokemon_list.append({
                    "name": poke_data["name"],
                    "id": poke_id,
                    "sprite_url": SPRITE_URL_SMALL.format(id=poke_id),
                })

        pokemon_list.sort(key=lambda p: p["id"])

        # Grab English flavor text for the ability description
        flavor_entries = data.get("flavor_text_entries", [])
        description = ""
        for fe in flavor_entries:
            if fe.get("language", {}).get("name") == "en":
                description = fe.get("flavor_text", "").replace("\n", " ").replace("\f", " ")
                break

        display_name = data.get("name", cleaned).replace("-", " ").title()

        return jsonify({
            "name": display_name,
            "description": description,
            "pokemon": pokemon_list[:30],  # cap at 30 for UX
            "total": len(pokemon_list),
        })

    except PokeAPIError as exc:
        return jsonify({"error": exc.message}), exc.status_code or 500


# ── Error Handlers ────────────────────────────────────────────

@app.errorhandler(404)
def page_not_found(error):
    """Handle 404 errors with a friendly page."""
    return render_template(
        "error.html",
        error_code=404,
        error_title="Página no encontrada",
        error_message="La página que buscas no existe.",
    ), 404


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors with a friendly page."""
    return render_template(
        "error.html",
        error_code=500,
        error_title="Error interno",
        error_message="Ocurrió un error inesperado. Intenta de nuevo más tarde.",
    ), 500


# ── Entry Point ───────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True, port=5000)
