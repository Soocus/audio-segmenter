# 🎵 Audio Segmenter

An intelligent web app that splits long audio files into shorter segments based on AI transcription and natural speech breaks (punctuation marks).

## Features

- 🎤 **AI-Powered Transcription** - Uses OpenAI's Whisper via Replicate API
- ✂️ **Smart Segmentation** - Splits at periods, commas, or natural breaks
- ⏱️ **Configurable Duration** - Set max segment length (default 60 seconds)
- 📦 **Complete Output** - Get audio segments + text transcripts in ZIP
- 🎨 **Beautiful UI** - Modern, responsive web interface
- 💰 **Cost Effective** - ~$0.00041 per transcription via Replicate

## How It Works

1. Upload your audio file (MP3, WAV, OGG, M4A, etc.)
2. Enter your Replicate API key
3. Set maximum segment duration
4. The app:
   - Transcribes audio with word-level timestamps
   - Finds optimal split points at punctuation marks
   - Creates segments as long as possible without exceeding max duration
   - Exports audio segments + transcript files
5. Download everything as a ZIP file

## Prerequisites

- Python 3.8 or higher
- ffmpeg (for audio processing)
- Replicate API key (free to get)

### Install ffmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from [ffmpeg.org](https://ffmpeg.org/download.html)

## Installation

1. **Clone or download this project**

2. **Install Python dependencies:**
```bash
pip install -r requirements.txt
```

3. **Get your Replicate API key:**
   - Go to https://replicate.com/account/api-tokens
   - Sign up (free)
   - Copy your API token

## Usage

1. **Start the web server:**
```bash
python app.py
```

2. **Open your browser:**
   - Navigate to `http://localhost:5000`

3. **Upload and process:**
   - Enter your Replicate API key
   - Set max segment duration (default 60 seconds)
   - Upload your audio file
   - Click "Process Audio"
   - Wait for processing (typically 1-2 minutes)
   - Download the ZIP file with all segments

## Output

The downloaded ZIP contains:

```
segment_001.mp3          # First audio segment
segment_001.txt          # Transcript for first segment
segment_002.mp3          # Second audio segment
segment_002.txt          # Transcript for second segment
...
metadata.json            # Full metadata and timestamps
```

### metadata.json structure:
```json
{
  "original_file": "audio.mp3",
  "total_segments": 5,
  "max_duration": 60,
  "segments": [
    {
      "filename": "segment_001.mp3",
      "start_time": 0.0,
      "end_time": 58.4,
      "duration": 58.4,
      "text": "Full transcript for this segment..."
    }
  ],
  "full_transcript": "Complete transcript of entire audio..."
}
```

## Configuration

You can modify these settings in the web UI:

- **Max Segment Duration**: 10-300 seconds (default: 60)
- **API Key**: Your Replicate API token

## Segmentation Logic

The algorithm prioritizes natural speech breaks:

1. **Periods, Question marks, Exclamation points** (highest priority)
2. **Commas, Semicolons** (medium priority)
3. **Spaces** (lowest priority)

Each segment is made as long as possible without exceeding the max duration, ensuring it ends at a natural break point.

## Cost

Using Replicate's Whisper API:
- ~$0.00041 per audio file processed
- Processing time: ~2 seconds per file
- Very cost-effective for transcription

## Troubleshooting

**"ffmpeg not found" error:**
- Install ffmpeg (see Prerequisites section)

**"Invalid API key" error:**
- Make sure you copied the full API key from Replicate
- Check for extra spaces

**Processing takes too long:**
- Large files (>50MB) may take 2-5 minutes
- Check your internet connection

**File too large:**
- Max upload size is 500MB
- Compress your audio file or use a lower bitrate

## Technical Details

- **Backend**: Flask (Python)
- **Transcription**: OpenAI Whisper large-v3 via Replicate API
- **Audio Processing**: pydub + ffmpeg
- **Frontend**: Vanilla JavaScript (no framework)

## License

MIT License - feel free to use and modify!

## Credits

- Transcription powered by [OpenAI Whisper](https://github.com/openai/whisper)
- API provided by [Replicate](https://replicate.com/openai/whisper)

