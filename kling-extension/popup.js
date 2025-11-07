let audioSegments = [];
let presetVideo = null;
let presetVideoName = '';
let isPaused = false;
let isUploading = false;
let generatedSegmentsZip = null; // Store generated ZIP for upload tab
let isSegmenting = false; // Track if segmentation is in progress
let referenceAudioDurations = []; // Store audio durations for reference length feature

// Segmenter tab elements
const segmenterTab = document.getElementById('segmenterTab');
const segmenterContent = document.getElementById('segmenterContent');
const replicateApiKeyInput = document.getElementById('replicateApiKey');
const selectAudioFileBtn = document.getElementById('selectAudioFile');
const audioFileStatus = document.getElementById('audioFileStatus');
const audioFileName = document.getElementById('audioFileName');
const audioDuration = document.getElementById('audioDuration');
const maxDurationInput = document.getElementById('maxDuration');
const startSegmentationBtn = document.getElementById('startSegmentation');
const segmentationStatus = document.getElementById('segmentationStatus');
const segmentationResult = document.getElementById('segmentationResult');
const downloadSegmentsZipBtn = document.getElementById('downloadSegmentsZip');
const continueToUploadBtn = document.getElementById('continueToUpload');

// Upload tab elements
const selectZipBtn = document.getElementById('selectZip');
const selectVideoBtn = document.getElementById('selectVideo');
const startUploadBtn = document.getElementById('startUpload');
const pauseUploadBtn = document.getElementById('pauseUpload');
const scanVideosBtn = document.getElementById('scanVideos');
const startDownloadBtn = document.getElementById('startDownload');
const zipStatus = document.getElementById('zipStatus');
const videoStatus = document.getElementById('videoStatus');
const uploadStatus = document.getElementById('uploadStatus');
const downloadStatus = document.getElementById('downloadStatus');
const videoListContainer = document.getElementById('videoListContainer');
const videoList = document.getElementById('videoList');
const warning = document.getElementById('warning');

// Download tab - Reference Length elements
const selectReferenceZipBtn = document.getElementById('selectReferenceZip');
const referenceZipStatus = document.getElementById('referenceZipStatus');
const referenceSegmentCount = document.getElementById('referenceSegmentCount');

let detectedVideos = [];
let currentAudioFile = null;
let currentAudioBuffer = null;

// Tab switching
const uploadTab = document.getElementById('uploadTab');
const downloadTab = document.getElementById('downloadTab');
const uploadContent = document.getElementById('uploadContent');
const downloadContent = document.getElementById('downloadContent');

segmenterTab.addEventListener('click', () => {
  segmenterTab.classList.add('active');
  uploadTab.classList.remove('active');
  downloadTab.classList.remove('active');
  segmenterContent.classList.add('active');
  uploadContent.classList.remove('active');
  downloadContent.classList.remove('active');
});

uploadTab.addEventListener('click', async () => {
  uploadTab.classList.add('active');
  segmenterTab.classList.remove('active');
  downloadTab.classList.remove('active');
  uploadContent.classList.add('active');
  segmenterContent.classList.remove('active');
  downloadContent.classList.remove('active');
  
  // Update timestamp when viewing upload tab (keeps 30-minute memory alive)
  chrome.storage.local.set({ uploadFilesTimestamp: Date.now() });
  
  // Restore audio segments if we have a saved ZIP but no segments loaded
  if (audioSegments.length === 0 && generatedSegmentsZip) {
    try {
      const zip = await JSZip.loadAsync(generatedSegmentsZip);
      const mp3Files = [];
      
      zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir && relativePath.toLowerCase().endsWith('.mp3')) {
          mp3Files.push({ name: relativePath, entry: zipEntry });
        }
      });
      
      mp3Files.sort((a, b) => a.name.localeCompare(b.name));
      
      audioSegments = [];
      for (const file of mp3Files) {
        const blob = await file.entry.async('blob');
        const dataUrl = await blobToDataUrl(blob);
        audioSegments.push({
          name: file.name,
          data: dataUrl
        });
      }
      
      // Update upload tab UI
      document.getElementById('segmentCount').textContent = audioSegments.length;
      zipStatus.style.display = 'block';
      document.getElementById('videoCount').value = audioSegments.length;
    } catch (error) {
      console.error('Error loading segments into upload tab:', error);
    }
  }
});

downloadTab.addEventListener('click', () => {
  downloadTab.classList.add('active');
  uploadTab.classList.remove('active');
  segmenterTab.classList.remove('active');
  downloadContent.classList.add('active');
  uploadContent.classList.remove('active');
  segmenterContent.classList.remove('active');
  
  // Auto-check for detected videos when switching to download tab
  checkForDetectedVideos();
});

// Function to check for detected videos and enable download button
function checkForDetectedVideos() {
  chrome.runtime.sendMessage({ action: 'getDetectedVideos' }, (response) => {
    if (response && response.videos && response.videos.length > 0) {
      // Convert and store detected videos
      detectedVideos = response.videos.map(v => ({
        src: v.url,
        downloadUrl: v.url,
        hasDownloadLink: false,
        duration: 0
      }));
      
      // Enable download button if videos are detected
      startDownloadBtn.disabled = false;
      
      // Update count if it's currently 0 and no ZIP loaded
      const currentCount = parseInt(document.getElementById('videoCount').value);
      if (currentCount === 0) {
        document.getElementById('videoCount').value = detectedVideos.length;
      }
      
      console.log(`Auto-detected ${detectedVideos.length} videos`);
    }
  });
}

// Check for videos on popup open
checkForDetectedVideos();

// Check for existing upload state and saved files on popup open
chrome.storage.local.get([
  'uploadState', 
  'uploadSegments', 
  'uploadVideo',
  'savedZipData',
  'savedVideoData',
  'savedVideoName',
  'uploadFilesTimestamp'
], async (result) => {
  // Check if saved files should be auto-cleaned (30 minutes = 1800000ms)
  const now = Date.now();
  if (result.uploadFilesTimestamp && (now - result.uploadFilesTimestamp) > 1800000) {
    console.log('Auto-cleaning upload files (30+ minutes since last activity)');
    chrome.storage.local.remove([
      'savedZipData',
      'savedVideoData',
      'savedVideoName',
      'uploadFilesTimestamp'
    ]);
  } else {
    // Restore saved ZIP file if available
    if (result.savedZipData && result.uploadSegments && result.uploadSegments.length > 0) {
      console.log('Restoring saved ZIP file from storage');
      
      // Convert data URLs back to blobs
      audioSegments = [];
      for (const segment of result.uploadSegments) {
        const response = await fetch(segment.data);
        const blob = await response.blob();
        audioSegments.push({
          name: segment.name,
          data: blob
        });
      }
      
      document.getElementById('segmentCount').textContent = audioSegments.length;
      zipStatus.style.display = 'block';
      selectZipBtn.textContent = '✓ ZIP Loaded';
      selectZipBtn.style.background = '#48bb78';
      document.getElementById('videoCount').value = audioSegments.length;
      
      checkReady();
    }
    
    // Restore saved video file if available
    if (result.savedVideoData && result.savedVideoName) {
      console.log('Restoring saved video file from storage:', result.savedVideoName);
      
      // Convert data URL back to File-like object
      const response = await fetch(result.savedVideoData);
      const blob = await response.blob();
      presetVideo = new File([blob], result.savedVideoName, { type: 'video/mp4' });
      presetVideoName = result.savedVideoName;
      
      document.getElementById('videoName').textContent = presetVideoName;
      videoStatus.style.display = 'block';
      selectVideoBtn.textContent = '✓ Video Selected';
      selectVideoBtn.style.background = '#48bb78';
      
      checkReady();
    }
  }
  
  // Check for active upload state (for resume functionality)
  if (result.uploadState && result.uploadState.isActive) {
    console.log('Found active upload state, restoring...');
    
    // Restore segments and video for upload process
    if (result.uploadSegments && result.uploadSegments.length > 0) {
      audioSegments = result.uploadSegments;
      document.getElementById('segmentCount').textContent = audioSegments.length;
      zipStatus.style.display = 'block';
    }
    
    if (result.uploadVideo) {
      presetVideo = result.uploadVideo;
      presetVideoName = result.uploadVideo.name;
      document.getElementById('videoName').textContent = presetVideoName;
      videoStatus.style.display = 'block';
    }
    
    // Show upload status
    uploadStatus.style.display = 'block';
    document.getElementById('totalCount').textContent = result.uploadState.total;
    document.getElementById('uploadCount').textContent = result.uploadState.currentIndex + 1;
    
    // Show pause button
    pauseUploadBtn.style.display = 'block';
    
    // Check if it was paused
    if (result.uploadState.isPaused) {
      isPaused = true;
      pauseUploadBtn.textContent = '▶️ Resume';
      pauseUploadBtn.style.background = '#48bb78';
      document.getElementById('currentFile').textContent = '⏸️ Paused - Click Resume to continue';
    } else {
      // Show that upload is in progress
      document.getElementById('currentFile').textContent = 
        `Upload in progress... Segment ${result.uploadState.currentIndex + 1}/${result.uploadState.total}`;
    }
    
    // Enable start button so user can resume
    startUploadBtn.disabled = false;
    startUploadBtn.textContent = '▶️ Resume Upload';
  }
});

