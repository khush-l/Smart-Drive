/**
 * Smart Drive AI - Main JavaScript File
 * Handles map initialization, route finding, chat, voice-first streaming,
 * and virtual drive simulation with waypoint animation and voice updates.
 */

// Global variables for map functionality
let map;                    // Google Maps instance
let directionsService;      // Google Maps Directions Service
let directionsRenderer;     // Google Maps Directions Renderer

// Simulation globals
let simulateBtn;            // "Simulate Drive" button
let waypoints = [];         // Array of google.maps.LatLng for simulation
let voicePackets = [];      // Array of { text, latitude, longitude } from backend
let marker;                 // Car marker on map
let traveledPath;           // Polyline for traveled segment
let upcomingPath;           // Polyline for upcoming segment
let simulationInterval;     // Interval ID for animation
let lastSpoken = '';        // Last spoken text to throttle repeats

/**
 * Initialize the Google Map
 * Called automatically when the Google Maps API loads
 */
window.initMap = function() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 30.2672, lng: -97.7431 }, // Austin
        zoom: 12
    });
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({ map });

    // Add Simulate Drive button
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
    if (!route || !route.legs || !route.legs.length) {
        console.error('Invalid route data');
        return;
    }
    // Show on map
    const request = {
        origin: route.legs[0].start_address,
        destination: route.legs[0].end_address,
        travelMode: 'DRIVING'
    };
    directionsService.route(request, (result, status) => {
        if (status === 'OK') {
            directionsRenderer.setDirections(result);
            // Extract overview path for simulation
            const overview = result.routes[0].overview_polyline;
            prepareSimulation(overview);
        } else {
            console.error('Directions request failed:', status);
        }
    });
}

/**
 * Decode & subsample overview polyline, prefetch voice updates
 */
function prepareSimulation(overview_polyline) {
    // Decode full path
    const fullPath = google.maps.geometry.encoding.decodePath(overview_polyline);
    // Subsample ~20 points
    const step = Math.ceil(fullPath.length / 20);
    waypoints = fullPath.filter((_, i) => i % step === 0);
    if (waypoints[waypoints.length - 1] !== fullPath[fullPath.length - 1]) {
        waypoints.push(fullPath[fullPath.length - 1]);
    }
    // Enable Simulate button
    simulateBtn.disabled = false;
    // Prefetch voice packets for all waypoints
    fetchVoicePackets(waypoints).then(pkts => voicePackets = pkts);
}

/**
 * Fetch voice-first updates for a sequence of coords via SSE-like fetch
 */
async function fetchVoicePackets(sequence) {
    const resp = await fetch('/stream_route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gps_sequence: sequence.map(pt => ({ latitude: pt.lat(), longitude: pt.lng() })) })
    });
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
 * Animate the virtual drive along subsampled waypoints
 */
function simulateDrive() {
    // Reset any existing simulation
    clearInterval(simulationInterval);
    if (marker) marker.setMap(null);
    if (traveledPath) traveledPath.setMap(null);
    if (upcomingPath) upcomingPath.setMap(null);
    lastSpoken = '';

    // Draw upcoming path
    upcomingPath = new google.maps.Polyline({
        path: waypoints,
        strokeColor: '#ccc',
        strokeWeight: 4,
        map
    });
    // Initialize traveled path
    traveledPath = new google.maps.Polyline({
        path: [],
        strokeColor: '#007bff',
        strokeWeight: 6,
        map
    });
    // Place car marker at start
    marker = new google.maps.Marker({
        position: waypoints[0],
        map,
        icon: { url: 'https://maps.gstatic.com/intl/en_us/mapfiles/markers2/measle_blue.png', scaledSize: new google.maps.Size(12,12) }
    });
    map.panTo(waypoints[0]);

    // Step through waypoints every 1.5s
    let idx = 0;
    simulationInterval = setInterval(() => {
        if (idx >= waypoints.length) {
            clearInterval(simulationInterval);
            return;
        }
        const pos = waypoints[idx];
        // Update marker
        marker.setPosition(pos);
        // Extend traveled, shorten upcoming
        const traveled = traveledPath.getPath();
        traveled.push(pos);
        const upcoming = upcomingPath.getPath();
        upcoming.removeAt(0);
        // Center map
        map.panTo(pos);
        // Speak update if available and not repeat
        const pkt = voicePackets[idx];
        if (pkt && pkt.text !== lastSpoken) {
            lastSpoken = pkt.text;
            handleVoicePacket(pkt);
        }
        idx++;
    }, 1500);
}

