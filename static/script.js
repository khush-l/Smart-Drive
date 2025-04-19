/**
 * Handles map initialization, route finding, chat, and turn‑by‑turn simulation
 */

/* ──────────────── Global state ──────────────── */
let map, directionsService, directionsRenderer;

/* Simulation globals */
let simulateBtn;
let waypoints        = [];   // google.maps.LatLng for each step end
let voicePackets     = [];   // { text, latitude, longitude }
let marker, traveledPath, upcomingPath, simulationInterval;
let lastSpoken       = '';

/* Route context */
let currentStart      = '';
let currentEnd        = '';
let currentRouteIndex = 0;   // 0 = first route; updated to safest index
let currentRouteObj   = null;/* remembers the safest route JSON */
let drawnPolyline     = null;/* reference to the custom line on the map */

/* ──────────────── Map init ──────────────── */
window.initMap = function () {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 30.2672, lng: -97.7431 },
    zoom: 12
  });
  directionsService  = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: true,   // we drop our own car marker
    preserveViewport: true   // don’t auto‑zoom; we’ll fit bounds ourselves
  });

  /* Simulate‑Drive button (injected so HTML stays clean) */
  simulateBtn              = document.createElement('button');
  simulateBtn.textContent  = 'Simulate Drive';
  simulateBtn.id           = 'simulate-drive';
  simulateBtn.disabled     = true;
  simulateBtn.style.marginLeft = '10px';
  document
    .getElementById('input-fields')
    .appendChild(simulateBtn);
  simulateBtn.addEventListener('click', simulateDrive);
};

/* ──────────────── Route display & prep ──────────────── */
function displayRoute(route) {
  if (!route?.legs?.length) {
    console.error('Invalid route data'); return;
  }

  /* ① Clear any previously drawn manual polyline */
  drawnPolyline?.setMap(null);

  /* ② Draw the overview_polyline so the map always matches the server’s route */
  const fullPath =
    google.maps.geometry.encoding.decodePath(route.overview_polyline.points);
  drawnPolyline = new google.maps.Polyline({
    path: fullPath, strokeColor: '#4285F4', strokeWeight: 5, map
  });

  /* ③ Fit viewport neatly around that path */
  const bounds = new google.maps.LatLngBounds();
  fullPath.forEach(p => bounds.extend(p));
  map.fitBounds(bounds);

  /* ④ Store & continue with simulation prep */
  currentRouteObj = route;
  prepareSimulationFromSteps(route);
}

function prepareSimulationFromSteps(route) {
  const steps = route.legs[0].steps;

  /* Build waypoint list */
  waypoints = steps.map(s =>
    new google.maps.LatLng(s.end_location.lat, s.end_location.lng)
  );

  /* Google fallback packets (raw html stripped) */
  voicePackets = steps.map(s => ({
    text: s.html_instructions.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(),
    latitude:  s.end_location.lat,
    longitude: s.end_location.lng
  }));

  /* Async: fetch enriched packets (LLM + hotspot) */
  fetchEnhancedPackets()
    .then(pkts => { if (pkts.length) voicePackets = pkts; })
    .catch(err  => console.warn('Enhanced stream failed; using fallback', err));

  simulateBtn.disabled = false;
}

/* ──────────────── SSE fetch helper ──────────────── */
async function fetchEnhancedPackets() {
  const resp = await fetch('/stream_route', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start:       currentStart,
      end:         currentEnd,
      route_index: currentRouteIndex
    })
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const reader  = resp.body.getReader();
  const decode  = new TextDecoder();
  let buffer    = '';
  const packets = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decode.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop();
    chunks.forEach(chunk => {
      if (chunk.startsWith('data: ')) {
        try { packets.push(JSON.parse(chunk.slice(6))); } catch {}
      }
    });
  }
  return packets;
}