// Listen for progress updates from offscreen document
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'offscreenProgress') {
    console.log('Received offscreen progress:', message.percent, message.status);
    updateSegmentationProgress(message.percent, message.status, message.detail);
  }
  return true;
});

// Refresh button - clears all saved data
const refreshBtn = document.getElementById('refreshBtn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    if (confirm('Clear all saved data and reset the extension? This will cancel any in-progress segmentation, clear your API key, and remove saved files.')) {
      console.log('Clearing all extension data...');
      
      // Clear all storage
      chrome.storage.local.clear(() => {
        console.log('Local storage cleared');
        
        // Clear sync storage (including API key)
        chrome.storage.sync.clear(() => {
          console.log('Sync storage cleared (API key removed)');
        });
        
        // Reset UI variables
        audioSegments = [];
        presetVideo = null;
        presetVideoName = '';
        generatedSegmentsZip = null;
        currentAudioFile = null;
        currentAudioBuffer = null;
        
        // Clear API key input
        replicateApiKeyInput.value = '';
        
        // Hide all status displays
        segmentationStatus.style.display = 'none';
        segmentationResult.style.display = 'none';
        audioFileStatus.style.display = 'none';
        zipStatus.style.display = 'none';
        videoStatus.style.display = 'none';
        uploadStatus.style.display = 'none';
        downloadStatus.style.display = 'none';
        videoListContainer.style.display = 'none';
        
        // Reset buttons
        startSegmentationBtn.disabled = true;
        startUploadBtn.disabled = true;
        startDownloadBtn.disabled = true;
        
        // Reset upload tab button texts and colors
        selectZipBtn.textContent = 'Select ZIP File';
        selectZipBtn.style.background = '';
        selectVideoBtn.textContent = 'Choose Video File';
        selectVideoBtn.style.background = '';
        
        alert('Extension reset! All saved data, files, and API key cleared.');
        console.log('Extension reset complete');
      });
    }
  });
}

// =====================================================
// SEGMENTER TAB LOGIC
// =====================================================

// Load saved API key and restore state
chrome.storage.sync.get(['replicateApiKey'], (result) => {
  if (result.replicateApiKey) {
    replicateApiKeyInput.value = result.replicateApiKey;
    checkSegmenterReadiness();
  }
});

// Restore segmentation state when popup reopens
chrome.storage.local.get([
  'segmentationState', 
  'generatedZip', 
  'audioFileName', 
  'audioDuration',
  'audioDurationSeconds',
  'segmentCount',
  'predictionId',
  'replicateApiKey',
  'maxDuration',
  'segmentationStartTime',
  'audioDataUrl',
  'transcriptData'
], async (result) => {
  // Check if storage should be auto-cleaned (30 minutes = 1800000ms)
  const now = Date.now();
  if (result.segmentationStartTime && (now - result.segmentationStartTime) > 1800000) {
    console.log('Auto-cleaning storage (30+ minutes since last activity)');
    chrome.storage.local.remove([
      'segmentationState',
      'generatedZip',
      'segmentCount',
      'predictionId',
      'maxDuration',
      'segmentationStartTime',
      'audioDataUrl',
      'audioFileName',
      'audioDuration',
      'audioDurationSeconds',
      'transcriptData'
    ]);
    return;
  }
  
  if (result.segmentationState === 'in-progress') {
    segmentationStatus.style.display = 'block';
    startSegmentationBtn.disabled = true;
    
    // Show a message that processing is running
    updateSegmentationProgress(50, 'Processing in background...', 'Checking status...');
    
    try {
      // Check if we have transcript data (transcription completed but processing interrupted)
      if (result.transcriptData) {
        console.log('Found transcript data - attempting to resume audio processing');
        
        // Restore audio buffer from saved data URL if needed
        if (result.audioDataUrl && !currentAudioBuffer) {
          updateSegmentationProgress(55, 'Restoring audio data...', 'Loading audio buffer...');
          const response = await fetch(result.audioDataUrl);
          const arrayBuffer = await response.arrayBuffer();
          const audioContext = new AudioContext();
          currentAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          console.log('Audio buffer restored, duration:', currentAudioBuffer.duration);
        }
        
        console.log('Resuming from processing step (transcription already complete)');
        updateSegmentationProgress(58, 'Resuming segmentation...', 'Processing transcript...');
        
        try {
          await processTranscriptionResult(result.transcriptData, result.maxDuration || 60);
        } catch (error) {
          console.error('Failed to process transcript on resume:', error);
          console.error('Error details:', error.message, error.stack);
          throw error;
        }
      } else if (result.predictionId) {
        // Transcription still in progress - resume polling
        console.log('Resuming segmentation polling for prediction:', result.predictionId);
        
        // Restore audio buffer if needed for later processing
        if (result.audioDataUrl && !currentAudioBuffer) {
          updateSegmentationProgress(42, 'Restoring audio data...', 'Loading audio buffer...');
          const response = await fetch(result.audioDataUrl);
          const arrayBuffer = await response.arrayBuffer();
          const audioContext = new AudioContext();
          currentAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          console.log('Audio buffer restored, duration:', currentAudioBuffer.duration);
        }
        
        updateSegmentationProgress(40, 'Resuming transcription...', 'Checking status...');
        await resumeSegmentation(
          result.predictionId,
          result.replicateApiKey,
          result.maxDuration || 60,
          result.audioDataUrl
        );
      } else {
        // No prediction ID or transcript data - something went wrong
        console.error('Cannot resume: missing both prediction ID and transcript data');
        throw new Error('Cannot resume: missing prediction ID or transcript data');
      }
    } catch (error) {
      console.error('Failed to resume segmentation:', error);
      console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      showWarning('Segmentation failed to resume: ' + error.message + '. Please start a new segmentation.');
      segmentationStatus.style.display = 'none';
      startSegmentationBtn.disabled = false;
      chrome.storage.local.remove(['predictionId', 'transcriptData']);
      chrome.storage.local.set({ segmentationState: 'idle' });
    }
  } else if (result.segmentationState === 'complete' && result.generatedZip) {
    // Segmentation completed - restore results
    try {
      // Convert base64 back to blob
      fetch(result.generatedZip)
        .then(res => res.blob())
        .then(blob => {
          generatedSegmentsZip = blob;
          segmentationResult.style.display = 'block';
          document.getElementById('totalSegments').textContent = result.segmentCount || 0;
        });
    } catch (e) {
      console.error('Failed to restore ZIP:', e);
    }
  }
  
  // Restore audio file if available
  if (result.audioFileName && result.audioDataUrl) {
    console.log('Restoring audio file from storage:', result.audioFileName);
    audioFileName.textContent = result.audioFileName;
    audioDuration.textContent = result.audioDuration;
    audioFileStatus.style.display = 'block';
    
    // Restore audio buffer in the background
    try {
      const response = await fetch(result.audioDataUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new AudioContext();
      currentAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Create a pseudo-file object for compatibility
      currentAudioFile = {
        name: result.audioFileName,
        size: arrayBuffer.byteLength,
        type: 'audio/mpeg'
      };
      
      console.log('Audio buffer restored from storage, duration:', currentAudioBuffer.duration);
      checkSegmenterReadiness();
    } catch (error) {
      console.error('Failed to restore audio buffer:', error);
      // Don't show error to user, just log it - they can re-select the file
    }
  }
});

// Save API key when changed
replicateApiKeyInput.addEventListener('input', () => {
  const apiKey = replicateApiKeyInput.value.trim();
  if (apiKey) {
    chrome.storage.sync.set({ replicateApiKey: apiKey });
  }
  checkSegmenterReadiness();
});

// Check if segmentation can start
function checkSegmenterReadiness() {
  const hasApiKey = replicateApiKeyInput.value.trim().length > 0;
  const hasAudio = currentAudioFile !== null;
  startSegmentationBtn.disabled = !(hasApiKey && hasAudio);
}

// Select audio file
selectAudioFileBtn.addEventListener('click', async () => {
  try {
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{
        description: 'Audio Files',
        accept: {
          'audio/*': ['.mp3', '.wav', '.m4a', '.ogg', '.flac']
        }
      }],
      multiple: false
    });
    
    const file = await fileHandle.getFile();
    currentAudioFile = file;
    
    // Clear previous segmentation results when selecting new audio
    generatedSegmentsZip = null;
    segmentationResult.style.display = 'none';
    chrome.storage.local.remove(['predictionId', 'transcriptData', 'generatedZip']);
    chrome.storage.local.set({ 
      segmentationState: 'idle',
      segmentCount: 0
    });
    
    // Load audio to get duration
    const audioContext = new AudioContext();
    const arrayBuffer = await file.arrayBuffer();
    currentAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    const durationMinutes = Math.floor(currentAudioBuffer.duration / 60);
    const durationSeconds = Math.floor(currentAudioBuffer.duration % 60);
    
    audioFileName.textContent = file.name;
    audioDuration.textContent = `${durationMinutes}:${durationSeconds.toString().padStart(2, '0')}`;
    audioFileStatus.style.display = 'block';
    
    // Convert audio to data URL and save everything
    const audioDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    
    // Save audio file info and data
    chrome.storage.local.set({
      audioFileName: file.name,
      audioDuration: `${durationMinutes}:${durationSeconds.toString().padStart(2, '0')}`,
      audioDataUrl: audioDataUrl,
      audioDurationSeconds: currentAudioBuffer.duration,
      segmentationStartTime: Date.now() // Update activity timestamp
    });
    
    console.log('Audio file saved to storage');
    
    checkSegmenterReadiness();
    
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Error selecting audio file:', error);
      showWarning('Failed to load audio file: ' + error.message);
    }
  }
});

