import pytest
import numpy as np
import pandas as pd
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from Route_Safety import load_crash_data, identify_crash_hotspots, train_model, calculate_safety_score, get_google_routes
from unittest.mock import patch

@pytest.fixture
def sample_crash_data():
    """Create sample crash data for testing"""
    return pd.DataFrame({
        'latitude': [
            30.2672, 30.2772, 30.2872, 30.2972, 30.3072,  # Different lat bins
            30.3172, 30.3272, 30.3372, 30.3472, 30.3572
        ],
        'longitude': [
            -97.7431, -97.7531, -97.7631, -97.7731, -97.7831,  # Different lng bins
            -97.7931, -97.8031, -97.8131, -97.8231, -97.8331
        ],
        'crash_sev_id': [1, 2, 3, 2, 1, 3, 2, 1, 3, 2],
        'Crash timestamp (US/Central)': [
            '2023-01-01', '2023-01-02', '2023-01-03', '2023-01-04', '2023-01-05',
            '2023-01-06', '2023-01-07', '2023-01-08', '2023-01-09', '2023-01-10'
        ]
    })

@pytest.fixture
def sample_route():
    """Create a sample route for testing"""
    return {
        'legs': [{
            'duration': {'value': 600},
            'steps': [{
                'end_location': {'lat': 30.2672, 'lng': -97.7431},
                'html_instructions': 'Test step'
            }]
        }]
    }

def test_load_crash_data(sample_crash_data, tmp_path):
    """Test loading crash data"""
    # Save sample data to temporary file
    file_path = tmp_path / "test_data.csv"
    sample_crash_data.to_csv(file_path, index=False)
    
    # Test loading
    loaded_data = load_crash_data(str(file_path))
    assert isinstance(loaded_data, pd.DataFrame)
    assert len(loaded_data) == 10
    assert 'latitude' in loaded_data.columns
    assert 'longitude' in loaded_data.columns

def test_load_crash_data_invalid_file(tmp_path):
    """Test loading crash data with invalid file"""
    with pytest.raises(Exception):
        load_crash_data(str(tmp_path / "nonexistent.csv"))

def test_identify_crash_hotspots(sample_crash_data):
    """Test hotspot identification"""
    hotspots = identify_crash_hotspots(sample_crash_data)
    assert isinstance(hotspots, pd.DataFrame)
    assert 'lat_bin' in hotspots.columns
    assert 'lng_bin' in hotspots.columns
    assert 'crash_sev_id' in hotspots.columns

def test_train_model(sample_crash_data):
    """Test model training"""
    hotspots = identify_crash_hotspots(sample_crash_data)
    model = train_model(hotspots)
    assert model is not None
    # Test prediction
    test_input = np.array([[30.2672, -97.7431]])
    prediction = model.predict(test_input)
    assert isinstance(prediction, np.ndarray)
    assert len(prediction) == 1

def test_calculate_safety_score(sample_route):
    """Test safety score calculation"""
    with patch('Route_Safety.train_model') as mock_model:
        mock_model.return_value.predict.return_value = np.array([2.5])
        score, duration = calculate_safety_score(sample_route, mock_model.return_value)
        assert isinstance(score, float)
        assert isinstance(duration, float)
        assert 1 <= score <= 10
        assert duration > 0

def test_get_google_routes():
    """Test Google Maps API route fetching"""
    with patch('requests.get') as mock_get:
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = {
            "routes": [{
                "legs": [{
                    "distance": {"text": "10 miles"},
                    "duration": {"value": 600},
                    "steps": [{"html_instructions": "Test step"}]
                }]
            }]
        }
        routes = get_google_routes("test_key", "Austin, TX", "Houston, TX")
        assert isinstance(routes, list)
        assert len(routes) == 1

def test_get_google_routes_error():
    """Test Google Maps API error handling"""
    with patch('requests.get') as mock_get:
        mock_get.return_value.status_code = 400
        routes = get_google_routes("test_key", "Austin, TX", "Houston, TX")
        assert routes == [] 