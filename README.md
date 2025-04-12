# Smart Drive

A route safety analysis tool that uses AI to evaluate the safety of different driving routes and provides real-time safety recommendations.

## Features

- Real-time route safety analysis using historical crash data
- Multiple route options with safety scores
- AI-powered chat assistant for route recommendations
- Interactive map interface
- Crash hotspot identification
- Estimated travel times and distances
- Route step-by-step instructions

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/Smart-Drive.git
   cd Smart-Drive
   ```

2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install the required packages:
   ```bash
   pip install -r requirements.txt
   ```

4. Get your API keys:
   - **Google Maps API Key**:
     - Go to [Google Cloud Console](https://console.cloud.google.com/)
     - Create a new project or select an existing one
     - Enable the Directions API
     - Create an API key in Credentials
   
   - **OpenAI API Key**:
     - Go to [OpenAI Platform](https://platform.openai.com/)
     - Create an account or sign in
     - Generate an API key in your account settings

5. Set up your environment variables:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Open `.env` and add your API keys:
     ```
     GOOGLE_MAPS_API_KEY=your_google_maps_api_key
     OPENAI_API_KEY=your_openai_api_key
     
     ```

## Usage

1. Start the Flask application:
   ```bash
   python app.py
   ```

2. Open your web browser and navigate to:
   ```
   http://localhost:8080
   ```

3. Enter your starting and destination locations to get route analysis.

## Important Notes

- The application requires both Google Maps API and OpenAI API keys
- Google Maps API has a free tier with generous limits for personal use
- OpenAI API usage is billed based on token usage
- Never share your API keys or commit them to version control
- The `.env` file is already in `.gitignore` to prevent accidental commits

## Project Structure

```
Smart-Drive/
├── app.py                 # Main Flask application
├── Route_Safety.py        # Route analysis and safety scoring
├── requirements.txt       # Python dependencies
├── static/               # Static files (CSS, JS)
├── templates/            # HTML templates
├── topic_prompts/        # AI chat prompts
├── trainedModel.joblib   # Trained safety model
└── data.csv             # Historical crash data
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request


