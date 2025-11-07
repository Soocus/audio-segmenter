#!/bin/bash

echo "🎵 Starting Audio Segmenter..."
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "⚠️  ffmpeg is not installed. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install ffmpeg
        else
            echo "❌ Homebrew not found. Please install ffmpeg manually:"
            echo "   Visit: https://ffmpeg.org/download.html"
            exit 1
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        sudo apt update && sudo apt install -y ffmpeg
    else
        echo "❌ Please install ffmpeg manually for your operating system:"
        echo "   Visit: https://ffmpeg.org/download.html"
        exit 1
    fi
fi

# Check if requirements are installed
if ! python3 -c "import flask" &> /dev/null; then
    echo "📦 Installing Python dependencies..."
    pip3 install -r requirements.txt
fi

echo ""
echo "✅ All dependencies installed!"
echo ""
echo "🚀 Starting web server..."
echo "📍 Open http://localhost:5001 in your browser"
echo ""

python3 app.py

