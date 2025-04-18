/**
 * Smart Drive AI - Main JavaScript File
 * Handles map initialization, route finding, chat, and enriched turn‑by‑turn simulation
 */

// Global variables for map functionality
let map;
let directionsService;
let directionsRenderer;

// Simulation globals
let simulateBtn;
let waypoints = [];          // google.maps.LatLng for each step end
let voicePackets = [];       // { text, latitude, longitude }
let marker;
let traveledPath;
let upcomingPath;
let simulationInterval;
let lastSpoken = '';
let currentStart = '';
let currentEnd = '';

/**
 * Initialize the Google Map
 */
window.initMap = function() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 30.2672, lng: -97.7431 },
    zoom: 12
  });
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({ map });

  // Create Simulate Drive button
  simulateBtn = document.createElement('button');
  simulateBtn.textContent = 'Simulate Drive';
  simulateBtn.id = 'simulate-drive';
  simulateBtn.disabled = true;
  simulateBtn.style.marginLeft = '10px';
  document.getElementById('input-fields').appendChild(simulateBtn);
  simulateBtn.addEventListener('click', simulateDrive);
};

/**
 * Display a route on the map and prepare for simulation
 */
function displayRoute(route) {
  if (!route?.legs?.length) {
    console.error('Invalid route data');
    return;
  }
  const request = {
    origin:      route.legs[0].start_address,
    destination: route.legs[0].end_address,
    travelMode:  'DRIVING'
  };
  directionsService.route(request, (result, status) => {
    if (status === 'OK') {
      directionsRenderer.setDirections(result);
      prepareSimulationFromSteps(route);
    } else {
      console.error('Directions request failed:', status);
    }
  });
}

/**
 * Prepare step waypoints & prefetch enhanced voice packets
 */
function prepareSimulationFromSteps(route) {
  // Build google waypoints at each step's end_location
  const steps = route.legs[0].steps;
  waypoints = steps.map(step =>
    new google.maps.LatLng(
      step.end_location.lat,
      step.end_location.lng
    )
  );

  // Fallback: Google’s raw turn instructions (stripped HTML)
  const googleFallback = steps.map(step => ({
    text: step.html_instructions
             .replace(/<[^>]+>/g, '')
             .replace(/&nbsp;/g, ' ')
             .trim(),
    latitude:  step.end_location.lat,
    longitude: step.end_location.lng
  }));
  voicePackets = googleFallback;

  // Then asynchronously fetch the enriched SSE stream:
  fetchEnhancedPackets()
    .then(pkts => {
      if (pkts.length) {
        voicePackets = pkts;
      }
    })
    .catch(err => {
      console.warn('Enhanced stream failed, using Google fallback:', err);
    });

  // Enable simulate
  simulateBtn.disabled = false;
}

/**
 * Fetch SSE from /stream_route for enriched instructions + hotspot warnings
 */
async function fetchEnhancedPackets() {
  const resp = await fetch('/stream_route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: currentStart, end: currentEnd })
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const packets = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop();
    for (const part of parts) {
      if (part.startsWith('data: ')) {
        try {
          packets.push(JSON.parse(part.slice(6)));
        } catch {}
      }
    }
  }
  return packets;
}

/**
 * Animate the drive along step waypoints, 3s per step
 */
function simulateDrive() {
  clearInterval(simulationInterval);
  if (marker) marker.setMap(null);
  if (traveledPath) traveledPath.setMap(null);
  if (upcomingPath) upcomingPath.setMap(null);
  lastSpoken = '';

  upcomingPath = new google.maps.Polyline({
    path: waypoints,
    strokeColor: '#ccc',
    strokeWeight: 4,
    map
  });
  traveledPath = new google.maps.Polyline({
    path: [],
    strokeColor: '#007bff',
    strokeWeight: 6,
    map
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
        latitude: waypoints[waypoints.length - 1].lat(),
        longitude: waypoints[waypoints.length - 1].lng()
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
  }, 3000);  // 3 seconds per step
}

/**
 * Fetch & render safe route + details
 */
function findSafeRoute() {
  const start = document.getElementById('start-location').value;
  const end   = document.getElementById('end-location').value;
  if (!start || !end) {
    alert('Please enter both locations');
    return;
  }
  currentStart = start;
  currentEnd   = end;
  document.getElementById('map-container').style.opacity = 0.5;
  fetch('/analyze_route', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ start, end })
  })
  .then(r => r.ok ? r.json() : r.json().then(e => { throw e; }))
  .then(data => {
    if (data.routes?.length)      displayRoute(data.routes[0]);
    if (data.route_details)       displayRouteDetails(data.route_details);
  })
  .catch(err => {
    console.error(err);
    alert(err.error || err);
  })
  .finally(() => {
    document.getElementById('map-container').style.opacity = 1;
  });
}

/**
 * Display route details in chat
 */
function displayRouteDetails(details) {
  const chat = document.getElementById('chat-container');
  chat.innerHTML = '';
  details.forEach((d,i) => {
    const msg = `Route ${i+1}:\n` +
                `Safety: ${d.safety_score}/10 • Time: ${d.duration.toFixed(0)} min • Dist: ${d.distance}\n` +
                `First steps:\n${d.steps.join('\n')}`;
    addMessageToChat(msg, 'bot');
  });
}

/**
 * AI chat
 */
function sendMessage() {
  const input = document.getElementById('user-input');
  const text  = input.value.trim();
  if (!text) return;
  input.disabled = true;
  const btn = document.querySelector('#input-container button');
  btn.disabled = true; btn.textContent = 'Sending…';
  addMessageToChat(text, 'user');
  input.value = '';

  fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ message: text })
  })
  .then(r => r.ok ? r.json() : r.json().then(e=>{throw e;}))
  .then(d => addMessageToChat(d.response || `Error: ${d.error}`, 'bot'))
  .catch(e => addMessageToChat(`Error: ${e.error||e}`, 'bot'))
  .finally(() => {
    input.disabled = false;
    btn.disabled = false;
    btn.textContent = 'Send';
    input.focus();
  });
}

/**
 * Append chat bubbles
 */
function addMessageToChat(msg, sender) {
  const c = document.getElementById('chat-container');
  const el= document.createElement('div');
  el.classList.add('message', `${sender}-message`);
  el.innerHTML = msg.replace(/\n/g,'<br>');
  c.appendChild(el);
  el.scrollIntoView({ behavior:'smooth', block:'end' });
}

/**
 * Handle & speak a packet
 */
function handleVoicePacket(pkt) {
  addMessageToChat(pkt.text, 'bot');
  speechSynthesis.speak(new SpeechSynthesisUtterance(pkt.text));
}

/**
 * Wire up UI
 */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('start-button').addEventListener('click', findSafeRoute);
  document.getElementById('user-input').addEventListener('keypress', e => {
    if (e.key==='Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  document.querySelector('#input-container button').addEventListener('click', sendMessage);

  addMessageToChat(
    "Hello! I'm your Smart Drive AI assistant. " +
    "Enter your start & end, then click ‘Simulate Drive’ to see turn‑by‑turn directions and hotspot alerts.",
    'bot'
  );
});
