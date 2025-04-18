from flask import Flask, render_template, request, jsonify, session, Response
from flask_session import Session
import openai
import os
from dotenv import load_dotenv
from Route_Safety import (
    get_google_routes,
    calculate_safety_score,
    train_model,
    identify_crash_hotspots,
    load_crash_data,
    generate_voice_update
)
import logging
import json

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

# API Keys from environment
openai.api_key = os.getenv('OPENAI_API_KEY')
google_maps_api_key = os.getenv('GOOGLE_MAPS_API_KEY')

# Voice & transcription model configs
VOICE_MODEL = os.getenv('VOICE_MODEL', 'gpt-3.5-turbo')
WHISPER_MODEL = os.getenv('WHISPER_MODEL', 'whisper-1')

# Initialize the safety model on startup
print("Loading crash data and training model...")
crash_data = load_crash_data('data.csv')
hotspot_data = identify_crash_hotspots(crash_data)
safety_model = train_model(hotspot_data)
print("Model training complete!")

@app.route('/')
def home():
    return render_template('index.html', google_maps_api_key=google_maps_api_key)

@app.route('/analyze_route', methods=['POST'])
def analyze_route():
    data = request.json
    start_location = data.get('start')
    end_location = data.get('end')
    if not start_location or not end_location:
        return jsonify({'error': 'Please provide both start and end locations'}), 400
    try:
        routes = get_google_routes(google_maps_api_key, start_location, end_location)
        if not routes:
            return jsonify({'error': 'No routes found between the specified locations'}), 404
        route_details = []
        for route in routes:
            score, duration = calculate_safety_score(route, safety_model)
            route_details.append({
                'safety_score': score,
                'duration': duration,
                'distance': route['legs'][0]['distance']['text'],
                'steps': [step['html_instructions'] for step in route['legs'][0]['steps'][:3]]
            })
        return jsonify({'routes': routes, 'route_details': route_details})
    except Exception as e:
        logger.error(f"Error analyzing route: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/stream_route', methods=['POST'])
def stream_route():
    """
    Stream voice-first driving updates via Server-Sent Events.
    Accepts JSON with either:
      - 'gps_sequence': list of {latitude, longitude}
      - or 'start' and 'end' to fetch a route and extract step coordinates.
    """
    data = request.json or {}
    gps_sequence = data.get('gps_sequence')
    if not gps_sequence:
        start = data.get('start')
        end = data.get('end')
        if not start or not end:
            return jsonify({'error': 'Provide gps_sequence or start and end locations'}), 400
        routes = get_google_routes(google_maps_api_key, start, end)
        if not routes:
            return jsonify({'error': 'No routes found'}), 404
        gps_sequence = [
            {'latitude': step['end_location']['lat'], 'longitude': step['end_location']['lng']}
            for step in routes[0]['legs'][0]['steps']
        ]

    def event_stream():
        prev = gps_sequence[0]
        for coord in gps_sequence:
            lat = coord['latitude']
            lng = coord['longitude']
            update = generate_voice_update(lat, lng, prev['latitude'], prev['longitude'], model_name=VOICE_MODEL)
            data_packet = {'text': update, 'latitude': lat, 'longitude': lng}
            yield f"data: {json.dumps(data_packet)}\n\n"
            prev = coord

    return Response(event_stream(), mimetype='text/event-stream')

@app.route('/voice_input', methods=['POST'])
def voice_input():
    """
    Transcribe uploaded audio via Whisper and return the transcript.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No audio file part'}), 400
    file = request.files['file']
    try:
        transcript_resp = openai.Audio.transcribe(
            model=WHISPER_MODEL,
            file=file
        )
        text = transcript_resp.get('text', '')
        return jsonify({'transcript': text})
    except Exception as e:
        logger.error(f"Whisper transcription failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/test_openai', methods=['GET'])
def test_openai():
    try:
        logger.debug("Testing OpenAI API connection")
        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": "Say 'Hello, testing'"}],
            max_tokens=20
        )
        return jsonify({
            'status': 'success',
            'message': response.choices[0].message.content,
            'api_key_set': bool(openai.api_key)
        })
    except Exception as e:
        logger.error(f"OpenAI test failed: {e}")
        return jsonify({'status':'error','error':str(e)}),500

@app.route('/chat', methods=['POST'])
def chat():
    try:
        user_message = request.json.get('message')
        if not user_message:
            return jsonify({'error':'No message provided'}),400
        if 'conversation' not in session:
            session['conversation'] = []
        try:
            with open('topic_prompts/initial_prompt.txt') as f:
                initial_prompt = f.read()
        except FileNotFoundError:
            return jsonify({'error':'Initial prompt file not found'}),500
        messages = [{"role":"system","content":initial_prompt}]
        messages += session['conversation'][-10:]
        messages.append({"role":"user","content":user_message})
        resp = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=messages,
            temperature=0.7,
            max_tokens=500
        )
        gpt_content = resp.choices[0].message.content
        session['conversation'].append({"role":"assistant","content":gpt_content})
        session.modified = True
        return jsonify({'response':gpt_content})
    except Exception as e:
        logger.error(f"Chat endpoint error: {e}")
        return jsonify({'error':str(e)}),500

@app.route('/clear_session', methods=['GET'])
def clear_session():
    session.clear()
    return jsonify({'status':'session cleared'})

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=8080)
