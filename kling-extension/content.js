// This script runs on the Kling AI lip-sync page
console.log('Kling Batch Uploader: Content script loaded');

let isUploading = false;
let scannedVideos = [];

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startBatchUpload') {
    console.log('Starting batch upload:', request.segments.length, 'segments');
    batchUpload(request.segments, request.video);
    sendResponse({ success: true });
  }
  
  if (request.action === 'scanVideos') {
    console.log('Scanning for videos on page...');
    scanForVideos().then(videos => {
      scannedVideos = videos; // Store for later use
      sendResponse({ videos: videos });
    });
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'startBatchDownload') {
    console.log('Starting batch download:', request.count, 'videos');
    batchDownload(request.count);
    sendResponse({ success: true });
  }
  
  return true;
});

async function batchUpload(segments, video) {
  if (isUploading) {
    console.log('Upload already in progress');
    return;
  }
  
  isUploading = true;
  
  for (let i = 0; i < segments.length; i++) {
    // Check for pause before each upload
    const isPaused = await checkPauseState();
    if (isPaused) {
      console.log('Upload paused, waiting...');
      // Wait and check again
      while (await checkPauseState()) {
      await sleep(1000);
      }
      console.log('Upload resumed');
    }
    
    const segment = segments[i];
    
    console.log(`Uploading segment ${i + 1}/${segments.length}: ${segment.name}`);
    
    // Send progress update
    chrome.runtime.sendMessage({
      action: 'uploadProgress',
      current: i + 1,
      total: segments.length,
      filename: segment.name
    });
    
    try {
      // Convert base64 back to File objects
      const audioFile = base64ToFile(segment.data, segment.name, 'audio/mpeg');
      const videoFile = base64ToFile(video.data, video.name, 'video/mp4');
      
      // Upload with different logic for first vs subsequent segments
      await uploadToKling(audioFile, videoFile, i + 1, segments.length);
      
      // Wait between uploads to avoid rate limiting
      if (i < segments.length - 1) {
        await sleep(3000); // 3 seconds between uploads
      }
      
    } catch (error) {
      console.error(`Error uploading segment ${i + 1}:`, error);
      // Send error message
      chrome.runtime.sendMessage({
        action: 'uploadError',
        error: error.message,
        segment: i + 1
      });
      // Continue with next segment even if one fails
    }
  }
  
  isUploading = false;
  console.log('Batch upload complete!');
}

async function checkPauseState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['isPaused'], (result) => {
      resolve(result.isPaused || false);
    });
  });
}

