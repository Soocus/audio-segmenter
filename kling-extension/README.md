# 🎬 Kling Complete Workflow - Chrome Extension

**All-in-one solution**: Segment audio with AI transcription → Batch upload to Kling → Download generated videos!

**No Python/Flask server required!** Everything runs directly in your browser.

## ✨ What's New in v2.0

### 🆕 Integrated Audio Segmenter (New First Tab!)
- **No Flask server needed** - Process audio entirely in the browser
- **AI-powered transcription** using Replicate's incredibly-fast-whisper
- **Smart splitting** at natural sentence breaks with word-level timestamps
- **One-click workflow** - Generate segments and continue to upload seamlessly
- **MP3 encoding** in-browser using lamejs
- **Secure API key storage** in Chrome's encrypted storage

### Key Benefits Over Standalone Flask App:
| Feature | Flask App | Chrome Extension |
|---------|-----------|------------------|
| Setup | Python, pip, server | One-click install |
| Portability | localhost only | Works anywhere |
| Workflow | 2 separate tools | 1 unified tool |
| Dependencies | Python 3.x, packages | None |
| API Key | Server environment | Secure browser storage |

## 📦 Installation

### 1. **Load Extension in Chrome**

1. Open Chrome and navigate to: `chrome://extensions/`
2. **Enable "Developer mode"** (toggle in the top right corner)
3. Click **"Load unpacked"**
4. Select the `kling-extension` folder from your Audio Segmenter directory:
   ```
   /Users/soocus/Library/CloudStorage/OneDrive-Personal/Code/audio-segmenter/kling-extension
   ```
5. The extension should now appear in your extensions list!

### 2. **Pin the Extension** (Optional but Recommended)

1. Click the puzzle piece icon in Chrome toolbar
2. Find "Kling Batch Uploader"
3. Click the pin icon to keep it visible

## 🚀 Usage

The extension has **three tabs**: **Segmenter** → **Upload** → **Download**

---

## ✂️ SEGMENTER TAB - AI Audio Segmentation (NEW!)

**No Flask server needed!** Process audio directly in the browser.

