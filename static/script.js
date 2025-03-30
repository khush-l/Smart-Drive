// Initialize map
let map;
let directionsService;
let directionsRenderer;

function initMap() {
    // Initialize the map
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

// Find safe route function
function findSafeRoute() {
    const startLocation = document.getElementById('start-location').value;
    const endLocation = document.getElementById('end-location').value;

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
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
            return;
        }
        
        // Display route on map
        displayRoute(data.routes);
        
        // Display route details
        displayRouteDetails(data.route_details);
    })
    .catch(error => {
        console.error('Error:', error);
        alert('An error occurred while finding the route');
    })
    .finally(() => {
        document.getElementById('map-container').style.opacity = '1';
    });
}

// Display route on map
function displayRoute(routes) {
    const request = {
        origin: routes[0].legs[0].start_address,
        destination: routes[0].legs[0].end_address,
        travelMode: 'DRIVING'
    };

    directionsService.route(request, (result, status) => {
        if (status === 'OK') {
            directionsRenderer.setDirections(result);
        } else {
            alert('Could not find route: ' + status);
        }
    });
}

// Display route details
function displayRouteDetails(routeDetails) {
    const chatContainer = document.getElementById('chat-container');
    chatContainer.innerHTML = ''; // Clear previous messages

    // Sort routes by safety score (highest first)
    routeDetails.sort((a, b) => b.safety_score - a.safety_score);

    routeDetails.forEach((route, index) => {
        const message = `Route ${index + 1}:\n` +
            `Safety Score: ${route.safety_score.toFixed(2)}/10\n` +
            `Duration: ${route.duration.toFixed(1)} minutes\n` +
            `Distance: ${route.distance}\n` +
            `First few steps:\n${route.steps.join('\n')}`;
        
        addMessageToChat(message, 'bot');
    });

    // Add a message about the safest route
    const safestRoute = routeDetails[0];
    addMessageToChat(`\nRecommended Route: Route 1 with Safety Score ${safestRoute.safety_score.toFixed(2)}/10, ` +
        `estimated time ${safestRoute.duration.toFixed(1)} minutes.`, 'bot');
}

// Send message function
function sendMessage() {
    const userInput = document.getElementById("user-input").value;
    if (userInput.trim() === "") return;

    addMessageToChat(userInput, 'user');

    fetch('/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: userInput
        }),
    })
    .then(response => response.json())
    .then(data => {
        addMessageToChat(data.response, 'bot');
    })
    .catch((error) => {
        console.error('Error:', error);
        addMessageToChat('Sorry, an error occurred.', 'bot');
    });

    document.getElementById("user-input").value = "";
}

// Add message to chat
function addMessageToChat(message, sender) {
    const chatContainer = document.getElementById("chat-container");
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", sender + "-message");
    messageElement.innerHTML = message.replace(/\n/g, '<br>'); // Convert newlines to <br> tags
    chatContainer.appendChild(messageElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Event listener for Enter key
document.getElementById("user-input").addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        sendMessage();
    }
});