async function uploadToKling(audioFile, videoFile, currentSegment, totalSegments) {
  
  console.log(`Segment ${currentSegment}/${totalSegments}`);
  console.log('Audio file:', audioFile.name, 'Size:', audioFile.size);
  console.log('Video file:', videoFile.name, 'Size:', videoFile.size);
  
  const isFirstSegment = currentSegment === 1;
  
  if (isFirstSegment) {
    // FIRST SEGMENT: Full workflow with video upload
    console.log('📌 FIRST SEGMENT - Full workflow');
    
    // STEP 1: Upload VIDEO
    sendProgress(currentSegment, totalSegments, audioFile.name, 'Uploading video...', 0);
    console.log('STEP 1: Uploading video...');
    
    const videoInput = await findFileInput('video');
    if (!videoInput) {
      throw new Error('Video upload input not found - please make sure you are on the Kling lip-sync page');
    }
    
    const videoDataTransfer = new DataTransfer();
    videoDataTransfer.items.add(videoFile);
    videoInput.files = videoDataTransfer.files;
    videoInput.dispatchEvent(new Event('change', { bubbles: true }));
    videoInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Wait for video to process (max 60s)
    console.log('Waiting for video to process and Upload Local Dubbing to appear...');
    await sleep(3000); // Give it 3 seconds initial buffer
    
    // STEP 2: Wait for and click "Upload Local Dubbing" option
    sendProgress(currentSegment, totalSegments, audioFile.name, 'Waiting for Upload Local Dubbing...', 0);
    console.log('STEP 2: Waiting for "Upload Local Dubbing" option to become available...');
    
    const uploadDubbingElement = await waitForButtonToBeClickable(
      ['Upload Local Dubbing', 'upload local dubbing', 'Local Dubbing', 'Dubbing'],
      60,
      (remaining) => {
        sendProgress(currentSegment, totalSegments, audioFile.name, 
          'Waiting for Upload Local Dubbing to appear...', remaining);
      }
    );
    
    if (!uploadDubbingElement) {
      throw new Error('Upload Local Dubbing option not found - video may not have processed correctly');
    }
    
    console.log('Clicking Upload Local Dubbing option...');
    uploadDubbingElement.click();
    await sleep(2000); // Wait for upload box to appear
    
    // STEP 3: Upload audio
    sendProgress(currentSegment, totalSegments, audioFile.name, 'Uploading audio...', 0);
    console.log('STEP 3: Uploading audio...');
    
    const audioInput = await findFileInput('audio');
    if (!audioInput) {
      throw new Error('Audio upload input not found - Upload Local Dubbing may not have opened correctly');
    }
    
    const audioDataTransfer = new DataTransfer();
    audioDataTransfer.items.add(audioFile);
    audioInput.files = audioDataTransfer.files;
    audioInput.dispatchEvent(new Event('change', { bubbles: true }));
    audioInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    await sleep(2000); // Wait for audio to process
    
    // STEP 4: Click "Generate" button
    sendProgress(currentSegment, totalSegments, audioFile.name, 'Waiting for Generate button...', 0);
    console.log('STEP 4: Waiting for "Generate" button to become clickable...');
    
    const generateButton = await waitForButtonToBeClickable(
      ['Generate', 'generate', 'Create', 'create', 'Submit', 'submit'],
      30,
      (remaining) => {
        sendProgress(currentSegment, totalSegments, audioFile.name, 
          'Waiting for Generate button...', remaining);
      }
    );
    
    if (!generateButton) {
      throw new Error('Generate button not found or timed out');
    }
    
    console.log('Clicking Generate button...');
    generateButton.click();
    
    // Small wait before next segment
    console.log('Waiting 3 seconds before next segment...');
    await countdownSleep(3, (remaining) => {
      sendProgress(currentSegment, totalSegments, audioFile.name, 
        'Generation started, waiting before next...', remaining);
    });
    
  } else {
    // SUBSEQUENT SEGMENTS: Faster workflow (delete audio + replace)
    console.log('🔄 SUBSEQUENT SEGMENT - Fast workflow (delete audio + replace)');
    
    // STEP 1: Click delete button on existing AUDIO ONLY (not video!)
    sendProgress(currentSegment, totalSegments, audioFile.name, 'Deleting previous audio...', 0);
    console.log('STEP 1: Looking for AUDIO delete button...');
    
    let audioInput = null; // Declare outside to avoid scope issues
    const deleteButton = await findAudioDeleteButton();
    
    if (!deleteButton) {
      console.warn('⚠️ Audio delete button not found - checking if upload box is already visible');
    } else {
      console.log('Clicking audio delete button...');
      try {
        // Try native click first
        if (typeof deleteButton.click === 'function') {
          deleteButton.click();
        } else {
          // Fallback: dispatch click event manually
          console.log('  Using manual click event dispatch');
          deleteButton.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
          }));
        }
      } catch (error) {
        console.error('  Error clicking delete button:', error);
        console.log('  Trying to find clickable parent...');
        
        // Try to find clickable parent
        let parent = deleteButton.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!parent) break;
          if (typeof parent.click === 'function') {
            console.log('  Found clickable parent, clicking it');
            parent.click();
            break;
          }
          parent = parent.parentElement;
        }
      }
      
      // Wait for confirmation dialog and click "Confirm" button
      console.log('Waiting for delete confirmation dialog...');
      await sleep(1000); // Give dialog time to fully render
      
      // Try to find the confirmation button with multiple strategies
      let confirmButton = null;
      const maxConfirmWait = 10;
      
      for (let attempt = 1; attempt <= maxConfirmWait; attempt++) {
        const remaining = maxConfirmWait - attempt;
        sendProgress(currentSegment, totalSegments, audioFile.name, 
          'Looking for confirmation button...', remaining);
        
        // Strategy 1: Look for button with "success" class (common for confirm buttons)
        const successButtons = document.querySelectorAll('button.success, button[class*="success"]');
        for (const btn of successButtons) {
          if (btn.offsetParent === null) continue; // Skip hidden
          const text = btn.textContent?.toLowerCase().trim() || '';
          const innerText = btn.innerText?.toLowerCase().trim() || '';
          if (text.includes('confirm') || innerText.includes('confirm')) {
            console.log('  ✓ Found Confirm button (success class)');
            confirmButton = btn;
            break;
          }
        }
        
        if (!confirmButton) {
          // Strategy 2: Look for any visible button with "Confirm" text
          const allButtons = document.querySelectorAll('button, [role="button"]');
          for (const btn of allButtons) {
            if (btn.offsetParent === null) continue; // Skip hidden
            const text = btn.textContent?.toLowerCase().trim() || '';
            const innerText = btn.innerText?.toLowerCase().trim() || '';
            if (text === 'confirm' || innerText === 'confirm' || 
                text.includes('confirm') || innerText.includes('confirm')) {
              console.log('  ✓ Found Confirm button (text search)');
              confirmButton = btn;
              break;
            }
          }
        }
        
        if (!confirmButton) {
          // Strategy 3: Look in dialog/modal/overlay containers
          const dialogs = document.querySelectorAll('[class*="dialog"], [class*="modal"], [class*="overlay"], [role="dialog"]');
          for (const dialog of dialogs) {
            if (dialog.offsetParent === null) continue;
            const dialogButtons = dialog.querySelectorAll('button');
            for (const btn of dialogButtons) {
              if (btn.offsetParent === null) continue;
              const text = btn.textContent?.toLowerCase().trim() || '';
              const className = btn.className?.toLowerCase() || '';
              if ((text === 'confirm' || text.includes('confirm')) || 
                  className.includes('success') || className.includes('confirm')) {
                console.log('  ✓ Found Confirm button (in dialog)');
                confirmButton = btn;
                break;
              }
            }
            if (confirmButton) break;
          }
        }
        
        if (confirmButton) break;
        
        console.log(`  Attempt ${attempt}/${maxConfirmWait} - Confirm button not found yet`);
        await sleep(1000);
      }
      
      if (confirmButton) {
        console.log('Clicking Confirm button on delete dialog...');
        try {
          confirmButton.click();
          console.log('  ✓ Confirm button clicked');
        } catch (error) {
          console.log('  Using event dispatch instead');
          confirmButton.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
          }));
        }
      } else {
        console.warn('⚠️ Confirm button not found after 10 seconds - logging all visible buttons:');
        const allButtons = document.querySelectorAll('button');
        let count = 0;
        for (const btn of allButtons) {
          if (btn.offsetParent !== null && count < 20) {
            count++;
            console.log(`  ${count}. text="${btn.textContent?.trim().substring(0, 30)}" | class="${String(btn.className).substring(0, 60)}"`);
          }
        }
      }
      
      // Wait for upload box to appear with 50-second countdown
      console.log('Waiting for upload box to appear after deletion...');
      const maxWaitSeconds = 50;
      const pollIntervalMs = 500;
      const maxAttempts = (maxWaitSeconds * 1000) / pollIntervalMs;
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const remainingSeconds = Math.ceil((maxAttempts - attempt) * pollIntervalMs / 1000);
        
        if (attempt % 2 === 0) { // Update progress every second (every 2 attempts)
          sendProgress(currentSegment, totalSegments, audioFile.name, 
            'Waiting for upload box to appear...', remainingSeconds);
        }
        
        audioInput = await findFileInput('audio');
        if (audioInput) {
          console.log(`  ✓ Upload box appeared after ${(attempt * pollIntervalMs / 1000).toFixed(1)} seconds`);
          break;
        }
        
        await sleep(pollIntervalMs);
      }
      
      if (!audioInput) {
        console.error(`❌ Audio upload input not found after ${maxWaitSeconds} seconds`);
        console.log('Logging all file inputs on page:');
        const allInputs = document.querySelectorAll('input[type="file"]');
        allInputs.forEach((input, i) => {
          console.log(`  ${i + 1}. accept="${input.accept}" | visible=${input.offsetParent !== null} | class="${input.className}"`);
        });
        throw new Error(`Audio upload input not found after ${maxWaitSeconds}s - delete may have failed or UI changed`);
      }
    }
    
    // STEP 2: Upload new audio
    sendProgress(currentSegment, totalSegments, audioFile.name, 'Uploading new audio...', 0);
    console.log('STEP 2: Uploading new audio...');
    
    // If delete button wasn't found, find audio input now
    if (!audioInput) {
      audioInput = await findFileInput('audio');
      if (!audioInput) {
        throw new Error('Audio upload input not found');
      }
    }
    
    const audioDataTransfer = new DataTransfer();
    audioDataTransfer.items.add(audioFile);
    audioInput.files = audioDataTransfer.files;
    audioInput.dispatchEvent(new Event('change', { bubbles: true }));
    audioInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    await sleep(2000); // Wait for audio to process
    
    // STEP 3: Click "Replace" button
    sendProgress(currentSegment, totalSegments, audioFile.name, 'Waiting for Replace button...', 0);
    console.log('STEP 3: Waiting for "Replace" button to become clickable...');
    
    const replaceButton = await waitForButtonToBeClickable(
      ['Replace', 'replace', 'Update', 'update'],
      30,
      (remaining) => {
        sendProgress(currentSegment, totalSegments, audioFile.name, 
          'Waiting for Replace button...', remaining);
      }
    );
    
    if (!replaceButton) {
      throw new Error('Replace button not found or timed out');
    }

    
    console.log('Clicking Replace button...');
    replaceButton.click();
    await sleep(2000); // Small buffer after clicking
    
    // STEP 4: Wait for and click "Generate" button (bottom right)
    sendProgress(currentSegment, totalSegments, audioFile.name, 'Waiting for Generate button...', 0);
    console.log('STEP 4: Waiting for "Generate" button to become clickable...');
    
    const generateButton = await waitForButtonToBeClickable(
      ['Generate', 'generate', 'Create', 'create', 'Submit', 'submit'],
      30,
      (remaining) => {
        sendProgress(currentSegment, totalSegments, audioFile.name, 
          'Waiting for Generate button...', remaining);
      }
    );
    
    if (!generateButton) {
      throw new Error('Generate button not found or timed out');
    }
    
    console.log('Clicking Generate button...');
    generateButton.click();
    
    // Small wait before next segment
    console.log('Waiting 3 seconds before next segment...');
    await countdownSleep(3, (remaining) => {
      sendProgress(currentSegment, totalSegments, audioFile.name, 
        'Generation started, waiting before next...', remaining);
    });
  }
  
  console.log('=== Upload Process Complete ===');
}