// Start segmentation process
startSegmentationBtn.addEventListener('click', async () => {
  try {
    console.log('🚀 Starting segmentation process...');
    warning.style.display = 'none';
    segmentationStatus.style.display = 'block';
    segmentationResult.style.display = 'none';
    startSegmentationBtn.disabled = true;
    
    const apiKey = replicateApiKeyInput.value.trim();
    const maxDuration = parseInt(maxDurationInput.value);
    
    console.log('Audio file:', currentAudioFile.name, 'Size:', currentAudioFile.size, 'Duration:', currentAudioBuffer.duration);
    
    // Validate file size - Replicate has a limit around 25MB for data URLs
    const fileSizeMB = currentAudioFile.size / (1024 * 1024);
    const maxSizeMB = 20; // Conservative limit to account for base64 encoding overhead
    
    if (fileSizeMB > maxSizeMB) {
      throw new Error(`Audio file is too large (${fileSizeMB.toFixed(1)}MB). Maximum size for direct upload is ${maxSizeMB}MB. Please use the webapp at localhost:5001 for larger files, or compress your audio file.`);
    }
    
    // Step 1: Get audio data URL (use cached version if available)
    updateSegmentationProgress(10, 'Preparing audio for upload...', 'Loading audio data');
    
    let audioDataUrl;
    const cachedData = await new Promise(resolve => {
      chrome.storage.local.get(['audioDataUrl'], result => resolve(result.audioDataUrl));
    });
    
    if (cachedData) {
      console.log('Using cached audio data URL');
      audioDataUrl = cachedData;
    } else {
      console.log('Converting audio file to data URL...');
      audioDataUrl = await fileToDataUrl(currentAudioFile);
      console.log('Audio converted to data URL, length:', audioDataUrl.length);
    }
    
    // Check data URL size (base64 adds ~33% overhead)
    const dataUrlSizeMB = audioDataUrl.length / (1024 * 1024);
    if (dataUrlSizeMB > 25) {
      throw new Error(`Audio data is too large for API (${dataUrlSizeMB.toFixed(1)}MB encoded). Please use the webapp at localhost:5001 for this file.`);
    }
    
    // Mark segmentation as in-progress with all necessary data
    chrome.storage.local.set({ 
      segmentationState: 'in-progress',
      replicateApiKey: apiKey,
      maxDuration: maxDuration,
      segmentationStartTime: Date.now(),
      audioDataUrl: audioDataUrl
    });
    
    // Step 2: Call Replicate API for transcription
    updateSegmentationProgress(20, 'Starting transcription...', 'Using incredibly-fast-whisper model');
    
    const predictionResponse = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: '3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c',
        input: {
          audio: audioDataUrl,
          task: 'transcribe',
          batch_size: 4,
          timestamp: 'word',
          diarise_audio: false
        }
      })
    });
    
    if (!predictionResponse.ok) {
      const errorText = await predictionResponse.text();
      console.error('Replicate API error:', predictionResponse.status, errorText);
      
      // Provide helpful error messages
      let errorMessage = `Replicate API error: ${predictionResponse.status}`;
      if (predictionResponse.status === 413) {
        errorMessage = `Audio file is too large for Replicate API (413 Payload Too Large). Please use the webapp at localhost:5001 instead, which can handle larger files.`;
      } else if (predictionResponse.status === 401) {
        errorMessage = 'Invalid API key. Please check your Replicate API key.';
      } else if (predictionResponse.status === 429) {
        errorMessage = 'Rate limit exceeded. Please wait a few minutes and try again.';
      }
      
      throw new Error(errorMessage);
    }
    
    let prediction = await predictionResponse.json();
    const predictionId = prediction.id;
    console.log('Prediction started:', predictionId);
    
    // Save prediction ID so we can resume if popup closes
    chrome.storage.local.set({ 
      predictionId: predictionId,
      segmentationStartTime: Date.now()
    });
    
    // Step 3: Poll for results and process
    await continuePollingAndProcess(predictionId, apiKey, maxDuration);
    
  } catch (error) {
    console.error('❌ Segmentation error:', error);
    showWarning('Segmentation failed: ' + error.message);
    segmentationStatus.style.display = 'none';
    startSegmentationBtn.disabled = false;
    
    // Clear in-progress state and temporary data on error
    chrome.storage.local.remove(['predictionId', 'transcriptData']);
    chrome.storage.local.set({ segmentationState: 'idle' });
  }
});

