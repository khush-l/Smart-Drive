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
    generate_voice_update,
    generate_enhanced_instruction
)
import logging
import json

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Initialize Flask
app = Flask(__name__)
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
Session(app)

# API keys
openai.api_key = os.getenv('OPENAI_API_KEY')
google_maps_api_key = os.getenv('GOOGLE_MAPS_API_KEY')
VOICE_MODEL = os.getenv('VOICE_MODEL', 'gpt-3.5-turbo')

# Train safety model on startup
logger.info("Loading crash data and training model...")
crash_data = load_crash_data('data.csv')
hotspot_data = identify_crash_hotspots(crash_data)
safety_model = train_model(hotspot_data)
logger.info("Model training complete!")

@app.route('/')
def home():
    return render_template('index.html', google_maps_api_key=google_maps_api_key)

@app.route('/analyze_route', methods=['POST'])
def analyze_route():
    data = request.json or {}
    start = data.get('start')
    end = data.get('end')
    if not start or not end:
        return jsonify({'error': 'Please provide both start and end locations'}), 400

    try:
        routes = get_google_routes(google_maps_api_key, start, end)
        if not routes:
            return jsonify({'error': 'No routes found'}), 404

        details = []
        for route in routes:
            score, duration = calculate_safety_score(route, safety_model)
            details.append({
                'safety_score': score,
                'duration':     duration,
                'distance':     route['legs'][0]['distance']['text'],
                'steps':        [step['html_instructions'] for step in route['legs'][0]['steps'][:3]]
            })

        return jsonify({'routes': routes, 'route_details': details})
    except Exception as e:
        logger.error(f"Error in analyze_route: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/stream_route', methods=['POST'])
def stream_route():
    """
    Dual‐mode SSE endpoint:
      - If client sends a `gps_sequence`, we drive simulation mode,
        generating voice updates via generate_voice_update().
      - Otherwise, if client sends `start`+`end`, we pull Google steps
        and call generate_enhanced_instruction() for each turn.
      - In both cases we finally emit an arrival message.
    """
    data = request.json or {}
    gps_sequence = data.get('gps_sequence')
    start = data.get('start')
    end = data.get('end')

    # Mode 1: direct gps_sequence → generate_voice_update
    if gps_sequence:
        seq = gps_sequence
        use_enhanced = False

    # Mode 2: start/end → fetch Google steps + generate_enhanced_instruction
    elif start and end:
        routes = get_google_routes(google_maps_api_key, start, end)
        if not routes:
            return jsonify({'error': 'No routes found'}), 404
        steps = routes[0]['legs'][0]['steps']
        seq = [{
            'latitude':            step['end_location']['lat'],
            'longitude':           step['end_location']['lng'],
            'html_instructions':   step['html_instructions']
        } for step in steps]
        use_enhanced = True

    else:
        return jsonify({'error': 'Provide either gps_sequence or start & end'}), 400

    def event_stream():
        prev = seq[0]
        for point in seq:
            lat = point['latitude']
            lng = point['longitude']

            if use_enhanced:
                # Turn‑by‑turn LLM instructions
                instr = generate_enhanced_instruction(
                    point['html_instructions'],
                    lat, lng,
                    model_name=VOICE_MODEL
                )
            else:
                # Continuous‐drive voice updates
                instr = generate_voice_update(
                    lat, lng,
                    prev.get('latitude'), prev.get('longitude'),
                    model_name=VOICE_MODEL
                )

            packet = {'text': instr, 'latitude': lat, 'longitude': lng}
            yield f"data: {json.dumps(packet)}\n\n"
            prev = point

        # Final arrival message
        arrival = {
            'text':      'You have arrived at your destination',
            'latitude':  seq[-1]['latitude'],
            'longitude': seq[-1]['longitude']
        }
        yield f"data: {json.dumps(arrival)}\n\n"

    return Response(event_stream(), mimetype='text/event-stream')

@app.route('/test_openai', methods=['GET'])
def test_openai():
    try:
        logger.debug("Testing OpenAI API")
        resp = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": "Hello"}],
            max_tokens=10
        )
        return jsonify({'status': 'success', 'message': resp.choices[0].message.content})
    except Exception as e:
        logger.error(f"OpenAI test failed: {e}", exc_info=True)
        return jsonify({'status': 'error', 'error': str(e)}), 500

@app.route('/chat', methods=['POST'])
def chat():
    try:
        user_msg = request.json.get('message')
        if not user_msg:
            return jsonify({'error': 'No message provided'}), 400

        conversation = session.setdefault('conversation', [])
        with open('topic_prompts/initial_prompt.txt') as f:
            initial = f.read()

        messages = (
            [{"role": "system",  "content": initial}]
            + conversation[-10:]
            + [{"role": "user", "content": user_msg}]
        )

        resp = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=messages,
            temperature=0.7,
            max_tokens=500
        )
        bot_msg = resp.choices[0].message.content
        conversation.append({"role": "assistant", "content": bot_msg})
        session.modified = True

        return jsonify({'response': bot_msg})
    except Exception as e:
        logger.error(f"Chat error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/clear_session', methods=['GET'])
def clear_session():
    session.clear()
    return jsonify({'status': 'session cleared'})

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=8080)
