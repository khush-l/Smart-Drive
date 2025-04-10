/**
 * Smart Drive AI - Main JavaScript File
 * Handles map initialization, route finding, and chat functionality
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
    // Initialize the map centered on Austin, TX
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 30.2672, lng: -97.7431 }, // Austin coordinates
        zoom: 12
    });

    // Initialize directions service and renderer
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        map: map
    });
}

/**
 * Display a route on the map
 * @param {Object} route - The route data from Google Maps API
 */
function displayRoute(route) {
    if (!route || !route.legs || route.legs.length === 0) {
        console.error('Invalid route data');
        return;
    }

    // Create a DirectionsRequest object for the route
    const request = {
        origin: route.legs[0].start_address,
        destination: route.legs[0].end_address,
        travelMode: 'DRIVING'
    };

    // Get and display the route on the map
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
    
    // Clear previous route details
    chatContainer.innerHTML = '';
    
    // Add each route's details to the chat
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
    // Get start and end locations from input fields
    const startLocation = document.getElementById('start-location').value;
    const endLocation = document.getElementById('end-location').value;

    // Validate inputs
    if (!startLocation || !endLocation) {
        alert('Please enter both start and end locations');
        return;
    }

    // Show loading state
    document.getElementById('map-container').style.opacity = '0.5';
    
    // Make request to backend for route analysis
    fetch('/analyze_route', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            start: startLocation,
            end: endLocation
        }),
    })
    .then(response => {
        // Handle non-200 responses
        if (!response.ok) {
            return response.json().then(data => {
                throw new Error(data.error || 'Network response was not ok');
            });
        }
        return response.json();
    })
    .then(data => {
        // Handle backend errors
        if (data.error) {
            alert(data.error);
            return;
        }
        
        // Display route on map if available
        if (data.routes && data.routes.length > 0) {
            displayRoute(data.routes[0]); // Display the first route
        }
        
        // Display route details if available
        if (data.route_details && data.route_details.length > 0) {
            displayRouteDetails(data.route_details);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('An error occurred while finding the route: ' + error.message);
    })
    .finally(() => {
        // Reset loading state
        document.getElementById('map-container').style.opacity = '1';
    });
}

// Main prediction loop
async function loop() {
    webcam.update();
    await predict();
    window.requestAnimationFrame(loop);
}

// Predict function
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
    const userInput = document.getElementById("user-input");
    const message = userInput.value.trim();
    
    // Don't send empty messages
    if (message === "") return;

    // Disable input and show loading state
    userInput.disabled = true;
    const sendButton = document.querySelector('#input-container button');
    sendButton.disabled = true;
    sendButton.textContent = 'Sending...';

    // Add user message to chat
    addMessageToChat(message, 'user');
    userInput.value = "";

    // Send to backend
    fetch('/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: message
        }),
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(data => {
                throw new Error(data.error || 'Network response was not ok');
            });
        }
        return response.json();
    })
    .then(data => {
        if (data.error) {
            console.error('Server error:', data.error);
            addMessageToChat('Error: ' + data.error, 'bot');
        } else {
            addMessageToChat(data.response, 'bot');
        }
    })
    .catch((error) => {
        console.error('Error:', error);
        addMessageToChat('Error: ' + error.message, 'bot');
    })
    .finally(() => {
        // Re-enable input and button
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
    const chatContainer = document.getElementById("chat-container");
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", sender + "-message");
    messageElement.innerHTML = message.replace(/\n/g, '<br>'); // Convert newlines to <br> tags
    chatContainer.appendChild(messageElement);
    
    // Scroll to the latest message
    messageElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

/**
 * Initialize event listeners when the DOM is loaded
 */
document.addEventListener('DOMContentLoaded', function() {
    const userInput = document.getElementById("user-input");
    const sendButton = document.querySelector('#input-container button');

    // Enter key event listener for chat input
    userInput.addEventListener("keypress", function(event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    // Send button click event listener
    sendButton.addEventListener("click", sendMessage);

    // Display welcome message
    addMessageToChat("Hello! I'm your Smart Drive AI assistant. I can help you find safe routes and answer questions about your journey. How can I help you today?", 'bot');
});