### Step 1: Get Replicate API Key
1. Visit [replicate.com/account/api-tokens](https://replicate.com/account/api-tokens)
2. Copy your API token
3. Paste it into the extension (saved securely in your browser)

### Step 2: Upload Audio File
1. Click "Choose Audio File"
2. Select your audio file (MP3, WAV, M4A, OGG, FLAC)
3. Extension shows duration automatically

### Step 3: Set Max Duration
- Default: 60 seconds (recommended for Kling)
- Adjust as needed (10-120 seconds)

### Step 4: Generate Segments
1. Click "🚀 Generate Segments"
2. Watch real-time progress:
   - Uploading to Replicate
   - Transcribing with AI (incredibly-fast-whisper)
   - Parsing word timestamps
   - Splitting audio intelligently
   - Creating ZIP file
3. Done! Download ZIP or **click "▶️ Continue to Upload Tab"** to proceed automatically

### What Happens During Segmentation?
- ✅ **AI Transcription** with word-level timestamps
- ✅ **Smart Splitting** at natural sentence breaks
- ✅ **MP3 Encoding** using lamejs (128kbps)
- ✅ **ZIP Creation** ready for Kling upload
- ✅ **One-Click Continue** to Upload tab

---

## 📤 UPLOAD TAB - Batch Upload Audio Segments

### Option A: From Segmenter Tab
- Click "▶️ Continue to Upload Tab" after segmentation
- Segments automatically loaded!

### Option B: Manual ZIP Upload
1. Have a ZIP file with audio segments from elsewhere
2. Click "Select ZIP File"

### Step 2: Prepare Your Preset Video
- Have your lip-sync preset video ready (the person/avatar you want to animate)
- Supported formats: MP4, MOV, AVI, WEBM

### Step 3: Open Kling AI
1. Navigate to https://app.klingai.com/global/ai-human/video/new
2. Make sure you're logged in

### Step 4: Use the Extension - Upload Tab
1. Click the **Kling Batch Uploader** icon in Chrome
2. Select the **Upload** tab
3. **Step 1:** Click "Select ZIP File" → Choose your downloaded ZIP
4. **Step 2:** Click "Choose Video File" → Select your preset video
5. **Step 3:** Click "🚀 Start Upload"
6. *(Optional)* Click "⏸ Pause" to pause/resume uploads

### What Happens During Upload?
The extension will automatically:
- Upload the **VIDEO FIRST** (required by Kling)
- Then upload each audio segment
- Click the generate button
- Wait between uploads to avoid rate limits
- Show progress in the extension popup
- Support pause/resume functionality

---

## 📥 DOWNLOAD TAB - Batch Download Generated Videos

### How It Works
The extension **automatically detects** Kling video URLs as they load in the background using Chrome's network interception!

### Step 1: Generate Videos on Kling
1. Use the Upload tab to batch upload your segments
2. Wait for Kling to generate your videos
3. Navigate to your Kling results page

### Step 2: Download Videos
1. Click the **Kling Batch Uploader** icon
2. Select the **Download** tab
3. *(Optional)* Click "🔍 Show Detected Videos (Optional)" to verify which videos will be downloaded
4. Set the number of videos to download (auto-set if you used a ZIP file)
5. *(Optional)* Uncheck "Download as single ZIP file" if you want individual MP4s
6. Click "📥 Download Videos"

### What Happens During Download?

**ZIP Download (Default & Recommended):**
- ✅ All videos bundled into one ZIP file
- ✅ Filename: `kling_videos_YYYY-MM-DD.zip`
- ✅ Inside: `segment_030.mp4` (newest) → `segment_001.mp4` (oldest)
- ✅ Single download prompt in Chrome
- ✅ Easier to manage and organize

**Individual Downloads:**
- Videos downloaded separately as MP4 files
- Multiple Chrome download prompts
- Filenames: `segment_030.mp4` (newest) → `segment_001.mp4` (oldest)
- Progress shown in real-time

### 💡 Pro Tip
The extension automatically detects videos in the background, so you can download immediately without clicking "Show Detected Videos" first!

## 🎯 How It Works

### Complete Workflow (All in Extension!)

```
Step 1: SEGMENTER TAB
Your Audio File (any length)
        ↓
Replicate API (AI Transcription with word timestamps)
        ↓
Smart Splitting (at natural sentence breaks, max 60s)
        ↓
MP3 Encoding (lamejs, 128kbps)
        ↓
ZIP File Creation

Step 2: UPLOAD TAB (One-click from Segmenter!)
ZIP with segments
        ↓
For each segment:
    - Upload video FIRST (Kling requirement)
    - Upload audio segment
    - Click generate
    - Wait between uploads
        ↓
All lip-synced videos generating on Kling!

Step 3: DOWNLOAD TAB
Background detection of video URLs
        ↓
Automatic capture as videos load
        ↓
One-click download as ZIP or individual files
        ↓
Complete! Ready to use
```

## ⚙️ Configuration

### Upload Timing
By default, the extension waits **3 seconds** between uploads. You can adjust this in `content.js`:

```javascript
await sleep(3000); // Change to 2000 for faster, 5000 for slower
```

### Selector Compatibility
The extension tries multiple selectors to find Kling's upload buttons. If Kling changes their UI, you may need to update selectors in `content.js`.

## 🐛 Troubleshooting

### "Failed to communicate with page"
- **Solution:** Refresh the Kling page and try again
- The content script needs to be loaded on the page

### "Audio upload input not found"
- **Solution:** Kling may have changed their UI
- Check browser console (F12) for error messages
- Update selectors in `content.js` if needed

### Extension not showing up
- **Solution:** 
  1. Go to `chrome://extensions/`
  2. Find "Kling Batch Uploader"
  3. Click "Reload" button
  4. Check for errors in "Errors" section

### Uploads not working
- **Solution:**
  1. Open browser console (F12)
  2. Look for errors in Console tab
  3. Make sure you're on the correct Kling page
  4. Try uploading one manually first to see the UI

### Downloads not detecting videos
- **Solution:**
  1. Reload the extension in `chrome://extensions/`
  2. Refresh the Kling results page
  3. Wait for videos to load completely
  4. Open extension and check Download tab

### ZIP download failing
- **Solution:**
  1. Try downloading as individual files instead (uncheck ZIP option)
  2. Check if you have enough disk space
  3. Try with fewer videos at once
  4. Check browser console (F12) for CORS errors

### Segmentation fails with API error
- **Solution:**
  1. Verify your Replicate API key is correct
  2. Check your Replicate account has credits
  3. Try with a shorter audio file first
  4. Check browser console (F12) for detailed error

### Audio file won't load
- **Solution:**
  1. Supported formats: MP3, WAV, M4A, OGG, FLAC
  2. Try converting to MP3 first
  3. Check file isn't corrupted
  4. Try a different browser (Chrome recommended)

### Transcription taking too long
- **Solution:**
  1. Large files (>30 min) take several minutes
  2. Don't close the extension popup
  3. Progress bar shows current step
  4. Check Replicate dashboard for job status

## 📝 Technical Details

### Files Structure
```
kling-extension/
├── manifest.json       # Extension configuration
├── popup.html          # Extension popup UI (3 tabs)
├── popup.js            # Main logic (segmenter, upload, download)
├── content.js          # Runs on Kling page (uploads)
├── background.js       # Service worker (video detection, downloads)
├── jszip.min.js        # ZIP file handling
├── lame.min.js         # MP3 encoding (NEW!)
├── icon16.png          # Extension icon 16x16
├── icon48.png          # Extension icon 48x48
├── icon128.png         # Extension icon 128x128
└── README.md           # This file
```

### Permissions Used
- `storage` - Store API key, user preferences, and pause state
- `downloads` - Download generated videos from Kling
- `webRequest` - Intercept network requests to detect video URLs
- `host_permissions`:
  - `https://api.replicate.com/*` - AI transcription (NEW!)
  - `https://*.klingai.com/*` - Kling CDN video detection
  - `https://app.klingai.com/*` - Upload automation
- Content scripts run only on Kling's lip-sync page

### Libraries Used
- **JSZip** (v3.10.1) - ZIP file creation/extraction
- **lamejs** (v1.2.1) - MP3 encoding (NEW!)
- **Web Audio API** - Audio decoding/processing (built-in)
- **Fetch API** - Replicate API communication (built-in)
- All libraries included locally for security and reliability

## 🔒 Privacy & Security

- **API Key Storage**: Stored securely in `chrome.storage.sync` (encrypted by Chrome)
- **Audio Processing**: Files processed locally in browser, only sent to Replicate API
- **No Server Required**: Everything runs client-side (except Replicate transcription)
- **No Analytics**: No tracking, no data collection
- **Open Source**: All code visible in extension files

### 💰 Costs

- **Replicate API**: ~$0.006 per minute of audio (incredibly-fast-whisper model)
- **Extension**: Free and open source
- **Example**: 30-minute audio = ~$0.18 to transcribe

## 🆘 Support

If you encounter issues:
1. Check the browser console (F12) for errors
2. Make sure Flask server is running on localhost:5001
3. Verify you're on the correct Kling page
4. Try manually uploading one file to Kling first

## 🎨 Customization

### Change Upload Delay
Edit `content.js` line with `await sleep(3000)` to adjust timing between uploads.

### Add Custom Selectors
If Kling changes their UI, add new selectors to the arrays in `content.js`:
```javascript
const audioSelectors = [
  '[data-testid="audio-upload"]',
  'input[type="file"][accept*="audio"]',
  // Add your selector here
];
```

## 📊 Performance

- **Upload Speed:** ~3-5 seconds per segment
- **Concurrent Generations:** Unlimited (Kling's feature)
- **Memory Usage:** Minimal (files streamed, not stored)

For 30 segments:
- Upload time: ~3 minutes
- Kling generation: ~1-2 minutes (concurrent)
- **Total: ~5 minutes** for complete lip-sync video batch!

Enjoy your automated Kling lip-sync workflow! 🎉

