"""Quick verification script for the Pokédex app."""
import requests

BASE = "http://127.0.0.1:5000"
results = []

def test(name, url, expect_code=200, check_text=None, follow=True):
    try:
        r = requests.get(url, allow_redirects=follow, timeout=15)
        status = "PASS" if r.status_code == expect_code else "FAIL"
        extra = ""
        if check_text and status == "PASS":
            if check_text.lower() not in r.text.lower():
                status = "FAIL"
                extra = f" (missing '{check_text}')"
        results.append(f"  [{status}] {name}: HTTP {r.status_code}{extra}")
    except Exception as e:
        results.append(f"  [FAIL] {name}: {e}")

print("=== Pokédex App Verification ===\n")

test("Home page", f"{BASE}/", check_text="bulbasaur")
test("Page 2", f"{BASE}/?page=2", check_text="Siguiente")
test("Detail (bulbasaur)", f"{BASE}/pokemon/bulbasaur", check_text="Bulbasaur")
test("Detail (by ID)", f"{BASE}/pokemon/25", check_text="pikachu")
test("Type filter (fire)", f"{BASE}/?type=fire", check_text="charmander")
test("Search redirect", f"{BASE}/search?q=pikachu", expect_code=302, follow=False)
test("404 handling", f"{BASE}/pokemon/notarealpokemon999", expect_code=404, check_text="no encontrado")
test("Invalid route", f"{BASE}/nonexistent", expect_code=404)

for r in results:
    print(r)

passed = sum(1 for r in results if "[PASS]" in r)
total = len(results)
print(f"\n  Result: {passed}/{total} tests passed")