// Download segments ZIP
downloadSegmentsZipBtn.addEventListener('click', () => {
  if (!generatedSegmentsZip) return;
  
  const url = URL.createObjectURL(generatedSegmentsZip);
  const a = document.createElement('a');
  a.href = url;
  // Add timestamp to prevent Chrome auto-renaming with " 2"
  const timestamp = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
  a.download = `audio_segments_${timestamp}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  // Update activity timestamp
  chrome.storage.local.set({ segmentationStartTime: Date.now() });
});

// Continue to Upload tab
continueToUploadBtn.addEventListener('click', async () => {
  if (!generatedSegmentsZip) return;
  
  // Load the ZIP into the upload tab
  try {
    const zip = await JSZip.loadAsync(generatedSegmentsZip);
    const mp3Files = [];
    
    zip.forEach((relativePath, zipEntry) => {
      if (!zipEntry.dir && relativePath.toLowerCase().endsWith('.mp3')) {
        mp3Files.push({ name: relativePath, entry: zipEntry });
      }
    });
    
    mp3Files.sort((a, b) => a.name.localeCompare(b.name));
    
    audioSegments = [];
    for (const file of mp3Files) {
      const blob = await file.entry.async('blob');
      const dataUrl = await blobToDataUrl(blob);
      audioSegments.push({
        name: file.name,
        data: dataUrl
      });
    }
    
    // Update upload tab UI
    document.getElementById('segmentCount').textContent = audioSegments.length;
    zipStatus.style.display = 'block';
    document.getElementById('videoCount').value = audioSegments.length;
    
    // Update activity timestamp
    chrome.storage.local.set({ segmentationStartTime: Date.now() });
    
    // Switch to upload tab
    uploadTab.click();
    
  } catch (error) {
    console.error('Error loading ZIP:', error);
    showWarning('Failed to load ZIP into upload tab: ' + error.message);
  }
});

// Resume segmentation after popup was closed
async function resumeSegmentation(predictionId, apiKey, maxDuration, audioDataUrl) {
  console.log('Resuming segmentation with prediction ID:', predictionId);
  
  // Poll for prediction status
  updateSegmentationProgress(50, 'Checking transcription status...', 'Reconnecting to Replicate...');
  
  let prediction;
  try {
    const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { 'Authorization': `Token ${apiKey}` }
    });
    prediction = await statusResponse.json();
    console.log('Resumed prediction status:', prediction.status);
  } catch (error) {
    console.error('Failed to fetch prediction status:', error);
    throw new Error('Could not reconnect to Replicate API');
  }
  
  // If still processing, continue polling
  if (prediction.status === 'starting' || prediction.status === 'processing') {
    await continuePollingAndProcess(predictionId, apiKey, maxDuration);
  } else if (prediction.status === 'succeeded') {
    // Already completed - process the result
    await processTranscriptionResult(prediction.output, maxDuration);
  } else if (prediction.status === 'failed') {
    throw new Error('Transcription failed: ' + (prediction.error || 'Unknown error'));
  }
}

// Continue polling for transcription completion
async function continuePollingAndProcess(predictionId, apiKey, maxDuration) {
  updateSegmentationProgress(55, 'Transcribing audio...', 'Please wait...');
  
  let pollCount = 0;
  let prediction;
  
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    pollCount++;
    
    const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { 'Authorization': `Token ${apiKey}` }
    });
    
    prediction = await statusResponse.json();
    console.log(`Poll ${pollCount}: Status = ${prediction.status}`);
    
    // Update storage timestamp to prevent auto-cleanup during active polling
    chrome.storage.local.set({ segmentationStartTime: Date.now() });
    
    if (prediction.status === 'succeeded') {
      console.log('Transcription complete!');
      
      // Save transcript data before processing so we can resume if interrupted
      chrome.storage.local.set({ 
        transcriptData: prediction.output,
        segmentationStartTime: Date.now()
      });
      
      await processTranscriptionResult(prediction.output, maxDuration);
      break;
    } else if (prediction.status === 'failed') {
      throw new Error('Transcription failed: ' + (prediction.error || 'Unknown error'));
    }
    
    // Still processing - update progress
    if (prediction.status === 'processing') {
      const progress = Math.min(55 + pollCount, 85);
      updateSegmentationProgress(progress, 'Transcribing audio...', `Still processing...`);
    }
  }
}

// Process transcription result and create segments (using offscreen document)
async function processTranscriptionResult(transcriptData, maxDuration) {
  console.log('Processing transcription result using offscreen document...');
  
  // Update timestamp to prevent auto-cleanup during processing
  chrome.storage.local.set({ segmentationStartTime: Date.now() });
  
  // Step 4: Parse transcript in offscreen document
  updateSegmentationProgress(58, 'Parsing transcript...', 'Analyzing word timestamps');
  
  const parseResponse = await chrome.runtime.sendMessage({
    action: 'parseTranscriptOffscreen',
    transcriptData: transcriptData,
    maxDuration: maxDuration
  });
  
  if (!parseResponse.success) {
    throw new Error('Failed to parse transcript: ' + parseResponse.error);
  }
  
  const segments = parseResponse.segments;
  console.log(`Parsed ${segments.length} segments`);
  
  if (segments.length === 0) {
    throw new Error('No segments generated from transcript');
  }
  
  if (segments.length === 1 && segments[0].end - segments[0].start > maxDuration * 1.5) {
    console.warn(`⚠️ Only 1 segment created with duration ${(segments[0].end - segments[0].start).toFixed(2)}s (max: ${maxDuration}s)`);
  }
  
  // Get audio data URL from storage
  const storageData = await new Promise(resolve => {
    chrome.storage.local.get(['audioDataUrl'], result => resolve(result));
  });
  
  if (!storageData.audioDataUrl) {
    throw new Error('Audio data not found in storage');
  }
  
  // Step 5-6: Process audio in offscreen document (splitting + ZIP creation)
  updateSegmentationProgress(60, 'Processing audio...', 'Starting background processing');
  
  console.log('Sending audio to offscreen document for processing...');
  
  let processResponse;
  try {
    processResponse = await chrome.runtime.sendMessage({
      action: 'processAudioOffscreen',
      data: {
        audioDataUrl: storageData.audioDataUrl,
        segments: segments
      }
    });
    
    if (!processResponse || !processResponse.success) {
      console.error('Offscreen processing failed:', processResponse);
      throw new Error('Offscreen processing failed: ' + (processResponse?.error || 'No response'));
    }
  } catch (offscreenError) {
    console.error('Offscreen document error:', offscreenError);
    console.warn('Falling back to popup processing (keep popup open!)');
    
    // Fallback: process in popup (requires keeping popup open)
    alert('Background processing failed. Processing in popup instead - KEEP THIS WINDOW OPEN!');
    
    // Need to restore currentAudioBuffer
    if (!currentAudioBuffer) {
      const response = await fetch(storageData.audioDataUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new AudioContext();
      currentAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    }
    
    updateSegmentationProgress(70, 'Splitting audio...', `Creating ${segments.length} segments (in popup)`);
    const segmentBlobs = await splitAudioIntoSegments(currentAudioBuffer, segments);
    
    updateSegmentationProgress(90, 'Creating ZIP file...', 'Packaging segments');
    const zip = new JSZip();
    segmentBlobs.forEach((blob, index) => {
      const filename = `segment_${(index + 1).toString().padStart(3, '0')}.mp3`;
      zip.file(filename, blob);
    });
    
    generatedSegmentsZip = await zip.generateAsync({ type: 'blob' });
    const zipDataUrl = await blobToDataUrl(generatedSegmentsZip);
    
    // Save and complete
    chrome.storage.local.set({
      segmentationState: 'complete',
      generatedZip: zipDataUrl,
      segmentCount: segments.length,
      segmentationStartTime: Date.now()
    });
    
    chrome.storage.local.remove(['predictionId', 'transcriptData']);
    
    updateSegmentationProgress(100, 'Complete!', `Generated ${segments.length} segments`);
    segmentationStatus.style.display = 'none';
    segmentationResult.style.display = 'block';
    document.getElementById('totalSegments').textContent = segments.length;
    startSegmentationBtn.disabled = false;
    return;
  }
  
  console.log('Audio processing complete in offscreen document');
  
  // Convert data URL back to blob
  const zipDataUrl = processResponse.result.zipDataUrl;
  const response = await fetch(zipDataUrl);
  generatedSegmentsZip = await response.blob();
  
  console.log('ZIP file created, size:', generatedSegmentsZip.size, 'bytes');
  
  // Save completed state and ZIP to storage
  chrome.storage.local.set({
    segmentationState: 'complete',
    generatedZip: zipDataUrl,
    segmentCount: segments.length,
    segmentationStartTime: Date.now()
  });
  
  // Clear prediction ID and transcript data since we're done
  chrome.storage.local.remove(['predictionId', 'transcriptData']);
  
  // Done!
  updateSegmentationProgress(100, 'Complete!', `Generated ${segments.length} segments`);
  segmentationStatus.style.display = 'none';
  segmentationResult.style.display = 'block';
  document.getElementById('totalSegments').textContent = segments.length;
  startSegmentationBtn.disabled = false;
}

// Helper functions for segmenter
function updateSegmentationProgress(percent, status, detail) {
  document.getElementById('segmentationProgressFill').style.width = percent + '%';
  document.getElementById('segmentationCurrentStep').textContent = status;
  document.getElementById('segmentationDetail').textContent = detail;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function parseTranscript(transcriptData, maxDuration) {
  console.log('=== PARSING TRANSCRIPT ===');
  console.log('Max duration:', maxDuration, 'seconds');
  console.log('Transcript data type:', typeof transcriptData);
  console.log('Transcript data structure:', transcriptData ? Object.keys(transcriptData) : 'null');
  console.log('Full transcript data:', JSON.stringify(transcriptData, null, 2));
  
  // Build flat list of all words with timestamps (matching Flask app logic)
  const wordTimings = [];
  let totalDuration = 0;
  
  // Handle different output formats from Replicate (matching Flask app logic)
  if (transcriptData && typeof transcriptData === 'object') {
    if (transcriptData.segments && Array.isArray(transcriptData.segments) && transcriptData.segments.length > 0) {
      console.log(`Found ${transcriptData.segments.length} transcript segments from Replicate`);
      console.log('First segment sample:', JSON.stringify(transcriptData.segments[0], null, 2));
      
      // Use segment-level data (which includes punctuation)
      for (const segment of transcriptData.segments) {
        const segText = segment.text || '';
        const segStart = segment.start || 0;
        const segEnd = segment.end || segStart;
        
        if (segText.trim() && segEnd > 0) {
          wordTimings.push({
            start: segStart,
            end: segEnd,
            text: segText.trim()
          });
          
          totalDuration = Math.max(totalDuration, segEnd);
        }
      }
    } else if (transcriptData.chunks && Array.isArray(transcriptData.chunks)) {
      // Alternative format with chunks
      console.log(`Found ${transcriptData.chunks.length} chunks from Replicate`);
      for (const chunk of transcriptData.chunks) {
        const timestamp = chunk.timestamp || [0, 0];
        wordTimings.push({
          start: timestamp[0],
          end: timestamp[1],
          text: (chunk.text || '').trim()
        });
        totalDuration = Math.max(totalDuration, timestamp[1]);
      }
    } else if (transcriptData.text && typeof transcriptData.text === 'string') {
      // Plain text output - no timing info available
      console.error('Received plain text output without timestamps:', transcriptData.text.substring(0, 100));
      throw new Error('Transcript has no timing information. The model may have returned plain text instead of timestamped segments.');
    } else {
      console.error('Unknown transcript format. Keys:', Object.keys(transcriptData));
      console.error('Full data:', JSON.stringify(transcriptData, null, 2));
    }
  }
  
  console.log('Extracted word timings count:', wordTimings.length);
  console.log('First 10 word timings:', JSON.stringify(wordTimings.slice(0, 10), null, 2));
  
  if (wordTimings.length === 0) {
    console.error('No word timings found!');
    if (currentAudioBuffer) {
      console.warn('Creating single segment for entire audio as fallback');
      return [{
        words: ['[No transcript available]'],
        start: 0,
        end: currentAudioBuffer.duration
      }];
    }
    return [];
  }
  
  console.log(`Total words: ${wordTimings.length}, Total duration: ${totalDuration.toFixed(2)}s`);
  
  // Find split points using Flask app algorithm
  const splitPoints = [];
  let currentStart = 0.0;
  
  while (currentStart < totalDuration) {
    const targetTime = currentStart + maxDuration;
    let accumulatedText = [];
    let bestSplit = null;
    let bestPriority = -1;
    
    // Look at all words in current window
    for (const word of wordTimings) {
      const wordEnd = word.end;
      const text = word.text;
      
      // Only consider words in the current segment window
      if (wordEnd > currentStart && wordEnd <= targetTime) {
        accumulatedText.push(text);
        
        // Count words so far (split accumulated text by spaces and filter empty)
        const wordCount = accumulatedText.join(' ').split(/\s+/).filter(w => w.trim()).length;
        let priority = 0;
        
        // Check for punctuation (ONLY if we have 3+ words)
        if (wordCount >= 3 && text.length > 0) {
          const lastChar = text.slice(-1);
          if (/[.?!]/.test(lastChar)) {
            priority = 3; // Highest - sentence endings
          } else if (/[,;]/.test(lastChar)) {
            priority = 2; // Medium - phrase breaks
          }
        }
        
        // Take highest priority break, or latest one if same priority
        if (priority > 0 && priority >= bestPriority) {
          bestSplit = wordEnd;
          bestPriority = priority;
        }
      }
    }
    
    // If we found a good split point, use it
    if (bestSplit && bestSplit > currentStart) {
      const totalWords = accumulatedText.join(' ').split(/\s+/).filter(w => w.trim()).length;
      console.log(`  Split at ${bestSplit.toFixed(2)}s (priority ${bestPriority}, ${totalWords} words)`);
      splitPoints.push(bestSplit);
      currentStart = bestSplit;
    } else {
      // No good split found, just move forward by max_duration
      currentStart += maxDuration;
      if (currentStart < totalDuration) {
        console.log(`  No punctuation found, forcing split at ${currentStart.toFixed(2)}s`);
        splitPoints.push(currentStart);
      }
    }
  }
  
  console.log(`Split points: [${splitPoints.map(p => p.toFixed(2)).join(', ')}]`);
  
  // Create segments from split points
  const segments = [];
  const allPoints = [0.0, ...splitPoints, totalDuration];
  
  for (let i = 0; i < allPoints.length - 1; i++) {
    const segStart = allPoints[i];
    const segEnd = allPoints[i + 1];
    
    // Collect words for this segment
    const segmentWords = [];
    for (const word of wordTimings) {
      if (word.end > segStart && word.start < segEnd) {
        segmentWords.push(word.text);
      }
    }
    
    if (segmentWords.length > 0) {
      segments.push({
        words: segmentWords,
        start: segStart,
        end: segEnd
      });
      console.log(`Segment ${i + 1}: ${segStart.toFixed(2)}s - ${segEnd.toFixed(2)}s (${(segEnd - segStart).toFixed(2)}s, ${segmentWords.length} words)`);
    }
  }
  
  console.log(`Total segments created: ${segments.length}`);
  return segments;
}

async function splitAudioIntoSegments(audioBuffer, segments) {
  const segmentBlobs = [];
  const sampleRate = audioBuffer.sampleRate;
  const numberOfChannels = audioBuffer.numberOfChannels;
  const audioContext = new AudioContext();
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    console.log(`Processing segment ${i + 1}/${segments.length}: ${segment.start}s - ${segment.end}s`);
    
    // Update progress
    const progress = 70 + Math.floor((i / segments.length) * 20);
    updateSegmentationProgress(progress, 'Splitting audio...', `Encoding segment ${i + 1}/${segments.length}`);
    
    const startSample = Math.floor(segment.start * sampleRate);
    const endSample = Math.floor(segment.end * sampleRate);
    const segmentLength = endSample - startSample;
    
    if (segmentLength <= 0) {
      console.warn(`Skipping segment ${i + 1}: invalid length ${segmentLength}`);
      continue;
    }
    
    // Create new buffer for this segment
    const segmentBuffer = audioContext.createBuffer(
      numberOfChannels,
      segmentLength,
      sampleRate
    );
    
    // Copy audio data
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const targetData = segmentBuffer.getChannelData(channel);
      for (let j = 0; j < segmentLength; j++) {
        targetData[j] = sourceData[startSample + j];
      }
    }
    
    // Encode to MP3
    try {
      const mp3Blob = await encodeToMp3(segmentBuffer);
      console.log(`Segment ${i + 1} encoded: ${mp3Blob.size} bytes`);
      segmentBlobs.push(mp3Blob);
    } catch (error) {
      console.error(`Failed to encode segment ${i + 1}:`, error);
      throw error;
    }
  }
  
  // Clean up
  await audioContext.close();
  
  return segmentBlobs;
}

function encodeToMp3(audioBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const channels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
      const samples = audioBuffer.length;
      
      console.log(`Encoding to MP3: ${channels} channels, ${sampleRate}Hz, ${samples} samples, duration: ${(samples/sampleRate).toFixed(2)}s`);
      
      // Get audio data
      const leftChannel = audioBuffer.getChannelData(0);
      const rightChannel = channels > 1 ? audioBuffer.getChannelData(1) : leftChannel;
      
      // Convert to 16-bit PCM
      const left = new Int16Array(samples);
      const right = new Int16Array(samples);
      
      for (let i = 0; i < samples; i++) {
        left[i] = Math.max(-32768, Math.min(32767, leftChannel[i] * 32768));
        right[i] = Math.max(-32768, Math.min(32767, rightChannel[i] * 32768));
      }
      
      // Encode with lamejs
      const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
      const mp3Data = [];
      
      const sampleBlockSize = 1152;
      let encodedChunks = 0;
      for (let i = 0; i < samples; i += sampleBlockSize) {
        const leftChunk = left.subarray(i, i + sampleBlockSize);
        const rightChunk = right.subarray(i, i + sampleBlockSize);
        const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
        if (mp3buf.length > 0) {
          mp3Data.push(mp3buf);
          encodedChunks++;
        }
      }
      
      const mp3buf = mp3encoder.flush();
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
      
      console.log(`Encoded ${encodedChunks} chunks, created ${mp3Data.length} MP3 buffers`);
      
      const blob = new Blob(mp3Data, { type: 'audio/mp3' });
      console.log(`MP3 blob created: ${blob.size} bytes`);
      
      if (blob.size === 0) {
        reject(new Error('MP3 encoding produced empty file'));
      } else {
        resolve(blob);
      }
    } catch (error) {
      console.error('MP3 encoding error:', error);
      reject(error);
    }
  });
}

// =====================================================
// UPLOAD TAB LOGIC
// =====================================================

// Handle ZIP selection
selectZipBtn.addEventListener('click', async () => {
  try {
    // Hide any previous warnings
    warning.style.display = 'none';
    
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{
        description: 'ZIP Files',
        accept: { 'application/zip': ['.zip'] }
      }]
    });
    
    const file = await fileHandle.getFile();
    
    // Use JSZip to extract audio files (loaded from jszip.min.js)
    const zip = await JSZip.loadAsync(file);
    
    // Extract all MP3 files from anywhere in the ZIP
    audioSegments = [];
    
    console.log('ZIP contents:', Object.keys(zip.files));
    
    // Get all MP3 files from the ZIP (any folder structure)
    const files = [];
    zip.forEach((relativePath, file) => {
      console.log('Found file:', relativePath, 'isDir:', file.dir);
      // Accept any .mp3 file that's not a directory or hidden file
      if (relativePath.toLowerCase().endsWith('.mp3') && !file.dir && !relativePath.startsWith('__MACOSX')) {
        files.push({ path: relativePath, file: file });
      }
    });
    
    console.log('MP3 files found:', files.length);
    
    if (files.length === 0) {
      showWarning('No MP3 audio files found in ZIP. Please select a ZIP file containing MP3 files.');
      return;
    }
    
    // Sort by filename (segment_001.mp3, segment_002.mp3, etc.)
    files.sort((a, b) => a.path.localeCompare(b.path));
    
    // Extract file data and convert to data URLs for storage
    const segmentsForStorage = [];
    for (const item of files) {
      const data = await item.file.async('blob');
      const dataUrl = await blobToDataUrl(data);
      
      audioSegments.push({
        name: item.path.split('/').pop(), // Get just the filename without path
        data: data
      });
      
      segmentsForStorage.push({
        name: item.path.split('/').pop(),
        data: dataUrl
      });
    }
    
    console.log('Audio segments loaded:', audioSegments.length);
    
    // Save to storage for 30-minute memory
    chrome.storage.local.set({
      savedZipData: true,
      uploadSegments: segmentsForStorage,
      uploadFilesTimestamp: Date.now()
    });
    console.log('ZIP file saved to storage');
    
    // Update UI
    document.getElementById('segmentCount').textContent = audioSegments.length;
    zipStatus.style.display = 'block';
    selectZipBtn.textContent = '✓ ZIP Loaded';
    selectZipBtn.style.background = '#48bb78';
    
    // Set download count to match segment count
    document.getElementById('videoCount').value = audioSegments.length;
    
    checkReady();
  } catch (error) {
    console.error('Error loading ZIP:', error);
    showWarning('Failed to load ZIP file: ' + error.message);
  }
});

// Handle video selection
selectVideoBtn.addEventListener('click', async () => {
  try {
    // Hide any previous warnings
    warning.style.display = 'none';
    
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{
        description: 'Video Files',
        accept: {
          'video/*': ['.mp4', '.mov', '.avi', '.webm']
        }
      }]
    });
    
    const file = await fileHandle.getFile();
    presetVideo = file;
    presetVideoName = file.name;
    
    // Convert to data URL and save to storage for 30-minute memory
    const videoDataUrl = await fileToBase64(file);
    chrome.storage.local.set({
      savedVideoData: videoDataUrl,
      savedVideoName: file.name,
      uploadFilesTimestamp: Date.now()
    });
    console.log('Video file saved to storage');
    
    // Update UI
    document.getElementById('videoName').textContent = presetVideoName;
    videoStatus.style.display = 'block';
    selectVideoBtn.textContent = '✓ Video Selected';
    selectVideoBtn.style.background = '#48bb78';
    
    checkReady();
  } catch (error) {
    console.error('Error selecting video:', error);
  }
});

function checkReady() {
  if (audioSegments.length > 0 && presetVideo) {
    startUploadBtn.disabled = false;
  }
}

function showWarning(message) {
  warning.textContent = message;
  warning.style.display = 'block';
  // Error stays visible until user takes action
}

// Pause/Resume button handler
pauseUploadBtn.addEventListener('click', async () => {
  isPaused = !isPaused;
  
  // Save pause state to storage so content script can read it
  chrome.storage.local.set({ isPaused: isPaused });
  
  // Also update the upload state
  const result = await chrome.storage.local.get(['uploadState']);
  if (result.uploadState) {
    result.uploadState.isPaused = isPaused;
    chrome.storage.local.set({ uploadState: result.uploadState });
  }
  
  if (isPaused) {
    pauseUploadBtn.textContent = '▶️ Resume';
    pauseUploadBtn.style.background = '#48bb78';
    document.getElementById('currentFile').textContent = '⏸️ Paused - Click Resume to continue';
  } else {
    pauseUploadBtn.textContent = '⏸️ Pause';
    pauseUploadBtn.style.background = '#ed8936';
    document.getElementById('currentFile').textContent = 'Resuming...';
  }
});

// Start batch upload
startUploadBtn.addEventListener('click', async () => {
  try {
    // Hide any previous warnings
    warning.style.display = 'none';
    
    // Check if we're on the Kling page
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('app.klingai.com/global/ai-human/video/new')) {
      showWarning('Please open the Kling lip-sync page first!');
      return;
    }
    
    // Show upload status
    uploadStatus.style.display = 'block';
    document.getElementById('totalCount').textContent = audioSegments.length;
    startUploadBtn.disabled = true;
    pauseUploadBtn.style.display = 'block';
    isUploading = true;
    isPaused = false;
    
    // Initialize pause state in storage
    chrome.storage.local.set({ isPaused: false });
    
    // Convert video to base64 for passing to content script
    const videoData = await fileToBase64(presetVideo);
    
    // Send message to content script to start upload
    chrome.tabs.sendMessage(tab.id, {
      action: 'startBatchUpload',
      segments: await Promise.all(audioSegments.map(async (seg) => ({
        name: seg.name,
        data: await blobToBase64(seg.data)
      }))),
      video: {
        name: presetVideoName,
        data: videoData
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        showWarning('Failed to communicate with page. Please refresh the Kling page.');
        startUploadBtn.disabled = false;
        return;
      }
    });
    
    // Progress updates are handled by the global listener below
    
  } catch (error) {
    console.error('Error starting upload:', error);
    showWarning('Failed to start upload: ' + error.message);
    startUploadBtn.disabled = false;
  }
});

// Global message listener for upload progress (works even when popup is reopened)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'uploadProgress') {
    // Show upload status if hidden
    uploadStatus.style.display = 'block';
    pauseUploadBtn.style.display = 'block';
    
    document.getElementById('uploadCount').textContent = message.current;
    document.getElementById('totalCount').textContent = message.total;
    
    // Build status text with countdown
    let statusText = message.step;
    if (message.countdown > 0) {
      statusText += ` (${message.countdown}s)`;
    }
    
    if (!isPaused) {
      document.getElementById('currentFile').textContent = 
        `Segment ${message.current}/${message.total}: ${message.filename}\n${statusText}`;
    }
    
    const progress = (message.current / message.total) * 100;
    document.getElementById('progressFill').style.width = progress + '%';
  }
  
  if (message.action === 'uploadComplete') {
    document.getElementById('currentFile').textContent = '✓ All uploads complete!';
    startUploadBtn.disabled = false;
    pauseUploadBtn.style.display = 'none';
    isUploading = false;
    isPaused = false;
  }
  
  if (message.action === 'uploadError') {
    showWarning(`Error uploading segment ${message.segment}: ${message.error}`);
  }
  
  return true;
});

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Alias for consistency with offscreen.js
async function blobToDataUrl(blob) {
  return blobToBase64(blob);
}

// =====================================================
// DOWNLOAD TAB - REFERENCE LENGTH FEATURE
// =====================================================

// Handle Reference ZIP selection for trimming videos
selectReferenceZipBtn.addEventListener('click', async () => {
  try {
    warning.style.display = 'none';
    
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{
        description: 'ZIP Files',
        accept: { 'application/zip': ['.zip'] }
      }]
    });
    
    const file = await fileHandle.getFile();
    
    // Use JSZip to extract audio files
    const zip = await JSZip.loadAsync(file);
    
    // Extract all MP3 files
    const audioFiles = [];
    
    console.log('Reference ZIP contents:', Object.keys(zip.files));
    
    zip.forEach((relativePath, zipEntry) => {
      // Accept any .mp3 file that's not a directory or hidden file
      if (relativePath.toLowerCase().endsWith('.mp3') && !zipEntry.dir && !relativePath.startsWith('__MACOSX')) {
        audioFiles.push({ path: relativePath, file: zipEntry });
      }
    });
    
    console.log('Reference audio files found:', audioFiles.length);
    
    if (audioFiles.length === 0) {
      showWarning('No MP3 audio files found in reference ZIP.');
      return;
    }
    
    // Sort by filename (segment_001.mp3, segment_002.mp3, etc.)
    audioFiles.sort((a, b) => a.path.localeCompare(b.path));
    
    // Extract audio durations
    referenceAudioDurations = [];
    
    for (const item of audioFiles) {
      const blob = await item.file.async('blob');
      const duration = await getAudioDuration(blob);
      
      referenceAudioDurations.push({
        name: item.path.split('/').pop(), // Get just the filename
        duration: duration
      });
      
      console.log(`Reference audio: ${item.path.split('/').pop()} = ${duration.toFixed(2)}s`);
    }
    
    // Update UI
    referenceSegmentCount.textContent = referenceAudioDurations.length;
    referenceZipStatus.style.display = 'block';
    selectReferenceZipBtn.textContent = '✓ Reference ZIP Loaded';
    selectReferenceZipBtn.style.background = '#48bb78';
    
    console.log('Reference audio durations loaded:', referenceAudioDurations.length);
    
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Error loading reference ZIP:', error);
      showWarning('Failed to load reference ZIP: ' + error.message);
    }
  }
});

// Helper function to get audio duration from blob
async function getAudioDuration(blob) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(blob);
    
    audio.addEventListener('loadedmetadata', () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    });
    
    audio.addEventListener('error', (error) => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load audio metadata'));
    });
    
    audio.src = url;
  });
}

// Scan for videos on the page (now gets from background script)
scanVideosBtn.addEventListener('click', async () => {
  try {
    // Hide any previous warnings
    warning.style.display = 'none';
    
    scanVideosBtn.textContent = '🔍 Loading...';
    scanVideosBtn.disabled = true;
    
    // Get detected videos from background script
    chrome.runtime.sendMessage({ action: 'getDetectedVideos' }, (response) => {
      scanVideosBtn.textContent = '🔍 Show Detected Videos';
      scanVideosBtn.disabled = false;
      
      if (chrome.runtime.lastError) {
        showWarning('Failed to get video list. Please try again.');
        return;
      }
      
      if (response && response.videos && response.videos.length > 0) {
        // Convert background video format to our format
        detectedVideos = response.videos.map(v => ({
          src: v.url,
          downloadUrl: v.url,
          hasDownloadLink: false,
          duration: 0
        }));
        
        displayVideoList(detectedVideos);
        
        // Enable download button
        startDownloadBtn.disabled = false;
        
        // Auto-set count if not already set from ZIP
        const currentCount = parseInt(document.getElementById('videoCount').value);
        if (currentCount === 0) {
          document.getElementById('videoCount').value = detectedVideos.length;
        }
      } else {
        showWarning('No videos detected yet. Please navigate to your Kling results page and wait for videos to load.');
      }
    });
    
  } catch (error) {
    console.error('Error scanning videos:', error);
    showWarning('Failed to load videos: ' + error.message);
    scanVideosBtn.textContent = '🔍 Show Detected Videos';
    scanVideosBtn.disabled = false;
  }
});

function displayVideoList(videos) {
  videoList.innerHTML = '';
  
  if (videos.length === 0) {
    videoList.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">No videos found</div>';
    videoListContainer.style.display = 'none';
    return;
  }
  
  document.getElementById('foundVideoCount').textContent = videos.length;
  videoListContainer.style.display = 'block';
  
  videos.forEach((video, index) => {
    const videoItem = document.createElement('div');
    videoItem.className = 'video-item';
    
    const reverseIndex = videos.length - index;
    
    videoItem.innerHTML = `
      <div class="video-number">Video #${index + 1} → will be saved as: segment_${reverseIndex.toString().padStart(3, '0')}.mp4</div>
      <div class="video-url">${video.src}</div>
      ${video.hasDownloadLink ? '<div class="video-info">✓ Has download link</div>' : '<div class="video-info">Direct video source</div>'}
    `;
    
    videoList.appendChild(videoItem);
  });
}

// Download generated videos
startDownloadBtn.addEventListener('click', async () => {
  try {
    // Hide any previous warnings
    warning.style.display = 'none';
    
    // Check if videos have been scanned
    if (detectedVideos.length === 0) {
      showWarning('Please scan for videos first using the "🔍 Scan Page for Videos" button.');
      return;
    }
    
    const videoCount = parseInt(document.getElementById('videoCount').value);
    
    if (isNaN(videoCount) || videoCount < 1) {
      showWarning('Please enter a valid number of videos to download.');
      return;
    }
    
    // Validate reference length if provided
    const hasReferenceLength = referenceAudioDurations.length > 0;
    if (hasReferenceLength) {
      if (referenceAudioDurations.length !== videoCount) {
        showWarning(`Reference ZIP has ${referenceAudioDurations.length} audio files but you're downloading ${videoCount} videos. Counts must match!`);
        return;
      }
      console.log('Reference length validation passed:', referenceAudioDurations.length, 'segments');
    }
    
    // Show download status
    downloadStatus.style.display = 'block';
    document.getElementById('downloadTotal').textContent = videoCount;
    document.getElementById('downloadCount').textContent = 0;
    startDownloadBtn.disabled = true;
    
    const videosToDownload = detectedVideos.slice(0, videoCount);
    const downloadAsZip = document.getElementById('downloadAsZip').checked;
    const combineVideos = document.getElementById('combineVideos').checked;
    
    if (combineVideos) {
      // Combine videos into one using Flask backend
      document.getElementById('downloadCurrentFile').textContent = 'Fetching videos for combining...';
      
      const videoBlobs = [];
      
      for (let i = 0; i < videosToDownload.length; i++) {
        const video = videosToDownload[i];
        
        // Reverse numbering: first video (newest) gets highest number
        const reverseIndex = videoCount - i;
        const filename = `segment_${reverseIndex.toString().padStart(3, '0')}.mp4`;
        
        // Update progress
        document.getElementById('downloadCount').textContent = i + 1;
        document.getElementById('downloadCurrentFile').textContent = `Fetching video ${i + 1}/${videosToDownload.length}: ${filename}`;
        const progress = ((i + 1) / videosToDownload.length) * 50; // First 50% for fetching
        document.getElementById('downloadProgressFill').style.width = progress + '%';
        
        try {
          // Fetch video as blob
          const response = await fetch(video.downloadUrl);
          if (!response.ok) throw new Error(`Failed to fetch ${filename}`);
          
          const blob = await response.blob();
          videoBlobs.push({ blob, filename });
          
        } catch (error) {
          console.error(`Error fetching ${filename}:`, error);
          showWarning(`Failed to fetch ${filename}. Continuing with others...`);
        }
      }
      
      // Send to backend for combining (with optional trimming)
      const endpoint = hasReferenceLength ? 'trim-and-combine-videos' : 'combine-videos';
      document.getElementById('downloadCurrentFile').textContent = hasReferenceLength 
        ? 'Trimming and combining videos with ffmpeg...' 
        : 'Combining videos with ffmpeg...';
      document.getElementById('downloadProgressFill').style.width = '60%';
      
      try {
        const formData = new FormData();
        
        // Add all video blobs to form data in correct order
        for (let i = 0; i < videoBlobs.length; i++) {
          formData.append('videos', videoBlobs[i].blob, videoBlobs[i].filename);
        }
        
        // If reference length is provided, add durations mapping
        if (hasReferenceLength) {
          // Create mapping: filename -> duration
          const durationsMap = {};
          for (let i = 0; i < referenceAudioDurations.length; i++) {
            const segmentNum = i + 1; // segment_001, segment_002, etc.
            const filename = `segment_${segmentNum.toString().padStart(3, '0')}.mp4`;
            durationsMap[filename] = referenceAudioDurations[i].duration;
          }
          formData.append('durations', JSON.stringify(durationsMap));
          console.log('Sending durations map:', durationsMap);
        }
        
        // Send to Flask backend
        const response = await fetch(`http://localhost:5001/${endpoint}`, {
          method: 'POST',
          body: formData
        });
        
        if (!response.ok) {
          throw new Error(`Failed to ${hasReferenceLength ? 'trim and combine' : 'combine'} videos on server`);
        }
        
        document.getElementById('downloadProgressFill').style.width = '90%';
        document.getElementById('downloadCurrentFile').textContent = 'Downloading combined video...';
        
        const combinedBlob = await response.blob();
        
        // Download the combined video
        const url = URL.createObjectURL(combinedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `combined_video_${new Date().toISOString().slice(0, 10)}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        document.getElementById('downloadProgressFill').style.width = '100%';
        document.getElementById('downloadCurrentFile').textContent = '✓ Combined video downloaded!';
        
      } catch (error) {
        console.error('Error combining videos:', error);
        showWarning('Failed to combine videos. Make sure the local server is running at http://localhost:5001 (python app.py)');
      }
      
    } else if (downloadAsZip) {
      // Download as single ZIP file
      document.getElementById('downloadCurrentFile').textContent = hasReferenceLength 
        ? 'Fetching videos for trimming...' 
        : 'Creating ZIP file...';
      
      const videoBlobs = [];
      
      for (let i = 0; i < videosToDownload.length; i++) {
        const video = videosToDownload[i];
        
        // Reverse numbering: first video (newest) gets highest number
        const reverseIndex = videoCount - i;
        const filename = `segment_${reverseIndex.toString().padStart(3, '0')}.mp4`;
        
        // Update progress
        document.getElementById('downloadCount').textContent = i + 1;
        document.getElementById('downloadCurrentFile').textContent = `Fetching video ${i + 1}/${videosToDownload.length}: ${filename}`;
        const progress = ((i + 1) / videosToDownload.length) * (hasReferenceLength ? 50 : 100);
        document.getElementById('downloadProgressFill').style.width = progress + '%';
        
        try {
          // Fetch video as blob
          const response = await fetch(video.downloadUrl);
          if (!response.ok) throw new Error(`Failed to fetch ${filename}`);
          
          const blob = await response.blob();
          videoBlobs.push({ blob, filename });
          
        } catch (error) {
          console.error(`Error fetching ${filename}:`, error);
          showWarning(`Failed to fetch ${filename}. Continuing with others...`);
        }
      }
      
      // If reference length is provided, trim videos via backend first
      if (hasReferenceLength) {
        document.getElementById('downloadCurrentFile').textContent = 'Trimming videos with ffmpeg...';
        document.getElementById('downloadProgressFill').style.width = '60%';
        
        try {
          const formData = new FormData();
          
          // Add all video blobs
          for (let i = 0; i < videoBlobs.length; i++) {
            formData.append('videos', videoBlobs[i].blob, videoBlobs[i].filename);
          }
          
          // Add durations mapping
          const durationsMap = {};
          for (let i = 0; i < referenceAudioDurations.length; i++) {
            const segmentNum = i + 1;
            const filename = `segment_${segmentNum.toString().padStart(3, '0')}.mp4`;
            durationsMap[filename] = referenceAudioDurations[i].duration;
          }
          formData.append('durations', JSON.stringify(durationsMap));
          
          // Send to Flask backend for trimming
          const response = await fetch('http://localhost:5001/trim-videos-zip', {
            method: 'POST',
            body: formData
          });
          
          if (!response.ok) {
            throw new Error('Failed to trim videos on server');
          }
          
          document.getElementById('downloadProgressFill').style.width = '90%';
          document.getElementById('downloadCurrentFile').textContent = 'Downloading trimmed ZIP...';
          
          const trimmedZipBlob = await response.blob();
          
          // Download the trimmed ZIP
          const zipUrl = URL.createObjectURL(trimmedZipBlob);
          const a = document.createElement('a');
          a.href = zipUrl;
          a.download = `kling_videos_trimmed_${new Date().toISOString().slice(0, 10)}.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(zipUrl);
          
          document.getElementById('downloadProgressFill').style.width = '100%';
          document.getElementById('downloadCurrentFile').textContent = '✓ Trimmed ZIP download complete!';
          
        } catch (error) {
          console.error('Error trimming videos:', error);
          showWarning('Failed to trim videos. Make sure the local server is running at http://localhost:5001 (python app.py)');
        }
      } else {
        // No trimming needed, create ZIP directly
        const zip = new JSZip();
        
        for (const item of videoBlobs) {
          zip.file(item.filename, item.blob);
        }
        
        // Generate ZIP
        document.getElementById('downloadCurrentFile').textContent = 'Generating ZIP file...';
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        
        // Download ZIP
        const zipUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = zipUrl;
        a.download = `kling_videos_${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(zipUrl);
        
        document.getElementById('downloadCurrentFile').textContent = '✓ ZIP download complete!';
      }
      
    } else {
      // Download as individual files (trimming not supported for individual downloads)
      if (hasReferenceLength) {
        console.warn('Reference length trimming is not supported for individual file downloads. Videos will be downloaded without trimming. Use ZIP or Combine mode for trimming.');
      }
      
      for (let i = 0; i < videosToDownload.length; i++) {
        const video = videosToDownload[i];
        
        // Reverse numbering: first video (newest) gets highest number
        const reverseIndex = videoCount - i;
        const filename = `segment_${reverseIndex.toString().padStart(3, '0')}.mp4`;
        
        // Update progress
        document.getElementById('downloadCount').textContent = i + 1;
        document.getElementById('downloadCurrentFile').textContent = 'Downloading: ' + filename;
        const progress = ((i + 1) / videosToDownload.length) * 100;
        document.getElementById('downloadProgressFill').style.width = progress + '%';
        
        try {
          // Download via background script
          await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              action: 'downloadFile',
              url: video.downloadUrl,
              filename: filename
            }, (response) => {
              if (response && response.success) {
                resolve();
              } else {
                console.error('Download failed:', filename);
                resolve(); // Continue with next file even if one fails
              }
            });
          });
          
          // Small delay between downloads
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`Error downloading ${filename}:`, error);
        }
      }
      
      document.getElementById('downloadCurrentFile').textContent = '✓ All downloads complete!';
    }
    
    startDownloadBtn.disabled = false;
    
  } catch (error) {
    console.error('Error starting download:', error);
    showWarning('Failed to start download: ' + error.message);
    startDownloadBtn.disabled = false;
  }
});