/* ──────────────── Simulation (3 s per step) ──────────────── */
function simulateDrive() {
  clearInterval(simulationInterval);
  [marker, traveledPath, upcomingPath].forEach(obj => obj?.setMap(null));
  lastSpoken = '';

  upcomingPath = new google.maps.Polyline({
    path: waypoints, strokeColor: '#ccc', strokeWeight: 4, map
  });
  traveledPath = new google.maps.Polyline({
    path: [], strokeColor: '#007bff', strokeWeight: 6, map
  });
  marker = new google.maps.Marker({
    position: waypoints[0],
    map,
    icon: {
      url: 'https://maps.gstatic.com/intl/en_us/mapfiles/markers2/measle_blue.png',
      scaledSize: new google.maps.Size(12, 12)
    }
  });
  map.panTo(waypoints[0]);

  let idx = 0;
  simulationInterval = setInterval(() => {
    if (idx >= waypoints.length) {
      clearInterval(simulationInterval);
      handleVoicePacket({
        text: 'You have arrived at your destination',
        latitude:  waypoints.at(-1).lat(),
        longitude: waypoints.at(-1).lng()
      });
      return;
    }
    const pos = waypoints[idx];
    marker.setPosition(pos);
    traveledPath.getPath().push(pos);
    upcomingPath.getPath().removeAt(0);
    map.panTo(pos);

    const pkt = voicePackets[idx];
    if (pkt && pkt.text !== lastSpoken) {
      lastSpoken = pkt.text;
      handleVoicePacket(pkt);
    }
    idx++;
  }, 3000);
}

/* ──────────────── Server call: safest route & details ──────────────── */
function findSafeRoute() {
  const start = document.getElementById('start-location').value.trim();
  const end   = document.getElementById('end-location').value.trim();
  if (!start || !end) return alert('Please enter both locations');

  currentStart = start;
  currentEnd   = end;

  document.getElementById('map-container').style.opacity = 0.5;
  fetch('/analyze_route', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start, end })
  })
  .then(r => r.ok ? r.json() : r.json().then(e => { throw e; }))
  .then(data => {
    /* Determine safest route */
    currentRouteIndex =
      data.route_details.reduce(
        (best, cur, i, arr) => cur.safety_score > arr[best].safety_score ? i : best,
        0
      );

    displayRoute(data.routes[currentRouteIndex]);
    displayRouteDetails(data.route_details);
  })
  .catch(err => {
    console.error(err); alert(err.error || err);
  })
  .finally(() => {
    document.getElementById('map-container').style.opacity = 1;
  });
}

/* ──────────────── Chat helpers ──────────────── */
function displayRouteDetails(details) {
  const chat = document.getElementById('chat-container');
  chat.innerHTML = '';
  details.forEach((d, i) => {
    const star = i === currentRouteIndex ? '★ ' : '';
    const msg =
      `${star}Route ${i + 1}:\n` +
      `Safety ${d.safety_score}/10 • Time ${d.duration.toFixed(0)} min • Dist ${d.distance}\n` +
      `First steps:\n${d.steps.join('\n')}`;
    addMessageToChat(msg, 'bot');
  });
}

function sendMessage() {
  const input = document.getElementById('user-input');
  const txt   = input.value.trim();
  if (!txt) return;

  input.disabled = true;
  const btn = document.querySelector('#input-container button');
  btn.disabled = true; btn.textContent = 'Sending…';
  addMessageToChat(txt, 'user'); input.value = '';

  fetch('/chat', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: txt })
  })
  .then(r => r.ok ? r.json() : r.json().then(e => { throw e; }))
  .then(d => addMessageToChat(d.response ?? `Error: ${d.error}`, 'bot'))
  .catch(e => addMessageToChat(`Error: ${e.error || e}`, 'bot'))
  .finally(() => {
    input.disabled = false;
    btn.disabled   = false;
    btn.textContent = 'Send';
    input.focus();
  });
}

function addMessageToChat(msg, who) {
  const c  = document.getElementById('chat-container');
  const el = document.createElement('div');
  el.classList.add('message', `${who}-message`);
  el.innerHTML = msg.replace(/\n/g, '<br>');
  c.appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function handleVoicePacket(pkt) {
  addMessageToChat(pkt.text, 'bot');
  speechSynthesis.speak(new SpeechSynthesisUtterance(pkt.text));
}

/* ──────────────── DOM wiring ──────────────── */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('start-button').addEventListener('click', findSafeRoute);
  document.getElementById('user-input').addEventListener('keypress', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  document.querySelector('#input-container button').addEventListener('click', sendMessage);

  addMessageToChat(
    "Hello! I’m your Smart Drive AI assistant.\n" +
    "Enter a start & destination, then click “Simulate Drive” to hear turn‑by‑turn directions and crash‑zone alerts.",
    'bot'
  );
});
