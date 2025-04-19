import os
import re
import json
import requests
import openai
import pandas as pd
import numpy as np
from joblib import dump
from dotenv import load_dotenv
from shapely.geometry import Point, Polygon
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error

# ────────────────────────── bootstrap & environment ──────────────────────────
print("Current working directory:", os.getcwd())
print("Loading .env file…")
load_dotenv(override=True)
print("Environment variables loaded")

# ──────────────────────────── 1. CRASH DATA → MODEL ─────────────────────────
def load_crash_data(filename: str) -> pd.DataFrame:
    data = pd.read_csv(filename, low_memory=False)
    return data[['latitude', 'longitude', 'crash_sev_id']].dropna()


def identify_crash_hotspots(data: pd.DataFrame, grid_size: float = 0.01) -> pd.DataFrame:
    data['lat_bin'] = (data['latitude'] // grid_size) * grid_size
    data['lng_bin'] = (data['longitude'] // grid_size) * grid_size
    return data.groupby(['lat_bin', 'lng_bin'])['crash_sev_id'].mean().reset_index()


def train_model(hotspot_data: pd.DataFrame):
    X = hotspot_data[['lat_bin', 'lng_bin']]
    y = hotspot_data['crash_sev_id']
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42)

    model = RandomForestRegressor(n_estimators=100, random_state=42)
    model.fit(X_tr, y_tr)

    mse = mean_squared_error(y_te, model.predict(X_te))
    print(f"Mean‑squared‑error on test data: {mse:.3f}")

    dump(model, 'trainedModel.joblib')
    print("Model saved to trainedModel.joblib")
    return model

# ─────────────────────── 2. GOOGLE ROUTES + SAFETY SCORE ─────────────────────
def get_google_routes(api_key: str, origin: str, destination: str):
    """Fetch driving routes (with alternatives) from Directions API."""
    base = "https://maps.googleapis.com/maps/api/directions/json"
    params = {
        "origin": origin,
        "destination": destination,
        "mode": "driving",
        "alternatives": "true",
        "key": api_key
    }
    resp = requests.get(base, params=params)
    try:
        data = resp.json()
    except ValueError:
        print(f"Bad JSON (HTTP {resp.status_code}): {resp.text}")
        return []

    print("Google Maps API status:", data.get("status"), "| HTTP", resp.status_code)
    if data.get("error_message"):
        print("Google Maps error_message:", data["error_message"])

    return data.get("routes", []) if resp.status_code == 200 and data.get("status") == "OK" else []


def calculate_safety_score(route: dict, model) -> tuple[float, float]:
    """Return (safety_score 1‑10, total_duration minutes)."""
    scores, total_min = [], 0
    for leg in route['legs']:
        total_min += leg['duration']['value'] / 60
        for step in leg['steps']:
            lat, lng = step['end_location'].values()
            df = pd.DataFrame([[lat, lng]], columns=['lat_bin', 'lng_bin'])
            scores.append(model.predict(df)[0])
    avg = np.mean(scores) if scores else 0
    return min(max(10 - avg, 1), 10), total_min

# ─────────────── 3. HOTSPOT HELPERS & ENHANCED INSTRUCTIONS ────────────────
def load_hotspot_polygons(geojson_path="output_files/high_crash_zones.geojson"):
    polygons = []
    try:
        with open(geojson_path) as f:
            gj = json.load(f)
        for feat in gj.get("features", []):
            coords = feat["geometry"]["coordinates"][0]
            polygons.append(Polygon([(lng, lat) for lat, lng in coords]))
    except Exception as exc:
        print("Error loading hotspot polygons:", exc)
    return polygons


_HOTSPOT_POLYGONS = load_hotspot_polygons()


def is_in_hotspot(lat: float, lng: float, buffer_m: int = 50) -> bool:
    buf_deg = buffer_m / 111_320.0     # meters → degrees (approx.)
    pt = Point(lng, lat)
    return any(poly.buffer(buf_deg).contains(pt) for poly in _HOTSPOT_POLYGONS)


def _strip_html(instr: str) -> str:
    txt = re.sub(r"<[^>]+>", "", instr)
    return txt.replace("&nbsp;", " ").strip()


_LEFT_CAUTIONS    = ["watch for oncoming traffic", "use extra care", "remain alert to cross‑traffic"]
_RIGHT_CAUTIONS   = ["yield to cyclists", "check for pedestrians", "stay aware of merging cars"]
_STRAIGHT_CAUTIONS = ["stay alert ahead", "maintain safe speed", "watch the road ahead"]


def _pick(choices: list[str], seed: str) -> str:
    return choices[abs(hash(seed)) % len(choices)]


def generate_enhanced_instruction(html_instruction: str, lat: float, lng: float,
                                  model_name: str = "gpt-3.5-turbo") -> str:
    """Return a concise, TTS‑friendly cue with contextual caution if in hotspot."""
    openai.api_key = os.getenv("OPENAI_API_KEY")

    alert = "High‑crash zone ahead. " if is_in_hotspot(lat, lng) else ""
    nav_plain = _strip_html(html_instruction)

    caution = ""
    if alert:
        if re.search(r"\bleft\b", nav_plain, re.I):
            caution = ", " + _pick(_LEFT_CAUTIONS, nav_plain) + "."
        elif re.search(r"\bright\b", nav_plain, re.I):
            caution = ", " + _pick(_RIGHT_CAUTIONS, nav_plain) + "."
        else:
            caution = ", " + _pick(_STRAIGHT_CAUTIONS, nav_plain) + "."
    spoken = f"{alert}{nav_plain}{caution}"

    if len(spoken.split()) <= 28:
        return spoken

    # If too long, ask GPT to condense
    prompt = (
        "Rewrite the following driving instruction so it is under 20 words, "
        "clear and TTS‑friendly. Keep units.\n\n"
        f"Instruction: \"{nav_plain}\""
    )
    try:
        resp = openai.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            top_p=0.9,
            max_tokens=40
        )
        short_nav = resp.choices[0].message.content.strip()
        return f"{alert}{short_nav}{caution}"
    except Exception as exc:
        print("LLM rephrase failed:", exc)
        return spoken

