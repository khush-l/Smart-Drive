# Smart Drive

A route safety analysis tool that uses an AI model to evaluate the safety of different driving routes.

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/Smart-Drive.git
   cd Smart-Drive
   ```

2. Install the required packages:
   ```bash
   pip install -r requirements.txt
   ```

3. Get your Google Maps API key:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one
   - Enable the Directions API for your project
   - Go to Credentials → Create Credentials → API Key
   - Copy your new API key

4. Set up your environment variables:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Open `.env` and replace `your_api_key_here` with your actual Google Maps API key

## Usage

Run the main script:
```bash
python App.py
```

## Important Notes

- The Google Maps API has a free tier with generous limits for personal use
- Each user needs their own API key to use the software
- Never share your API key or commit it to version control
- The `.env` file is already in `.gitignore` to prevent accidental commits

## Features

- Analyzes multiple route options between locations
- Calculates safety scores based on historical crash data
- Provides estimated travel times
- Recommends the safest route while considering travel time