function base64ToFile(base64, filename, mimeType) {
  // Remove data URL prefix if present
  const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
  
  // Convert base64 to binary
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // Create File object
  return new File([bytes], filename, { type: mimeType });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to find file input
async function findFileInput(type) {
  const selectors = type === 'video'
    ? ['input[type="file"][accept*="video"]', 'input[accept*="video"]', 'input[type="file"]']
    : ['input[type="file"][accept*="audio"]', 'input[accept*="audio"]'];
  
  for (const selector of selectors) {
    const inputs = document.querySelectorAll(selector);
    for (const input of inputs) {
      if (input.offsetParent !== null) { // Check if visible
        if (type === 'video' && input.accept.includes('video')) return input;
        if (type === 'audio' && input.accept.includes('audio')) return input;
        if (!input.accept) return input; // Generic file input
      }
    }
  }
  return null;
}

// Helper function to find clickable element by text
async function findClickableElement(textOptions, silent = false) {
  if (!silent) console.log('Looking for clickable element with text:', textOptions);
  
  // First try exact button elements
  const buttons = document.querySelectorAll('button, [role="button"], a[class*="button"], div[class*="button"]');
  for (const button of buttons) {
    if (button.offsetParent === null) continue; // Skip hidden elements
    
    const text = button.textContent?.trim() || '';
    const lowerText = text.toLowerCase();
    
    for (const option of textOptions) {
      if (lowerText === option.toLowerCase() || lowerText.includes(option.toLowerCase())) {
        if (!silent) console.log(`  ✓ Found: "${text}"`);
        return button;
      }
    }
  }
  
  // Try all clickable elements
  const allElements = document.querySelectorAll('*');
  for (const element of allElements) {
    if (element.offsetParent === null) continue;
    
    const style = window.getComputedStyle(element);
    if (style.cursor !== 'pointer' && !element.onclick) continue;
    
    const text = element.textContent?.trim() || '';
    const lowerText = text.toLowerCase();
    
    for (const option of textOptions) {
      if (lowerText === option.toLowerCase()) {
        if (!silent) console.log(`  ✓ Found (pointer): "${text}"`);
        return element;
      }
    }
  }

  return null;
}

// Helper function to wait for button to be clickable with countdown callback
async function waitForButtonToBeClickable(textOptions, maxSeconds, progressCallback) {
  for (let i = 0; i < maxSeconds; i++) {
    const button = await findClickableElement(textOptions, true);
    if (button) {
      return button;
    }
    
    if (progressCallback) {
      progressCallback(maxSeconds - i - 1);
    }
    
    await sleep(1000);
  }
  return null;
}

// Helper function to find delete button in audio control area (right side)
async function findAudioDeleteButton() {
  console.log('Looking for delete button in audio control area...');
  
  // Strategy 1: Look for trash icon (🗑️) or delete icons
  console.log('Strategy 1: Looking for trash/delete icons...');
  const allElements = document.querySelectorAll('*');
  for (const element of allElements) {
    if (element.offsetParent === null) continue; // Skip hidden
    
    const text = element.textContent?.trim() || '';
    const innerHTML = element.innerHTML?.toLowerCase() || '';
    
    // Check for trash emoji or icon
    if (text === '🗑️' || text === '🗑' || 
        innerHTML.includes('trash') || 
        innerHTML.includes('delete') ||
        innerHTML.includes('remove')) {
      
      // Check if element itself looks clickable (don't require .click method)
      const style = window.getComputedStyle(element);
      if (style.cursor === 'pointer' || element.tagName === 'BUTTON' || element.onclick || 
          element.getAttribute('role') === 'button' || element.tagName === 'SVG') {
        console.log('  ✓ Found delete icon (clickable):', {
          text: text.substring(0, 20),
          tag: element.tagName,
          className: String(element.className).substring(0, 50)
        });
        return element;
      }
      
      // Check parent elements (icon might be inside button)
      let parent = element.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!parent) break;
        
        // Look for clickable parent (don't require .click method)
        const parentStyle = window.getComputedStyle(parent);
        if (parentStyle.cursor === 'pointer' || parent.tagName === 'BUTTON' || parent.onclick ||
            parent.getAttribute('role') === 'button') {
          console.log('  ✓ Found delete button (parent of icon):', {
            tag: parent.tagName,
            className: String(parent.className).substring(0, 50)
          });
          return parent;
        }
        parent = parent.parentElement;
      }
    }
  }
  
  // Strategy 2: Look in control/audio/player containers
  console.log('Strategy 2: Looking in control containers...');
  const controlContainers = document.querySelectorAll('[class*="control"], [class*="audio"], [class*="player"], [class*="upload"]');
  
  for (const container of controlContainers) {
    if (container.offsetParent === null) continue;
    
    const buttons = container.querySelectorAll('button, div[class*="button"], span[class*="button"], [role="button"], div[class*="delete"], div[class*="remove"], svg, i[class*="icon"]');
    
    for (const button of buttons) {
      const text = button.textContent?.toLowerCase().trim() || '';
      const className = button.className?.toLowerCase() || '';
      const title = button.getAttribute('title')?.toLowerCase() || '';
      const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
      const innerHTML = button.innerHTML?.toLowerCase() || '';
      
      // Check if it's a delete/remove button
      if (text.includes('delete') || text.includes('remove') || text === '×' || text === 'x' || text === '🗑️' ||
          className.includes('delete') || className.includes('remove') || className.includes('trash') ||
          title.includes('delete') || title.includes('remove') || title.includes('trash') ||
          ariaLabel.includes('delete') || ariaLabel.includes('remove') || ariaLabel.includes('trash') ||
          innerHTML.includes('trash') || innerHTML.includes('delete-icon')) {
        
        // Check if it looks clickable (button, role=button, or has cursor pointer)
        const buttonStyle = window.getComputedStyle(button);
        if (button.tagName === 'BUTTON' || button.getAttribute('role') === 'button' || 
            buttonStyle.cursor === 'pointer' || button.onclick) {
          console.log('  ✓ Found delete button in container:', {
            text: text.substring(0, 20),
            className: String(button.className).substring(0, 50),
            tag: button.tagName,
            title: title
          });
          return button;
        } else {
          // Try to find clickable parent
          let parent = button.parentElement;
          for (let i = 0; i < 3; i++) {
            if (!parent) break;
            const parentStyle = window.getComputedStyle(parent);
            if (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button' || 
                parentStyle.cursor === 'pointer' || parent.onclick) {
              console.log('  ✓ Found clickable parent of delete button:', {
                tag: parent.tagName,
                className: String(parent.className).substring(0, 50)
              });
              return parent;
            }
            parent = parent.parentElement;
          }
        }
      }
    }
  }
  
  // Strategy 3: Look for any visible buttons near audio-related elements
  console.log('Strategy 3: Looking for buttons near audio elements...');
  const audioRelated = document.querySelectorAll('[class*="audio"], [class*="sound"], [class*="dubbing"], input[type="file"][accept*="audio"]');
  
  for (const audioEl of audioRelated) {
    if (audioEl.offsetParent === null) continue;
    
    // Look for buttons near this element (siblings, parent's children)
    const nearbyButtons = [];
    
    // Check siblings
    if (audioEl.parentElement) {
      const siblings = audioEl.parentElement.querySelectorAll('button, [role="button"], svg, i');
      nearbyButtons.push(...siblings);
    }
    
    for (const btn of nearbyButtons) {
      if (btn.offsetParent === null) continue;
      
      const btnClass = btn.className?.toLowerCase() || '';
      const btnInner = btn.innerHTML?.toLowerCase() || '';
      
      if (btnClass.includes('delete') || btnClass.includes('remove') || btnClass.includes('trash') ||
          btnInner.includes('trash') || btnInner.includes('delete')) {
        
        // Check if it looks clickable (button, role=button, or has cursor pointer)
        const btnStyle = window.getComputedStyle(btn);
        if (btn.tagName === 'BUTTON' || btn.getAttribute('role') === 'button' || 
            btnStyle.cursor === 'pointer' || btn.onclick) {
          console.log('  ✓ Found delete button near audio element:', {
            tag: btn.tagName,
            className: String(btn.className).substring(0, 50)
          });
          return btn;
        } else {
          // Try to find clickable parent
          let parent = btn.parentElement;
          for (let i = 0; i < 3; i++) {
            if (!parent) break;
            const parentStyle = window.getComputedStyle(parent);
            if (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button' || 
                parentStyle.cursor === 'pointer' || parent.onclick) {
              console.log('  ✓ Found clickable parent near audio element:', {
                tag: parent.tagName,
                className: String(parent.className).substring(0, 50)
              });
              return parent;
            }
            parent = parent.parentElement;
          }
        }
      }
    }
  }
  
  // Log all visible clickable elements for debugging
  console.log('  ❌ Delete button not found. Logging clickable elements:');
  const clickable = document.querySelectorAll('button, [role="button"], [class*="button"]');
  let count = 0;
  for (const el of clickable) {
    if (el.offsetParent !== null && count < 30) {
      count++;
      console.log(`    ${count}. ${el.tagName}: "${el.textContent?.trim().substring(0, 30)}" | class="${String(el.className).substring(0, 40)}"`);
    }
  }
  
  return null;
}

