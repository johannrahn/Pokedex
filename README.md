# Pokédex Read-Only Web App

Aplicación web de portafolio construida con Flask que consume la [PokeAPI](https://pokeapi.co/) para mostrar información detallada de Pokémon. Completamente **read-only** — sin base de datos, sin almacenamiento local.

## ✨ Características

- **Listado paginado** de Pokémon con sprites
- **Búsqueda** por nombre o ID
- **Filtrado por tipo** (fuego, agua, planta, etc.)
- **Página de detalle** con artwork oficial, tipos, habilidades y estadísticas
- **Cache en memoria** con TTL configurable para optimizar llamadas a la API
- **Manejo de errores** amigable (404, timeouts, API caída)

## 🏗️ Arquitectura

```
Templates (Jinja2) → Flask Routes → Service Layer → PokeAPI
```

| Capa | Archivo | Responsabilidad |
|------|---------|----------------|
| Config | `config.py` | Constantes centralizadas |
| Cache | `services/cache.py` | TTLCache thread-safe |
| API Client | `services/pokeapi.py` | Comunicación con PokeAPI |
| Routes | `app.py` | Rutas HTTP y error handlers |
| UI | `templates/`, `static/` | Interfaz con Bootstrap 5 |

## 🚀 Instalación

```bash
# 1. Crear entorno virtual
python -m venv venv
venv\Scripts\activate    # Windows
# source venv/bin/activate  # Linux/Mac

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Ejecutar
python app.py
```

Abre http://127.0.0.1:5000 en tu navegador.

## 🛠️ Tecnologías

- **Python 3.11+** / Flask / Requests
- **Jinja2** Templates
- **Bootstrap 5** + CSS personalizado
- **PokeAPI v2** (API externa)
