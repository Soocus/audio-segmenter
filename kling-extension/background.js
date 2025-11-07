// Background service worker for the extension

// Store detected video URLs
let detectedVideos = [];

// Offscreen document management
let offscreenDocumentCreating = null;

chrome.runtime.onInstalled.addListener(() => {
  console.log('Kling Complete Workflow installed successfully');
});

// Create offscreen document for audio processing
async function createOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  
  if (existingContexts.length > 0) {
    console.log('Offscreen document already exists');
    return;
  }
  
  if (offscreenDocumentCreating) {
    await offscreenDocumentCreating;
  } else {
    offscreenDocumentCreating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'], // Use AUDIO_PLAYBACK for Web Audio API
      justification: 'Process and encode audio segments in the background'
    });
    
    await offscreenDocumentCreating;
    offscreenDocumentCreating = null;
    console.log('Offscreen document created');
  }
}

// Close offscreen document when not needed
async function closeOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  
  if (existingContexts.length > 0) {
    await chrome.offscreen.closeDocument();
    console.log('Offscreen document closed');
  }
}

// Intercept network requests to capture video URLs
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    
    // Only capture Kling CDN video requests for GENERATED OUTPUT videos (lip-synced results)
    // Pattern: https://v15-kling.klingai.com/bs2/upload-ylab-stunt-sgp/video_mps_multiple_bitrate_[uuid]?x-kcdn-pid=...
    // NOT ai_portal (those are the original input videos)
    if (url.includes('kling.klingai.com') && 
        url.includes('/bs2/') && 
        url.includes('video_mps_multiple_bitrate_') &&  // Only lip-synced output videos
        url.includes('?x-kcdn-pid=')) {
      
      console.log('Captured Kling output video URL:', url);
      
      // Check if this URL is already in the list
      const exists = detectedVideos.some(v => v.url === url);
      
      if (!exists) {
        detectedVideos.unshift({ // Add to beginning (newest first)
          url: url,
          timestamp: Date.now(),
          detectionOrder: detectedVideos.length // Store detection order
        });
        
        // Keep only last 100 videos
        if (detectedVideos.length > 100) {
          detectedVideos = detectedVideos.slice(0, 100);
        }
        
        console.log(`Total detected videos: ${detectedVideos.length}`);
      }
    }
    
    return { cancel: false };
  },
  { urls: ["https://*.klingai.com/*"] },
  []
);

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.action);
  
  // Get detected videos list
  if (message.action === 'getDetectedVideos') {
    // Since we're detecting via network requests as videos load,
    // the order is based on when network requests complete.
    // Most recent videos load first, so they should already be at the beginning.
    // We use unshift() when adding, so newest is at index 0.
    console.log(`Sending ${detectedVideos.length} detected videos to popup (newest first)`);
    
    // Debug: Show first 5 videos
    if (detectedVideos.length > 0) {
      console.log('First 5 videos (should be newest → oldest):');
      detectedVideos.slice(0, 5).forEach((v, idx) => {
        const urlShort = v.url.substring(v.url.lastIndexOf('/') + 1, Math.min(v.url.indexOf('?'), v.url.lastIndexOf('/') + 50));
        console.log(`  ${idx + 1}. ${urlShort} (detected at: ${new Date(v.timestamp).toLocaleTimeString()})`);
      });
    }
    
    sendResponse({ videos: detectedVideos });
    return true;
  }
  
  // Clear detected videos
  if (message.action === 'clearDetectedVideos') {
    detectedVideos = [];
    console.log('Cleared detected videos');
    sendResponse({ success: true });
    return true;
  }
  
  // Handle file downloads
  if (message.action === 'downloadFile') {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename,
      saveAs: false // Auto-save to default downloads folder
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download error:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('Download started:', downloadId);
        sendResponse({ success: true, downloadId: downloadId });
      }
    });
    return true; // Keep channel open for async response
  }
  
  // Process audio in offscreen document
  if (message.action === 'processAudioOffscreen') {
    (async () => {
      try {
        console.log('Creating offscreen document for audio processing...');
        await createOffscreenDocument();
        console.log('Offscreen document created, sending audio data...');
        
        // Small delay to ensure offscreen document is ready
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Forward to offscreen document
        const response = await chrome.runtime.sendMessage({
          action: 'processAudio',
          data: message.data
        });
        
        console.log('Received response from offscreen:', response);
        sendResponse(response);
        
        // Close offscreen document after processing (optional - can keep alive for performance)
        // await closeOffscreenDocument();
      } catch (error) {
        console.error('Error in offscreen processing:', error);
        console.error('Error stack:', error.stack);
        sendResponse({ success: false, error: error.message + ' | ' + error.stack });
      }
    })();
    return true; // Keep channel open for async response
  }
  
  // Parse transcript in offscreen document
  if (message.action === 'parseTranscriptOffscreen') {
    (async () => {
      try {
        await createOffscreenDocument();
        
        // Forward to offscreen document
        const response = await chrome.runtime.sendMessage({
          action: 'parseTranscript',
          transcriptData: message.transcriptData,
          maxDuration: message.maxDuration
        });
        
        sendResponse(response);
      } catch (error) {
        console.error('Error parsing transcript:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  
  // Relay progress updates from offscreen to popup
  if (message.action === 'offscreenProgress') {
    // Forward to all popup windows
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup might be closed, that's okay
      console.log('Could not relay progress (popup closed)');
    });
    return true;
  }
  
  // Relay messages between popup and content scripts if needed
  if (message.action === 'uploadProgress' || message.action === 'downloadProgress' || message.action === 'downloadError') {
    // Forward progress updates to all popup windows
    chrome.runtime.sendMessage(message);
  }
  
  return true;
});