// Helper function to send progress with countdown
function sendProgress(current, total, filename, status, remaining) {
  chrome.runtime.sendMessage({
    action: 'uploadProgress',
    current: current,
    total: total,
    filename: filename,
    status: status,
    remaining: remaining
  });
}

// Helper function to sleep with countdown callback
async function countdownSleep(seconds, callback) {
  for (let i = seconds; i > 0; i--) {
    if (callback) callback(i);
    await sleep(1000);
  }
}

function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }
    
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

async function scanForVideos() {
  console.log('Starting video scan...');
  
  // Find all video elements on the page
  const allVideos = Array.from(document.querySelectorAll('video'));
  
  console.log(`Found ${allVideos.length} total video elements`);
  
  const videoList = [];
  
  for (let index = 0; index < allVideos.length; index++) {
    const video = allVideos[index];
    
    // Get the video source URL
    const videoSrc = video.src || video.querySelector('source')?.src;
    
    if (!videoSrc) {
      console.log('Skipping video without source');
      continue;
    }
    
    // ONLY include Kling CDN videos (generated results)
    // Pattern: https://v15-kling.klingai.com/bs2/upload-ylab-stunt-sgp/ai_portal/.../filename.mp4?x-kcdn-pid=...
    const isKlingCDN = (
      videoSrc.includes('kling.klingai.com') && 
      videoSrc.includes('/bs2/') && 
      (videoSrc.endsWith('.mp4') || videoSrc.includes('.mp4?'))
    );
    
    if (!isKlingCDN) {
      console.log('Skipping non-Kling CDN video:', videoSrc);
      continue;
    }
    
    // Skip very short videos (thumbnails/previews are usually < 3 seconds)
    if (video.duration && video.duration < 3) {
      console.log('Skipping short video (likely thumbnail):', videoSrc, 'duration:', video.duration);
      continue;
    }
    
    // Skip blob URLs (browser-generated previews)
    if (videoSrc.startsWith('blob:')) {
      console.log('Skipping blob URL:', videoSrc);
      continue;
    }
    
    // Get Y position on page for sorting (top = newest)
    const rect = video.getBoundingClientRect();
    const yPosition = rect.top + window.scrollY;
    
    console.log('✓ Found Kling generated video:', videoSrc);
    console.log('  Duration:', video.duration || 'unknown', 'seconds');
    console.log('  DOM position:', index, '| Y position:', yPosition.toFixed(0), 'px');
    
    // Look for the parent container
    const container = video.closest('[class*="video"], [class*="card"], [class*="item"], [class*="result"]');
    
    // Try to find download link/button in the container
    let downloadLink = null;
    let hasDownloadLink = false;
    
    if (container) {
      downloadLink = container.querySelector('a[download], a[href*=".mp4"], button[class*="download"]');
      hasDownloadLink = !!downloadLink;
    }
    
    videoList.push({
      src: videoSrc,
      hasDownloadLink: hasDownloadLink,
      downloadUrl: downloadLink?.href || videoSrc,
      duration: video.duration || 0,
      domIndex: index, // DOM order (0 = first in HTML)
      yPosition: yPosition // Y position on page (lower = higher on page = newer)
    });
  }
  
  // Sort by Y position (top of page = newest video = should be segment_020)
  videoList.sort((a, b) => a.yPosition - b.yPosition);
  
  console.log(`Returning ${videoList.length} Kling generated videos (sorted by page position, top to bottom)`);
  console.log('First 5 videos in sorted order:');
  videoList.slice(0, 5).forEach((v, idx) => {
    console.log(`  ${idx + 1}. Y-pos: ${v.yPosition.toFixed(0)}px, DOM index: ${v.domIndex}`);
  });
  
  return videoList;
}

