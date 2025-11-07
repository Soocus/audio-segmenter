# 🎬 Kling AI Lip Sync Integration Guide

## Problem
[Kling AI](https://app.klingai.com/global/ai-human/video/new) has a lip-sync video generator with:
- ✅ **60-second limit per generation**
- ✅ **Unlimited concurrent generations**
- ❌ **No batch upload API**

This Audio Segmenter perfectly splits your audio into <60s chunks at natural breaks!

## Solution Options

### Option 1: Chrome Extension (Recommended) ⭐

**Best for:** Automated batch uploading to Kling

A Chrome extension can:
1. Communicate with your local Flask server
2. Auto-fill forms on the Kling website
3. Upload segments concurrently
4. Monitor generation progress

**How it works:**
```
Your Audio → Audio Segmenter → ZIP with segments
                                      ↓
Chrome Extension ← segments + preset video
       ↓
Kling Website (auto-upload all segments concurrently)
       ↓
Download all generated videos
```

**Files needed:**
- `manifest.json` - Extension configuration
- `background.js` - Communicates with your Flask server
- `content.js` - Interacts with Kling website
- `popup.html` - User interface

#### Quick Start Chrome Extension

1. **Create extension folder:**
```bash
mkdir kling-extension
cd kling-extension
```

2. **Create `manifest.json`:**
```json
{
  "manifest_version": 3,
  "name": "Kling Batch Uploader",
  "version": "1.0",
  "description": "Batch upload audio segments to Kling AI",
  "permissions": ["storage", "tabs"],
  "host_permissions": [
    "http://localhost:5001/*",
    "https://app.klingai.com/*"
  ],
  "action": {
    "default_popup": "popup.html"
  },
  "content_scripts": [
    {
      "matches": ["https://app.klingai.com/global/ai-human/video/new"],
      "js": ["content.js"]
    }
  ],
  "background": {
    "service_worker": "background.js"
  }
}
```

3. **Create `popup.html`:**
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { width: 300px; padding: 15px; }
    button { width: 100%; padding: 10px; margin: 5px 0; }
    .status { padding: 10px; background: #f0f0f0; border-radius: 5px; }
  </style>
</head>
<body>
  <h3>Kling Batch Uploader</h3>
  
  <button id="selectZip">Select ZIP from Audio Segmenter</button>
  <button id="selectVideo">Select Preset Video</button>
  <button id="startUpload" disabled>Start Batch Upload</button>
  
  <div class="status">
    <div>Selected segments: <span id="segmentCount">0</span></div>
    <div>Uploaded: <span id="uploadCount">0</span></div>
  </div>
  
  <script src="popup.js"></script>
</body>
</html>
```

4. **Create `popup.js`:**
```javascript
let selectedZip = null;
let selectedVideo = null;
let segments = [];

document.getElementById('selectZip').addEventListener('click', async () => {
  const [fileHandle] = await window.showOpenFilePicker({
    types: [{ description: 'ZIP Files', accept: {'application/zip': ['.zip']} }]
  });
  
  const file = await fileHandle.getFile();
  // Extract audio files from ZIP
  // Store in segments array
  document.getElementById('segmentCount').textContent = segments.length;
  checkReady();
});

document.getElementById('selectVideo').addEventListener('click', async () => {
  const [fileHandle] = await window.showOpenFilePicker({
    types: [{ description: 'Video Files', accept: {'video/*': ['.mp4', '.mov']} }]
  });
  
  selectedVideo = await fileHandle.getFile();
  checkReady();
});

function checkReady() {
  if (segments.length > 0 && selectedVideo) {
    document.getElementById('startUpload').disabled = false;
  }
}

document.getElementById('startUpload').addEventListener('click', async () => {
  // Send message to content script to start upload
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  
  chrome.tabs.sendMessage(tab.id, {
    action: 'startBatchUpload',
    segments: segments,
    video: selectedVideo
  });
});
```

5. **Create `content.js`:**
```javascript
// This runs on the Kling website
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startBatchUpload') {
    batchUpload(request.segments, request.video);
  }
});

