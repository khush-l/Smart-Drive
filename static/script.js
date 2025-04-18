/**
 * Smart Drive AI - Main JavaScript File
 * Handles map initialization, route finding, chat, and voice-first streaming
 */

// Global variables for map functionality
let map;                    // Google Maps instance
let directionsService;      // Google Maps Directions Service
let directionsRenderer;     // Google Maps Directions Renderer

/**
 * Initialize the Google Map
 * Called automatically when the Google Maps API loads
 */
window.initMap = function() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 30.2672, lng: -97.7431 }, // Austin coordinates
        zoom: 12
    });
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({ map: map });
};

/**
 * Display a route on the map
 * @param {Object} route - The route data from Google Maps API
 */
function displayRoute(route) {
    if (!route || !route.legs || route.legs.length === 0) {
        console.error('Invalid route data');
        return;
    }
    const request = {
        origin: route.legs[0].start_address,
        destination: route.legs[0].end_address,
        travelMode: 'DRIVING'
    };
    directionsService.route(request, function(result, status) {
        if (status === 'OK') {
            directionsRenderer.setDirections(result);
        } else {
            console.error('Directions request failed:', status);
        }
    });
}

/**
 * Display route details in the chat container
 * @param {Array} routeDetails - Array of route detail objects
 */
function displayRouteDetails(routeDetails) {
    const chatContainer = document.getElementById('chat-container');
    chatContainer.innerHTML = '';  // Clear previous
    routeDetails.forEach((detail, index) => {
        const message = `Route ${index + 1}:\n` +
                        `Safety Score: ${detail.safety_score}/10\n` +
                        `Duration: ${detail.duration} minutes\n` +
                        `Distance: ${detail.distance}\n` +
                        `First steps:\n${detail.steps.join('\n')}`;
        addMessageToChat(message, 'bot');
    });
}

/**
 * Find the safest route between two locations
 * Makes API call to backend and displays results
 */
function findSafeRoute() {
    const startLocation = document.getElementById('start-location').value;
    const endLocation = document.getElementById('end-location').value;
    if (!startLocation || !endLocation) {
        alert('Please enter both start and end locations');
        return;
    }
    document.getElementById('map-container').style.opacity = '0.5';
    fetch('/analyze_route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: startLocation, end: endLocation })
    })
    .then(response => response.ok ? response.json() : response.json().then(err => { throw err; }))
    .then(data => {
        if (data.routes && data.routes.length > 0) displayRoute(data.routes[0]);
        if (data.route_details) displayRouteDetails(data.route_details);
    })
    .catch(error => {
        console.error('Error:', error);
        alert(error.error || error);
    })
    .finally(() => {
        document.getElementById('map-container').style.opacity = '1';
    });
}

// Main prediction loop (legacy Teachable Machine code)
async function loop() {
    webcam.update();
    await predict();
    window.requestAnimationFrame(loop);
}

// Predict function (legacy Teachable Machine code)
async function predict() {
    const prediction = await model.predict(webcam.canvas);
    for (let i = 0; i < maxPredictions; i++) {
        const classPrediction = prediction[i].className + ": " + prediction[i].probability.toFixed(2);
        labelContainer.childNodes[i].innerHTML = classPrediction;
        if (prediction[i].probability > 0.5) {
            currentAnimal = prediction[i].className;
        }
    }
}

/**
 * Send a message to the AI chat
 * Handles user input and displays responses
 */
function sendMessage() {
    const userInput = document.getElementById('user-input');
    const message = userInput.value.trim();
    if (message === '') return;
    userInput.disabled = true;
    const sendButton = document.querySelector('#input-container button');
    sendButton.disabled = true;
    sendButton.textContent = 'Sending...';

    addMessageToChat(message, 'user');
    userInput.value = '';

    fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message })
    })
    .then(response => response.ok ? response.json() : response.json().then(err => { throw err; }))
    .then(data => {
        if (data.error) {
            console.error('Server error:', data.error);
            addMessageToChat('Error: ' + data.error, 'bot');
        } else {
            addMessageToChat(data.response, 'bot');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        addMessageToChat('Error: ' + (error.error || error), 'bot');
    })
    .finally(() => {
        userInput.disabled = false;
        sendButton.disabled = false;
        sendButton.textContent = 'Send';
        userInput.focus();
    });
}

/**
 * Add a message to the chat container
 * @param {string} message - The message text
 * @param {string} sender - 'user' or 'bot'
 */
function addMessageToChat(message, sender) {
    const chatContainer = document.getElementById('chat-container');
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', sender + '-message');
    messageElement.innerHTML = message.replace(/\n/g, '<br>');
    chatContainer.appendChild(messageElement);
    messageElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

/**
 * Start voice-first streaming of updates via SSE-like fetch
 */
async function startVoiceRoute() {
    const startLocation = document.getElementById('start-location').value;
    const endLocation = document.getElementById('end-location').value;
    if (!startLocation || !endLocation) {
        alert('Please enter both start and end locations for voice route');
        return;
    }
    document.getElementById('map-container').style.opacity = '0.5';
    try {
        const response = await fetch('/stream_route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start: startLocation, end: endLocation })
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Stream failed');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop();
            for (const part of parts) {
                if (part.startsWith('data: ')) {
                    try {
                        const packet = JSON.parse(part.slice(6));
                        handleVoicePacket(packet);
                    } catch (e) {
                        console.error('Parse SSE data', e);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Voice stream error', error);
        alert('Voice stream error: ' + error.message);
    } finally {
        document.getElementById('map-container').style.opacity = '1';
    }
}

/**
 * Handle each streamed packet: display and speak
 * @param {Object} packet - { text, latitude, longitude }
 */
function handleVoicePacket(packet) {
    const text = packet.text;
    addMessageToChat(text, 'bot');
    const utterance = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utterance);
}

/**
 * DOM loaded: bind event listeners
 */
document.addEventListener('DOMContentLoaded', function() {
    // Text-based route button (if given an ID)
    const startBtn = document.getElementById('start-button');
    if (startBtn) startBtn.addEventListener('click', findSafeRoute);
    // Voice-based route button
    const voiceBtn = document.getElementById('voice-button');
    if (voiceBtn) voiceBtn.addEventListener('click', startVoiceRoute);

    const userInput = document.getElementById('user-input');
    const sendBtn = document.querySelector('#input-container button');
    userInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    sendBtn.addEventListener('click', sendMessage);

    // Initial welcome message
    addMessageToChat("Hello! I'm your Smart Drive AI assistant. I can help you find safe routes and provide voice updates. How can I help you today?", 'bot');
});
