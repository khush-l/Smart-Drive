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

// Send message function
function sendMessage() {
    const userInput = document.getElementById("user-input");
    const message = userInput.value.trim();
    
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
            message: userInput
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
    
    // Scroll to the latest message
    messageElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    const userInput = document.getElementById("user-input");
    const sendButton = document.querySelector('#input-container button');

    // Enter key event listener
    userInput.addEventListener("keypress", function(event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    // Send button click event listener
    sendButton.addEventListener("click", sendMessage);

    // Welcome message
    addMessageToChat("Hello! I'm your Smart Drive AI assistant. I can help you find safe routes and answer questions about your journey. How can I help you today?", 'bot');
});