async function batchUpload(segments, video) {
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    
    // Find audio upload input on Kling page
    const audioInput = document.querySelector('input[type="file"][accept*="audio"]');
    
    // Create a File object from segment data
    const audioFile = new File([segment.data], segment.filename, { type: 'audio/mpeg' });
    
    // Create a DataTransfer to set files
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(audioFile);
    audioInput.files = dataTransfer.files;
    
    // Trigger change event
    audioInput.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Upload video (reuse same video for all)
    const videoInput = document.querySelector('input[type="file"][accept*="video"]');
    const videoDataTransfer = new DataTransfer();
    videoDataTransfer.items.add(video);
    videoInput.files = videoDataTransfer.files;
    videoInput.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Click generate button
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for uploads
    
    const generateBtn = document.querySelector('button[class*="generate"]'); // Adjust selector
    if (generateBtn) generateBtn.click();
    
    // Wait before next upload (respect rate limits)
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
```

6. **Create `background.js`:**
```javascript
// Service worker for extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('Kling Batch Uploader installed');
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSegments') {
    // Fetch segments from local Flask server
    fetch('http://localhost:5001/api/list-segments')
      .then(response => response.json())
      .then(data => sendResponse({segments: data}))
      .catch(err => sendResponse({error: err.message}));
    return true; // Will respond asynchronously
  }
});
```

7. **Load extension in Chrome:**
   - Open Chrome → `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `kling-extension` folder

---

### Option 2: Python Automation Script

**Best for:** Simple automation without browser dependency

Use Selenium/Playwright to automate uploads:

```python
from selenium import webdriver
from selenium.webdriver.common.by import By
import time
import zipfile
import os

def upload_to_kling(segments_folder, video_path):
    driver = webdriver.Chrome()
    driver.get('https://app.klingai.com/global/ai-human/video/new')
    
    # Login if needed
    time.sleep(5)
    
    # Get all audio segments
    audio_files = sorted([f for f in os.listdir(segments_folder) if f.endswith('.mp3')])
    
    for audio_file in audio_files:
        audio_path = os.path.join(segments_folder, audio_file)
        
        # Upload audio
        audio_input = driver.find_element(By.CSS_SELECTOR, 'input[type="file"][accept*="audio"]')
        audio_input.send_keys(audio_path)
        
        # Upload video
        video_input = driver.find_element(By.CSS_SELECTOR, 'input[type="file"][accept*="video"]')
        video_input.send_keys(video_path)
        
        # Click generate
        generate_btn = driver.find_element(By.CSS_SELECTOR, 'button.generate')
        generate_btn.click()
        
        time.sleep(5)  # Wait between uploads
    
    driver.quit()

# Usage
upload_to_kling('/path/to/segments/audio/', '/path/to/preset_video.mp4')
```

---

### Option 3: Manual with Helper

**Best for:** One-time or occasional use

1. Download ZIP from Audio Segmenter
2. Extract `audio/` folder
3. Open Kling in browser
4. Use keyboard macro tool (AutoHotkey/Keyboard Maestro) to:
   - Auto-fill form
   - Upload next file
   - Click generate
   - Repeat

---

## Recommendation

**Start with Option 1 (Chrome Extension)** because:
- ✅ Best user experience
- ✅ Runs locally, no external dependencies
- ✅ Can handle concurrent uploads
- ✅ Visual feedback on progress
- ✅ Integrates seamlessly with your Flask app

The extension can even be enhanced to:
- Auto-download generated videos
- Stitch them back together in order
- Add progress tracking
- Handle errors and retries

---

## Next Steps

1. Test the audio segmenting with your 30-minute files
2. Build the Chrome extension (skeleton provided above)
3. Test with Kling manually first to understand their UI
4. Refine the extension's selectors for Kling's form elements
5. Add error handling and retry logic

Let me know if you want me to complete any part of the extension!