async function batchDownload(count) {
  try {
    console.log(`Starting download of ${count} videos...`);
    
    // Use the scanned videos from the last scan
    if (scannedVideos.length === 0) {
      chrome.runtime.sendMessage({
        action: 'downloadError',
        error: 'No videos scanned. Please click "Scan Page for Videos" first.'
      });
      return;
    }
    
    console.log(`Using ${scannedVideos.length} scanned videos`);
    
    // Limit to requested count
    const videosToDownload = scannedVideos.slice(0, count);
    
    console.log(`Downloading ${videosToDownload.length} videos...`);
    
    // Download videos from top to bottom, but name them in reverse order
    // So if we have 30 videos, first (newest) gets segment_030.mp4, last gets segment_001.mp4
    for (let i = 0; i < videosToDownload.length; i++) {
      const videoInfo = videosToDownload[i];
      
      // Reverse numbering: first video (index 0) gets highest number
      const reverseIndex = count - i;
      const filename = `segment_${reverseIndex.toString().padStart(3, '0')}.mp4`;
      
      console.log(`Downloading video ${i + 1}/${videosToDownload.length} as ${filename}`);
      
      // Send progress update
      chrome.runtime.sendMessage({
        action: 'downloadProgress',
        current: i + 1,
        total: videosToDownload.length,
        filename: filename
      });
      
      try {
        // Get the video URL - use downloadUrl which might be from a download link or video src
        const videoUrl = videoInfo.downloadUrl || videoInfo.src;
        
        if (!videoUrl) {
          console.warn(`Could not find video URL for video ${i + 1}`);
          continue;
        }
        
        console.log(`Video URL: ${videoUrl}`);
        console.log(`Has download link: ${videoInfo.hasDownloadLink}`);
        
        // Download the video
        await downloadVideo(videoUrl, filename);
        
        // Small delay between downloads
        await sleep(1000);
        
      } catch (error) {
        console.error(`Error downloading video ${i + 1}:`, error);
        // Continue with next video
      }
    }
    
    console.log('Batch download complete!');
    
  } catch (error) {
    console.error('Error in batch download:', error);
    chrome.runtime.sendMessage({
      action: 'downloadError',
      error: error.message
    });
  }
}

async function downloadVideo(url, filename) {
  return new Promise((resolve, reject) => {
    // Use Chrome's download API for better reliability
    chrome.runtime.sendMessage({
      action: 'downloadFile',
      url: url,
      filename: filename
    }, (response) => {
      if (response && response.success) {
        resolve();
      } else {
        // Fallback: try direct link download
        console.log('Chrome download failed, trying direct link...');
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
          document.body.removeChild(a);
          resolve();
        }, 100);
      }
    });
  });
}

