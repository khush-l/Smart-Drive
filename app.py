"""
Smart Drive AI - Backend Application
Handles route analysis, safety scoring, and AI chat functionality
"""

from flask import Flask, render_template, request, jsonify, session
from flask_session import Session
import openai
import os
from dotenv import load_dotenv
from Route_Safety import get_google_routes, calculate_safety_score, train_model, identify_crash_hotspots, load_crash_data
import logging
from openai import OpenAI

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

# Initialize Flask application
app = Flask(__name__)

# Configure session management
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
Session(app)

# Load API keys from environment variables
client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
google_maps_api_key = os.getenv('GOOGLE_MAPS_API_KEY')

# Set Flask secret key for session security
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'supersecretkey')

# Initialize the safety model on startup
print("Loading crash data and training model...")
crash_data = load_crash_data('data.csv')
hotspot_data = identify_crash_hotspots(crash_data)
safety_model = train_model(hotspot_data)
print("Model training complete!")

@app.route('/')
def home():
    """
    Home route - Renders the main page with the map interface
    """
    return render_template('index.html', google_maps_api_key=google_maps_api_key)

@app.route('/analyze_route', methods=['POST'])
def analyze_route():
    """
    Route analysis endpoint
    Takes start and end locations, finds routes, and calculates safety scores
    """
    data = request.json
    start_location = data.get('start')
    end_location = data.get('end')

    # Validate input
    if not start_location or not end_location:
        return jsonify({'error': 'Please provide both start and end locations'})

    try:
        # Get routes from Google Maps API
        routes = get_google_routes(google_maps_api_key, start_location, end_location)
        
        if not routes:
            return jsonify({'error': 'No routes found between the specified locations'})

        # Calculate safety scores for each route
        safety_scores = []
        durations = []
        for route in routes:
            score, duration = calculate_safety_score(route, safety_model)
            safety_scores.append(score)
            durations.append(duration)

        # Prepare route details for frontend display
        route_details = []
        for route, score, duration in zip(routes, safety_scores, durations):
            route_details.append({
                'safety_score': score,
                'duration': duration,
                'distance': route['legs'][0]['distance']['text'],
                'steps': [step['html_instructions'] for step in route['legs'][0]['steps'][:3]]  # First 3 steps
            })

        return jsonify({
            'routes': routes,
            'route_details': route_details
        })

    except Exception as e:
        app.logger.error(f"Error analyzing route: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/test_openai', methods=['GET'])
def test_openai():
    """
    Test endpoint for OpenAI API connection
    """
    try:
        logger.debug("Testing OpenAI API connection")
        # Simple test completion
        response = openai.chat.completions.create(
            model="gpt-3.5-turbo-1106",
            messages=[{"role": "user", "content": "Say 'Hello, testing 1-2-3'"}],
            max_tokens=20
        )
        return jsonify({
            'status': 'success',
            'message': response.choices[0].message.content,
            'api_key_set': bool(openai.api_key),
            'api_key_length': len(openai.api_key) if openai.api_key else 0
        })
    except Exception as e:
        logger.error(f"OpenAI test failed: {str(e)}", exc_info=True)
        return jsonify({
            'status': 'error',
            'error': str(e),
            'api_key_set': bool(openai.api_key),
            'api_key_length': len(openai.api_key) if openai.api_key else 0
        }), 500

@app.route('/chat', methods=['POST'])
def chat():
    """
    Chat endpoint - Handles conversation with the AI assistant
    """
    try:
        # Get the user's message
        user_message = request.json.get('message')
        if not user_message:
            return jsonify({'error': 'No message provided'}), 400

        # Initialize conversation history if not exists
        if 'conversation' not in session:
            session['conversation'] = []

        # Read the initial prompt from the file
        try:
            logger.debug("Reading initial prompt file")
            with open('topic_prompts/initial_prompt.txt', 'r') as file:
                initial_prompt = file.read()
            logger.debug("Successfully read initial prompt")
        except FileNotFoundError:
            logger.error("Initial prompt file not found")
            return jsonify({'error': 'Initial prompt file not found. Please check server configuration.'}), 500

        # Prepare messages for OpenAI API
        messages = [{
            "role": "system",
            "content": initial_prompt
        }]

        # Add conversation history
        for msg in session['conversation']:
            logger.debug(f"Adding message to history: {msg}")
            messages.append({
                "role": str(msg["role"]),
                "content": str(msg["content"])
            })

        # Add the new user message
        messages.append({
            "role": "user",
            "content": str(user_message)
        })

        logger.debug(f"Final messages array: {messages}")

        try:
            # Make API call to OpenAI
            logger.debug("Calling OpenAI API")
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=messages,
                temperature=0.7,
                max_tokens=500
            )
            logger.debug("Successfully received OpenAI API response")
            
            # Extract the content from the response
            gpt_response = response.choices[0].message.content
            logger.debug(f"Generated response length: {len(gpt_response)}")

            # Append the GPT response to the conversation history
            session['conversation'].append({
                "role": "assistant",
                "content": str(gpt_response)
            })

            # Keep conversation history limited to last 10 messages
            if len(session['conversation']) > 10:
                logger.debug("Trimming conversation history")
                session['conversation'] = session['conversation'][-10:]

            return jsonify({'response': gpt_response})

        except Exception as e:
            logger.error(f"OpenAI API Error: {str(e)}")
            return jsonify({'error': f'OpenAI API Error: {str(e)}'}), 500

    except Exception as e:
        logger.error(f"General error in chat endpoint: {str(e)}", exc_info=True)
        return jsonify({'error': f'General error: {str(e)}'}), 500

@app.route('/clear_session', methods=['GET'])
def clear_session():
    """
    Clear session endpoint - Resets the conversation history
    """
    session.clear()
    return jsonify({'status': 'session cleared'})

if __name__ == '__main__':
    # Run the Flask application
    app.run(host="0.0.0.0", port=8080)