# ────────────────── 4. CONTINUOUS GPS DEMO VOICE UPDATE ──────────────────
def generate_voice_update(lat, lng, prev_lat, prev_lng,
                          model_name="gpt-3.5-turbo"):
    openai.api_key = os.getenv("OPENAI_API_KEY")

    if is_in_hotspot(lat, lng):
        return "High‑crash zone ahead. Proceed with caution."

    with open("topic_prompts/voice_route_demo_prompt.txt") as f:
        template = f.read()
    sys_msg, usr_tmpl = template.split("### User Message")
    usr_msg = usr_tmpl.strip().format(
        latitude=lat, longitude=lng,
        prev_latitude=prev_lat, prev_longitude=prev_lng
    )
    resp = openai.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": sys_msg.replace("### System Message", "").strip()},
            {"role": "user",   "content": usr_msg}
        ],
        temperature=0,
        top_p=0.1,
        max_tokens=30
    )
    return resp.choices[0].message.content.strip()

# ───────────────────────────── 5. CLI DEMO ─────────────────────────────
def main():
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key or api_key == "your_api_key_here":
        raise ValueError("GOOGLE_MAPS_API_KEY is missing or placeholder.")

    data = load_crash_data("data.csv")
    model = train_model(identify_crash_hotspots(data))

    routes = get_google_routes(api_key, "Austin, TX", "Houston, TX")
    scores = [calculate_safety_score(r, model) for r in routes]

    for i, (route, (score, dur)) in enumerate(zip(routes, scores), 1):
        print(f"Route {i}:  Safety {score:.2f}/10  •  {dur:.1f} min")
        for step in route['legs'][0]['steps'][:3]:
            print("  -", _strip_html(step['html_instructions']))
        print("…")

    safest = int(np.argmax([s for s, _ in scores]))
    print(f"Safest Route: {safest + 1}  ({scores[safest][0]:.2f}/10)")


if __name__ == "__main__":
    main()