/**
 * Display route details in the chat container
 */
function displayRouteDetails(routeDetails) {
    const chatContainer = document.getElementById('chat-container');
    chatContainer.innerHTML = '';
    routeDetails.forEach((detail, index) => {
        const msg = `Route ${index + 1}:\n` +
                    `Safety Score: ${detail.safety_score}/10\n` +
                    `Duration: ${detail.duration} minutes\n` +
                    `Distance: ${detail.distance}\n` +
                    `First steps:\n${detail.steps.join('\n')}`;
        addMessageToChat(msg, 'bot');
    });
}

function findSafeRoute() {
    const start = document.getElementById('start-location').value;
    const end = document.getElementById('end-location').value;
    if (!start || !end) { alert('Please enter both locations'); return; }
    document.getElementById('map-container').style.opacity = '0.5';
    fetch('/analyze_route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end })
    })
    .then(r => r.ok ? r.json() : r.json().then(e => { throw e; }))
    .then(data => {
        if (data.routes?.length) displayRoute(data.routes[0]);
        if (data.route_details) displayRouteDetails(data.route_details);
    })
    .catch(err => { console.error(err); alert(err.error||err); })
    .finally(() => document.getElementById('map-container').style.opacity = '1');
}

function sendMessage() {
    const input = document.getElementById('user-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.disabled = true;
    const btn = document.querySelector('#input-container button');
    btn.disabled = true; btn.textContent = 'Sending...';
    addMessageToChat(msg, 'user');
    input.value = '';
    fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
    })
    .then(r => r.ok ? r.json() : r.json().then(e => { throw e; }))
    .then(d => addMessageToChat(d.error ? 'Error: '+d.error : d.response, 'bot'))
    .catch(e => addMessageToChat('Error: '+(e.error||e), 'bot'))
    .finally(() => { input.disabled = false; btn.disabled = false; btn.textContent = 'Send'; input.focus(); });
}

function addMessageToChat(message, sender) {
    const container = document.getElementById("chat-container");
    const el = document.createElement("div");
    el.classList.add("message", sender + "-message");
    el.innerHTML = message.replace(/\n/g, '<br>');
    container.appendChild(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function startVoiceRoute() {
    const start = document.getElementById('start-location').value;
    const end = document.getElementById('end-location').value;
    if (!start || !end) { alert('Please enter both locations'); return; }
    document.getElementById('map-container').style.opacity = '0.5';
    try {
        const res = await fetch('/stream_route', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ start, end })
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error||'Stream failed'); }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop();
            for (const p of parts) {
                if (p.startsWith('data: ')) {
                    try { handleVoicePacket(JSON.parse(p.slice(6))); }
                    catch {}
                }
            }
        }
    } catch (e) {
        console.error('Voice stream error', e);
        alert('Voice stream error: '+e.message);
    } finally {
        document.getElementById('map-container').style.opacity = '1';
    }
}

function handleVoicePacket(packet) {
    const txt = packet.text;
    addMessageToChat(txt, 'bot');
    speechSynthesis.speak(new SpeechSynthesisUtterance(txt));
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('start-button')?.addEventListener('click', findSafeRoute);
    document.getElementById('voice-button')?.addEventListener('click', startVoiceRoute);
    document.getElementById('user-input').addEventListener('keypress', e => {
        if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.querySelector('#input-container button').addEventListener('click', sendMessage);
    addMessageToChat("Hello! I'm your Smart Drive AI assistant. I can help you find safe routes and provide voice updates. How can I help you today?", 'bot');
});
