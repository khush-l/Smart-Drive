import pandas as pd
import numpy as np
import json
import requests
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
    base_url = "https://maps.googleapis.com/maps/api/directions/json"
    params = {
        "origin": origin,
        "destination": destination,
        "mode": "driving",
        "alternatives": "true",
        "key": api_key
    }

    response = requests.get(base_url, params=params)

    if response.status_code == 200:
        routes = response.json().get("routes", [])
        print(f"Found {len(routes)} route options.")
        return routes
    else:
        print(f"Error: {response.status_code} - {response.text}")
        return []


def calculate_safety_score(route, model):
    scores = []
    total_duration = 0

    for leg in route['legs']:
        total_duration += leg['duration']['value'] / 60  # Convert to minutes
        for step in leg['steps']:
            lat = step['end_location']['lat']
            lng = step['end_location']['lng']
            safety_score = model.predict(np.array([[lat, lng]]))[0]
            scores.append(safety_score)

    avg_score = np.mean(scores) if scores else 0
    return min(max(10 - avg_score, 1), 10), total_duration


# Putting it all together

def main():
    # Try to get the API key directly from the file first
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
        

    # 3. Crash Data Processing and Model Training
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
            for step in leg['steps'][:3]:  # Show first few steps for brevity
                print(f"  - {step['html_instructions']} ({step['distance']['text']}, {step['duration']['text']})")
            print("...")

    safest_route_idx = np.argmax([score for score, _ in safety_scores_and_times])
    print(f"Safest Route: {safest_route_idx + 1} with Safety Score: {safety_scores_and_times[safest_route_idx][0]:.2f}/10, Estimated Time: {safety_scores_and_times[safest_route_idx][1]:.2f} mins")


if __name__ == "__main__":
    main()

