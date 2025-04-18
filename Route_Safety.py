import pandas as pd
import numpy as np
import json
import requests
import openai
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error
from geopy.distance import geodesic
from shapely.geometry import Point, Polygon
from sklearn.preprocessing import StandardScaler
import os
from joblib import dump
from dotenv import load_dotenv

# Force reload environment variables
print("Current working directory:", os.getcwd())
print("Loading .env file...")
load_dotenv(override=True)
print("Environment variables loaded")

# 1. Processing Crash Data and Training the AI Model

def load_crash_data(filename):
    data = pd.read_csv(filename, low_memory=False)
    data = data[['latitude', 'longitude', 'crash_sev_id', 'Crash timestamp (US/Central)']].dropna()
    return data


def identify_crash_hotspots(data, grid_size=0.01):
    data['lat_bin'] = (data['latitude'] // grid_size) * grid_size
    data['lng_bin'] = (data['longitude'] // grid_size) * grid_size

    hotspot_severity = data.groupby(['lat_bin', 'lng_bin'])['crash_sev_id'].mean().reset_index()
    return hotspot_severity


def train_model(hotspot_data):
    X = hotspot_data[['lat_bin', 'lng_bin']]
    y = hotspot_data['crash_sev_id']

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = RandomForestRegressor(n_estimators=100, random_state=42)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    mse = mean_squared_error(y_test, y_pred)
    print(f'Mean Squared Error on test data: {mse}')

    model_file_path = 'trainedModel.joblib'
    dump(model, model_file_path)
    print(f"Model saved to {model_file_path}")
    return model


# 2. Fetching Routes and Evaluating with AI Model

def get_google_routes(api_key, origin, destination):
    """
    Fetch driving routes (including alternatives) from Google Directions API
    and log both HTTP and API-level status messages for debugging.
    """
    base_url = "https://maps.googleapis.com/maps/api/directions/json"
    params = {
        "origin":      origin,
        "destination": destination,
        "mode":        "driving",
        "alternatives": "true",
        "key":         api_key
    }

    response = requests.get(base_url, params=params)

    try:
        data = response.json()
    except ValueError:
        print(f"Failed to parse JSON (HTTP {response.status_code}): {response.text}")
        return []

    api_status = data.get("status")
    error_message = data.get("error_message")
    print(f"Google Maps API status: {api_status}")
    if error_message:
        print(f"Google Maps error_message: {error_message}")

    if response.status_code == 200 and api_status == "OK":
        routes = data.get("routes", [])
        print(f"Found {len(routes)} route options.")
        return routes
    else:
        print(f"Directions request failed: HTTP {response.status_code}, API status = {api_status}")
        return []


def calculate_safety_score(route, model):
    scores = []
    total_duration = 0

    for leg in route['legs']:
        total_duration += leg['duration']['value'] / 60  # minutes
        for step in leg['steps']:
            lat = step['end_location']['lat']
            lng = step['end_location']['lng']
            df = pd.DataFrame([[lat, lng]], columns=['lat_bin', 'lng_bin'])
            safety_score = model.predict(df)[0]
            scores.append(safety_score)

    avg_score = np.mean(scores) if scores else 0
    return min(max(10 - avg_score, 1), 10), total_duration


# --- New voice-first functionality ---

def load_hotspot_polygons(geojson_path="output_files/high_crash_zones.geojson"):
    """
    Load crash-hotspot polygons from a GeoJSON file.
    """
    polygons = []
    try:
        with open(geojson_path) as f:
            gj = json.load(f)
        for feat in gj.get("features", []):
            coords = feat["geometry"]["coordinates"][0]
            poly = Polygon([(lng, lat) for lat, lng in coords])
            polygons.append(poly)
    except Exception as e:
        print(f"Error loading hotspot polygons: {e}")
    return polygons

# Pre-load hotspot polygons once
_HOTSPOT_POLYGONS = load_hotspot_polygons()


def is_in_hotspot(lat, lng, buffer_m=50):
    """
    Check if a coordinate lies within or near (buffer_m) any crash-hotspot polygon.
    """
    buffer_deg = buffer_m / 111320.0  # approximate meters to degrees
    point = Point(lng, lat)
    for poly in _HOTSPOT_POLYGONS:
        if poly.buffer(buffer_deg).contains(point):
            return True
    return False


def generate_voice_update(lat, lng, prev_lat, prev_lng, model_name="gpt-3.5-turbo"):
    """
    Generate a concise, TTS-friendly voice update for the given coordinate.
    If within a hotspot, return a warning immediately; otherwise, call the LLM.
    """
    openai.api_key = os.getenv("OPENAI_API_KEY")

    # Pre-check crash zone
    if is_in_hotspot(lat, lng):
        return "Alert: High‑crash zone ahead. Proceed with caution."

    # Read and split the prompt template
    prompt_file = "topic_prompts/voice_route_demo_prompt.txt"
    with open(prompt_file) as f:
        content = f.read()
    system_part, user_part = content.split("### User Message")
    system_content = system_part.replace("### System Message", "").strip()
    user_template = user_part.strip()

    # Fill in dynamic coordinates
    user_content = user_template.format(
        latitude=lat,
        longitude=lng,
        prev_latitude=prev_lat,
        prev_longitude=prev_lng
    )

    messages = [
        {"role": "system", "content": system_content},
        {"role": "user",   "content": user_content}
    ]

    resp = openai.chat.completions.create(
        model=model_name,
        messages=messages,
        temperature=0,
        top_p=0.1
    )
    return resp.choices[0].message.content.strip()

# --- End voice-first functionality ---

# Putting it all together

def main():
    try:
        with open('.env', 'r') as f:
            for line in f:
                if line.startswith('GOOGLE_MAPS_API_KEY='):
                    api_key = line.strip().split('=')[1]
                    break
    except Exception as e:
        print(f"Error reading .env file: {e}")
        api_key = os.getenv('GOOGLE_MAPS_API_KEY')

    print(f"Loaded API key: {api_key}")
    print(f"Loaded API key length: {len(api_key) if api_key else 0}")
    print(f"API key starts with: {api_key[:5] if api_key else 'None'}")

    if not api_key:
        raise ValueError("GOOGLE_MAPS_API_KEY environment variable is not set. Please check your .env file.")
    if api_key == "your_api_key_here":
        raise ValueError("You still have the placeholder API key in your .env file. Please replace it with your actual API key.")

    crash_data_file = 'data.csv'
    data = load_crash_data(crash_data_file)
    hotspot_data = identify_crash_hotspots(data)
    model = train_model(hotspot_data)

    routes = get_google_routes(api_key, "Austin, TX", "Houston, TX")
    safety_scores_and_times = [calculate_safety_score(route, model) for route in routes]

    for i, (route, (score, duration)) in enumerate(zip(routes, safety_scores_and_times)):
        print(f"Route {i + 1}: Safety Score {score:.2f}/10, Estimated Time: {duration:.2f} mins")
        print("Route Summary:")
        for leg in route['legs']:
            for step in leg['steps'][:3]:
                print(f"  - {step['html_instructions']} ({step['distance']['text']}, {step['duration']['text']})")
            print("...")

    safest_route_idx = np.argmax([score for score, _ in safety_scores_and_times])
    print(f"Safest Route: {safest_route_idx + 1} with Safety Score: {safety_scores_and_times[safest_route_idx][0]:.2f}/10, Estimated Time: {safety_scores_and_times[safest_route_idx][1]:.2f} mins")


if __name__ == "__main__":
    main()
