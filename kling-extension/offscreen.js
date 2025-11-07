// Offscreen document for audio processing
// This runs in the background even when popup is closed

console.log('Offscreen document loaded for audio processing');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Offscreen received message:', message.action);
  
  if (message.action === 'processAudio') {
    processAudioSegmentation(message.data)
      .then(result => {
        sendResponse({ success: true, result: result });
      })
      .catch(error => {
        console.error('Audio processing error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'parseTranscript') {
    try {
      const segments = parseTranscript(message.transcriptData, message.maxDuration);
      sendResponse({ success: true, segments: segments });
    } catch (error) {
      console.error('Transcript parsing error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
});

// Main audio processing function
async function processAudioSegmentation(data) {
  console.log('Starting audio processing in offscreen document');
  const { audioDataUrl, segments } = data;
  
  // Send progress update
  sendProgressUpdate(60, 'Loading audio buffer...', 'Decoding audio data');
  
  // Decode audio from data URL
  const response = await fetch(audioDataUrl);
  const arrayBuffer = await response.arrayBuffer();
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  console.log('Audio buffer decoded, duration:', audioBuffer.duration);
  
  // Send progress update
  sendProgressUpdate(70, 'Splitting audio...', `Creating ${segments.length} segments`);
  
  // Split audio into segments
  const segmentBlobs = await splitAudioIntoSegments(audioBuffer, segments, (progress, current, total) => {
    const percent = 70 + Math.floor((progress / total) * 20);
    sendProgressUpdate(percent, 'Splitting audio...', `Encoding segment ${current}/${total}`);
  });
  
  console.log(`Created ${segmentBlobs.length} audio blobs`);
  
  if (segmentBlobs.length === 0) {
    throw new Error('No audio segments created');
  }
  
  // Send progress update
  sendProgressUpdate(90, 'Creating ZIP file...', 'Packaging segments');
  
  // Create ZIP file
  const zip = new JSZip();
  segmentBlobs.forEach((blob, index) => {
    const filename = `segment_${(index + 1).toString().padStart(3, '0')}.mp3`;
    console.log(`Adding to ZIP: ${filename}, size: ${blob.size} bytes`);
    zip.file(filename, blob);
  });
  
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  console.log('ZIP file created, size:', zipBlob.size, 'bytes');
  
  if (zipBlob.size < 1000) {
    throw new Error('ZIP file is too small (< 1KB). Something went wrong with encoding.');
  }
  
  // Convert to data URL for transfer
  const zipDataUrl = await blobToDataUrl(zipBlob);
  
  // Clean up audio context
  await audioContext.close();
  
  return {
    zipDataUrl: zipDataUrl,
    segmentCount: segments.length
  };
}

// Helper function to send progress updates
function sendProgressUpdate(percent, status, detail) {
  chrome.runtime.sendMessage({
    action: 'offscreenProgress',
    percent: percent,
    status: status,
    detail: detail
  }).catch(() => {
    // Popup might be closed, that's okay
    console.log('Could not send progress (popup closed)');
  });
}

// Parse transcript into segments
function parseTranscript(transcriptData, maxDuration) {
  console.log('=== PARSING TRANSCRIPT IN OFFSCREEN ===');
  console.log('Max duration:', maxDuration, 'seconds');
  
  const wordTimings = [];
  let totalDuration = 0;
  
  if (transcriptData && typeof transcriptData === 'object') {
    if (transcriptData.segments && Array.isArray(transcriptData.segments) && transcriptData.segments.length > 0) {
      console.log(`Found ${transcriptData.segments.length} transcript segments`);
      
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
      console.log(`Found ${transcriptData.chunks.length} chunks`);
      for (const chunk of transcriptData.chunks) {
        const timestamp = chunk.timestamp || [0, 0];
        wordTimings.push({
          start: timestamp[0],
          end: timestamp[1],
          text: (chunk.text || '').trim()
        });
        totalDuration = Math.max(totalDuration, timestamp[1]);
      }
    }
  }
  
  if (wordTimings.length === 0) {
    throw new Error('No word timings found in transcript');
  }
  
  console.log(`Total words: ${wordTimings.length}, Total duration: ${totalDuration.toFixed(2)}s`);
  
  // Find split points
  const splitPoints = [];
  let currentStart = 0.0;
  
  while (currentStart < totalDuration) {
    const targetTime = currentStart + maxDuration;
    let accumulatedText = [];
    let bestSplit = null;
    let bestPriority = -1;
    
    for (const word of wordTimings) {
      const wordEnd = word.end;
      const text = word.text;
      
      if (wordEnd > currentStart && wordEnd <= targetTime) {
        accumulatedText.push(text);
        
        const wordCount = accumulatedText.join(' ').split(/\s+/).filter(w => w.trim()).length;
        let priority = 0;
        
        if (wordCount >= 3 && text.length > 0) {
          const lastChar = text.slice(-1);
          if (/[.?!]/.test(lastChar)) {
            priority = 3;
          } else if (/[,;]/.test(lastChar)) {
            priority = 2;
          }
        }
        
        if (priority > 0 && priority >= bestPriority) {
          bestSplit = wordEnd;
          bestPriority = priority;
        }
      }
    }
    
    if (bestSplit && bestSplit > currentStart) {
      splitPoints.push(bestSplit);
      currentStart = bestSplit;
    } else {
      currentStart += maxDuration;
      if (currentStart < totalDuration) {
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
    }
  }
  
  console.log(`Total segments created: ${segments.length}`);
  return segments;
}

// Split audio into segments
async function splitAudioIntoSegments(audioBuffer, segments, progressCallback) {
  const segmentBlobs = [];
  const sampleRate = audioBuffer.sampleRate;
  const numberOfChannels = audioBuffer.numberOfChannels;
  const audioContext = new AudioContext();
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    console.log(`Processing segment ${i + 1}/${segments.length}: ${segment.start}s - ${segment.end}s`);
    
    if (progressCallback) {
      progressCallback(i, i + 1, segments.length);
    }
    
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

// Encode audio buffer to MP3
function encodeToMp3(audioBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const channels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
      const samples = audioBuffer.length;
      
      console.log(`Encoding to MP3: ${channels} channels, ${sampleRate}Hz, ${samples} samples`);
      
      const leftChannel = audioBuffer.getChannelData(0);
      const rightChannel = channels > 1 ? audioBuffer.getChannelData(1) : leftChannel;
      
      const left = new Int16Array(samples);
      const right = new Int16Array(samples);
      
      for (let i = 0; i < samples; i++) {
        left[i] = Math.max(-32768, Math.min(32767, leftChannel[i] * 32768));
        right[i] = Math.max(-32768, Math.min(32767, rightChannel[i] * 32768));
      }
      
      const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
      const mp3Data = [];
      
      const sampleBlockSize = 1152;
      for (let i = 0; i < samples; i += sampleBlockSize) {
        const leftChunk = left.subarray(i, i + sampleBlockSize);
        const rightChunk = right.subarray(i, i + sampleBlockSize);
        const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
        if (mp3buf.length > 0) {
          mp3Data.push(mp3buf);
        }
      }
      
      const mp3buf = mp3encoder.flush();
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
      
      const blob = new Blob(mp3Data, { type: 'audio/mp3' });
      
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

// Helper: blob to data URL
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

