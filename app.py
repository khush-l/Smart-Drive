from flask import Flask, render_template, request, jsonify, session, Response
from flask_session import Session
import openai, os, json, logging, numpy as np
from dotenv import load_dotenv

from Route_Safety import (
    get_google_routes,
    calculate_safety_score,
    train_model,
    identify_crash_hotspots,
    load_crash_data,
    generate_voice_update,
    generate_enhanced_instruction,
)

# --------------------------------------------------
# basic setup
# --------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()  # .env
openai.api_key        = os.getenv("OPENAI_API_KEY")
google_maps_api_key   = os.getenv("GOOGLE_MAPS_API_KEY")
VOICE_MODEL           = os.getenv("VOICE_MODEL", "gpt-3.5-turbo")

app = Flask(__name__)
app.config.update(SESSION_PERMANENT=False, SESSION_TYPE="filesystem")
Session(app)

# --------------------------------------------------
# ML safety model (warm‑up at startup)
# --------------------------------------------------
logger.info("Training safety model …")
_safety_model = train_model(
    identify_crash_hotspots(load_crash_data("data.csv"))
)
logger.info("✓ safety model ready")

# --------------------------------------------------
# routes
# --------------------------------------------------
@app.route("/")
def home():
    return render_template("index.html", google_maps_api_key=google_maps_api_key)


# ---------- 1. analyse multiple routes ----------
@app.route("/analyze_route", methods=["POST"])
def analyze_route():
    data  = request.json or {}
    start = data.get("start")
    end   = data.get("end")
    if not (start and end):
        return jsonify(error="Please provide both start and end locations"), 400

    try:
        routes = get_google_routes(google_maps_api_key, start, end)
        if not routes:
            return jsonify(error="No routes found"), 404

        details = []
        for r in routes:
            score, mins = calculate_safety_score(r, _safety_model)
            details.append(
                dict(
                    safety_score=score,
                    duration=mins,
                    distance=r["legs"][0]["distance"]["text"],
                    steps=[s["html_instructions"] for s in r["legs"][0]["steps"][:3]],
                )
            )

        # index of safest route (highest score)
        safest_idx = int(np.argmax([d["safety_score"] for d in details]))

        return jsonify(routes=routes, route_details=details, safest_index=safest_idx)
    except Exception as exc:  # noqa
        logger.exception("analyse_route failed")
        return jsonify(error=str(exc)), 500


# ---------- 2. stream a chosen route (or gps sequence) ----------
@app.route("/stream_route", methods=["POST"])
def stream_route():
    """
    Two modes:

    • `gps_sequence`  – list of {latitude, longitude}
       → generate_voice_update (continuous‑drive)

    • `start`, `end`  (+ optional `route_index`, default 0)
       → pull Google Directions steps for that route
         and call generate_enhanced_instruction for each turn.
    """
    data = request.json or {}

    # --------------------------------------------------
    #  mode A – pre‑defined GPS track
    # --------------------------------------------------
    if "gps_sequence" in data:
        seq           = data["gps_sequence"]
        enhanced_turn = False

    # --------------------------------------------------
    #  mode B – Google route steps
    # --------------------------------------------------
    else:
        start = data.get("start")
        end   = data.get("end")
        if not (start and end):
            return jsonify(error="Provide gps_sequence OR start & end"), 400

        route_idx = int(data.get("route_index", 0))
        routes    = get_google_routes(google_maps_api_key, start, end)
        if not routes:
            return jsonify(error="No routes found"), 404
        if route_idx >= len(routes):
            return jsonify(error="route_index out of range"), 400

        chosen   = routes[route_idx]
        steps    = chosen["legs"][0]["steps"]
        seq      = [
            dict(
                latitude=s["end_location"]["lat"],
                longitude=s["end_location"]["lng"],
                html_instructions=s["html_instructions"],
            )
            for s in steps
        ]
        enhanced_turn = True

    # --------------------------------------------------
    #  SSE generator
    # --------------------------------------------------
    def event_stream():
        prev = seq[0]
        for pt in seq:
            lat, lng = pt["latitude"], pt["longitude"]

            if enhanced_turn:
                text = generate_enhanced_instruction(
                    pt["html_instructions"], lat, lng, model_name=VOICE_MODEL
                )
            else:
                text = generate_voice_update(
                    lat, lng, prev["latitude"], prev["longitude"], model_name=VOICE_MODEL
                )

            yield f"data: {json.dumps(dict(text=text, latitude=lat, longitude=lng))}\n\n"
            prev = pt

        # arrival
        arr = dict(
            latitude=seq[-1]["latitude"],
            longitude=seq[-1]["longitude"],
        )
        yield f"data: {json.dumps(arr)}\n\n"

    return Response(event_stream(), mimetype="text/event-stream")


# ---------- 3. tiny helper routes ----------
@app.route("/chat", methods=["POST"])
def chat():
    try:
        user_msg = request.json.get("message")
        if not user_msg:
            return jsonify(error="No message provided"), 400

        convo = session.setdefault("conversation", [])
        with open("topic_prompts/initial_prompt.txt") as f:
            system_prompt = f.read()

        msgs = [{"role": "system", "content": system_prompt}] + convo[-10:] + [
            {"role": "user", "content": user_msg}
        ]
        resp = openai.chat.completions.create(
            model="gpt-3.5-turbo", messages=msgs, temperature=0.7, max_tokens=500
        )
        bot = resp.choices[0].message.content
        convo.append({"role": "assistant", "content": bot})
        session.modified = True
        return jsonify(response=bot)
    except Exception as exc:  # noqa
        logger.exception("chat endpoint failed")
        return jsonify(error=str(exc)), 500


@app.route("/clear_session")
def clear_session():
    session.clear()
    return jsonify(status="session cleared")


# ----------  entrypoint ----------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
