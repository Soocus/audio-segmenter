from flask import Flask, render_template, request, jsonify, send_file, Response, stream_with_context
from flask_cors import CORS
from werkzeug.utils import secure_filename
import os
import replicate
import json
from pydub import AudioSegment
import tempfile
import shutil
from pathlib import Path
import zipfile
from datetime import datetime
import re
import time
import requests
import base64

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max file size
app.config['UPLOAD_FOLDER'] = tempfile.mkdtemp()
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0  # Disable caching for development

# Increase request timeouts for large file uploads
import socket
socket.setdefaulttimeout(300)  # 5 minutes default timeout

# Increase timeouts for long-running requests
import signal
signal.signal(signal.SIGALRM, lambda *args: None)  # Prevent timeouts

ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def parse_srt_to_segments(srt_text):
    """
    Parse SRT format text to extract segments with millisecond-accurate timestamps.
    SRT format:
    1
    00:00:00,000 --> 00:00:02,500
    Text here
    """
    segments = []
    
    # Split by double newlines to get each subtitle block
    blocks = re.split(r'\n\s*\n', srt_text.strip())
    
    for block in blocks:
        lines = block.strip().split('\n')
        if len(lines) >= 3:
            # Parse timestamp line (format: 00:00:00,000 --> 00:00:02,500)
            timestamp_line = lines[1]
            match = re.match(r'(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})', timestamp_line)
            
            if match:
                # Start time
                start_h, start_m, start_s, start_ms = map(int, match.groups()[:4])
                start_time = start_h * 3600 + start_m * 60 + start_s + start_ms / 1000.0
                
                # End time
                end_h, end_m, end_s, end_ms = map(int, match.groups()[4:])
                end_time = end_h * 3600 + end_m * 60 + end_s + end_ms / 1000.0
                
                # Text (join remaining lines)
                text = ' '.join(lines[2:]).strip()
                
                segments.append({
                    'start': start_time,
                    'end': end_time,
                    'text': text
                })
    
    return segments

def find_split_points(segments, max_duration=60.0):
    """
    Find optimal split points in transcript based on punctuation marks.
    Ensures each segment is as long as possible without exceeding max_duration.
    Only splits at punctuation if there are 3+ words before it.
    """
    split_points = []
    current_start = 0.0
    
    # Get total duration from segments
    if not segments:
        return split_points
    
    total_duration = segments[-1].get('end', 0)
    if total_duration is None:
        total_duration = 0
    
    # Build a list of all word timings with their text
    word_timings = []
    for segment in segments:
        text = segment.get('text', '').strip()
        start_time = segment.get('start', 0)
        end_time = segment.get('end', start_time)
        
        # Skip segments with invalid timestamps
        if start_time is None:
            start_time = 0
        if end_time is None:
            end_time = start_time
        
        if text and end_time > 0:
            word_timings.append({
                'start': start_time,
                'end': end_time,
                'text': text
            })
    
    if not word_timings:
        return split_points
    
    # Find split points by looking for the best break before max_duration
    current_start = 0.0
    
    while current_start < total_duration:
        target_time = current_start + max_duration
        
        # Accumulate text from current_start to count words
        accumulated_text = []
        
        # Find the best split point before target_time
        best_split = None
        best_priority = -1
        
        for word in word_timings:
            word_start = word['start']
            word_end = word['end']
            text = word['text']
            
            # Only consider words in the current segment window
            if word_end > current_start and word_end <= target_time:
                # Add to accumulated text
                accumulated_text.append(text)
                
                # Count words in accumulated text (split by spaces and filter empty strings)
                word_count = len([w for w in ' '.join(accumulated_text).split() if w.strip()])
                
                priority = 0
                
                # Check last character for punctuation (ONLY punctuation, no spaces)
                if text and len(text) > 0:
                    last_char = text[-1]
                    # Only consider punctuation if we have 3+ words
                    if word_count >= 3:
                        if last_char in '.?!':
                            priority = 3  # Highest - sentence endings
                        elif last_char in ',;':
                            priority = 2  # Medium - phrase breaks
                    # No priority for spaces/word boundaries - people speak continuously
                
                # Take the highest priority break point, or the latest one if same priority
                if priority > 0 and priority >= best_priority:
                    best_split = word_end
                    best_priority = priority
        
        # If we found a good split point, use it
        if best_split and best_split > current_start:
            split_points.append(best_split)
            current_start = best_split
        else:
            # No good split found, just move forward by max_duration
            current_start += max_duration
            if current_start < total_duration:
                split_points.append(current_start)
    
    return split_points

def split_audio_file(audio_path, split_points, output_dir):
    """
    Split audio file at specified timestamps.
    """
    audio = AudioSegment.from_file(audio_path)
    segments = []
    
    # Add start and end points
    all_points = [0.0] + split_points + [len(audio) / 1000.0]
    
    for i in range(len(all_points) - 1):
        start_ms = int(all_points[i] * 1000)
        end_ms = int(all_points[i + 1] * 1000)
        
        segment_audio = audio[start_ms:end_ms]
        
        # Generate output filename
        segment_filename = f"segment_{i+1:03d}.mp3"
        segment_path = os.path.join(output_dir, segment_filename)
        
        # Export segment
        segment_audio.export(segment_path, format="mp3", bitrate="192k")
        
        segments.append({
            'filename': segment_filename,
            'start_time': all_points[i],
            'end_time': all_points[i + 1],
            'duration': all_points[i + 1] - all_points[i]
        })
    
    return segments

def extract_text_for_segments(transcript_segments, audio_segments):
    """
    Extract transcript text for each audio segment.
    """
    for audio_seg in audio_segments:
        start = audio_seg['start_time']
        end = audio_seg['end_time']
        
        text_parts = []
        for trans_seg in transcript_segments:
            seg_start = trans_seg.get('start', 0)
            seg_end = trans_seg.get('end', seg_start)
            
            # Handle None values
            if seg_start is None:
                seg_start = 0
            if seg_end is None:
                seg_end = seg_start
            
            # Check if transcript segment overlaps with audio segment
            if seg_end >= start and seg_start <= end:
                text_parts.append(trans_seg.get('text', ''))
        
        audio_seg['text'] = ' '.join(text_parts).strip()
    
    return audio_segments

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/test')
def test():
    return '''
    <!DOCTYPE html>
    <html>
    <head><title>API Test</title></head>
    <body>
        <h1>API Connection Test</h1>
        <button onclick="testAPI()">Test /api/estimate-time</button>
        <pre id="result"></pre>
        <script>
            async function testAPI() {
                const resultEl = document.getElementById('result');
                resultEl.textContent = 'Testing...\\n';
                
                try {
                    resultEl.textContent += 'Attempting fetch to /api/estimate-time...\\n';
                    const response = await fetch('/api/estimate-time', {
                        method: 'POST',
                        body: new FormData()
                    });
                    
                    resultEl.textContent += 'Response status: ' + response.status + '\\n';
                    const data = await response.json();
                    resultEl.textContent += 'SUCCESS!\\n' + JSON.stringify(data, null, 2);
                } catch (error) {
                    resultEl.textContent += 'FETCH FAILED!\\n';
                    resultEl.textContent += 'Error: ' + error.message + '\\n';
                    resultEl.textContent += 'Stack: ' + error.stack;
                }
            }
        </script>
    </body>
    </html>
    '''

@app.route('/api/estimate-time', methods=['POST'])
def estimate_time():
    """Get estimated processing time for an audio file without processing it"""
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        file = request.files['audio']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Save temporarily to get duration
        filename = secure_filename(file.filename)
        temp_path = os.path.join(app.config['UPLOAD_FOLDER'], f'temp_{filename}')
        file.save(temp_path)
        
        try:
            audio = AudioSegment.from_file(temp_path)
            audio_duration_seconds = len(audio) / 1000.0
            # incredibly-fast-whisper with batch_size=4: ~33x real-time speed (30 min in 54 sec)
            estimated_transcription_time = int(audio_duration_seconds / 33)
            
            os.remove(temp_path)
            
            return jsonify({
                'audio_duration': audio_duration_seconds,
                'estimated_time': estimated_transcription_time
            })
        except Exception as e:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            return jsonify({'error': f'Could not read audio file: {str(e)}'}), 400
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/process', methods=['POST'])
def process_audio():
    uploaded_file_path = None
    output_dir = None
    
    try:
        # Check if file is present
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        file = request.files['audio']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not allowed_file(file.filename):
            return jsonify({'error': 'Invalid file type. Supported: mp3, wav, ogg, m4a, flac, aac, wma'}), 400
        
        # Get API key and max duration
        api_key = request.form.get('api_key')
        if not api_key:
            return jsonify({'error': 'Replicate API key is required'}), 400
        
        try:
            max_duration = float(request.form.get('max_duration', 60))
            if max_duration < 10 or max_duration > 300:
                return jsonify({'error': 'Max duration must be between 10 and 300 seconds'}), 400
        except ValueError:
            return jsonify({'error': 'Invalid max duration value'}), 400
        
        # Save uploaded file
        filename = secure_filename(file.filename)
        uploaded_file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(uploaded_file_path)
        
        # Get audio duration for time estimate
        audio = AudioSegment.from_file(uploaded_file_path)
        audio_duration_seconds = len(audio) / 1000.0
        # incredibly-fast-whisper with batch_size=4: ~33x real-time speed (30 min in 54 sec)
        estimated_transcription_time = int(audio_duration_seconds / 33)
        
        print(f"Audio duration: {audio_duration_seconds:.1f}s, Estimated transcription time: {estimated_transcription_time}s")
        
        # Set Replicate API token
        os.environ['REPLICATE_API_TOKEN'] = api_key
        
        # Step 1: Transcribe with incredibly-fast-whisper (with word-level timestamps)
        print("Starting transcription with incredibly-fast-whisper...")
        
        import urllib.request
        
        # Open file and read contents for Replicate
        # Using incredibly-fast-whisper with conservative settings to avoid GPU memory issues
        # Use prediction API with polling to avoid timeouts
        prediction = replicate.predictions.create(
            version="3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
            input={
                "audio": open(uploaded_file_path, 'rb'),
                "task": "transcribe",
                "batch_size": 4,  # Very low batch size to avoid GPU memory overflow
                "timestamp": "word"  # Word-level timestamps for accurate splitting
            }
        )
        
        print(f"Prediction created with ID: {prediction.id}")
        
        # Poll for completion with periodic status updates
        max_wait_time = 600  # 10 minutes maximum wait
        poll_interval = 2  # Poll every 2 seconds
        start_time = time.time()
        
        while prediction.status not in ['succeeded', 'failed', 'canceled']:
            elapsed = time.time() - start_time
            
            if elapsed > max_wait_time:
                prediction.cancel()
                raise Exception(f'Transcription timed out after {max_wait_time} seconds')
            
            time.sleep(poll_interval)
            prediction.reload()
            print(f"Prediction status: {prediction.status} (elapsed: {elapsed:.1f}s)")
        
        if prediction.status == 'failed':
            error_msg = getattr(prediction, 'error', 'Unknown error')
            raise Exception(f'Replicate prediction failed: {error_msg}')
        
        if prediction.status == 'canceled':
            raise Exception('Prediction was canceled')
        
        output = prediction.output
        print(f"Transcription completed in {time.time() - start_time:.1f}s")
        
        print(f"Whisper output type: {type(output)}")
        print(f"Whisper output: {output}")
        
        # Parse output - incredibly-fast-whisper returns JSON with word-level timestamps
        segments = []
        
        if isinstance(output, dict):
            # Check if output has 'segments' or 'chunks' or 'words'
            if 'segments' in output:
                # Standard format with segments
                for seg in output['segments']:
                    # If segment has words, use word-level timestamps for better precision
                    if 'words' in seg and seg['words']:
                        for word in seg['words']:
                            segments.append({
                                'start': word.get('start', 0),
                                'end': word.get('end', word.get('start', 0)),
                                'text': word.get('word', word.get('text', '')).strip()
                            })
                    else:
                        # Fall back to segment-level timestamps
                        segments.append({
                            'start': seg.get('start', 0),
                            'end': seg.get('end', 0),
                            'text': seg.get('text', '').strip()
                        })
            elif 'chunks' in output:
                # Alternative format
                for chunk in output['chunks']:
                    segments.append({
                        'start': chunk.get('timestamp', [0, 0])[0],
                        'end': chunk.get('timestamp', [0, 0])[1],
                        'text': chunk.get('text', '').strip()
                    })
            elif 'text' in output:
                # Simple text output, try to parse if it's SRT
                srt_text = output.get('text', '')
                segments = parse_srt_to_segments(srt_text)
        elif isinstance(output, str):
            # String output, might be SRT or URL
            if output.startswith('http'):
                with urllib.request.urlopen(output) as response:
                    data = response.read().decode('utf-8')
                    try:
                        output = json.loads(data)
                        if 'segments' in output:
                            segments = [{'start': s['start'], 'end': s['end'], 'text': s['text'].strip()} 
                                      for s in output['segments']]
                    except:
                        segments = parse_srt_to_segments(data)
            else:
                segments = parse_srt_to_segments(output)
        
        # Extract plain text from segments for metadata
        transcript_text = ' '.join([seg['text'] for seg in segments])
        
        if not segments:
            # Clean up uploaded file before returning error
            if uploaded_file_path and os.path.exists(uploaded_file_path):
                os.remove(uploaded_file_path)
            return jsonify({'error': 'No transcript segments received from Whisper'}), 500
        
        print(f"Total segments parsed: {len(segments)}")
        print(f"First 3 segments: {segments[:3]}")
        print(f"Last segment end time: {segments[-1].get('end', 0)}")
        
        # Step 2: Find split points
        print("Finding split points...")
        split_points = find_split_points(segments, max_duration=max_duration)
        print(f"Split points found: {split_points}")
        
        # Step 3: Split audio
        print("Splitting audio...")
        output_dir = os.path.join(app.config['UPLOAD_FOLDER'], f'output_{datetime.now().strftime("%Y%m%d_%H%M%S")}')
        os.makedirs(output_dir, exist_ok=True)
        
        audio_segments = split_audio_file(uploaded_file_path, split_points, output_dir)
        
        # Step 4: Extract text for each segment
        audio_segments = extract_text_for_segments(segments, audio_segments)
        
        # Save transcript files
        for seg in audio_segments:
            txt_filename = seg['filename'].replace('.mp3', '.txt')
            txt_path = os.path.join(output_dir, txt_filename)
            with open(txt_path, 'w', encoding='utf-8') as f:
                f.write(seg['text'])
        
        # Save metadata
        metadata = {
            'original_file': filename,
            'total_segments': len(audio_segments),
            'max_duration': max_duration,
            'segments': audio_segments,
            'full_transcript': transcript_text
        }
        
        metadata_path = os.path.join(output_dir, 'metadata.json')
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, indent=2, fp=f)
        
        # Create ZIP file with organized folders
        zip_filename = f'segments_{datetime.now().strftime("%Y%m%d_%H%M%S")}.zip'
        zip_path = os.path.join(app.config['UPLOAD_FOLDER'], zip_filename)
        
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for root, dirs, files in os.walk(output_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    
                    # Organize files into subfolders
                    if file.endswith('.mp3'):
                        arcname = os.path.join('audio', file)
                    elif file.endswith('.txt'):
                        arcname = os.path.join('transcripts', file)
                    elif file == 'metadata.json':
                        arcname = file
                    else:
                        arcname = file
                    
                    zipf.write(file_path, arcname)
        
        # Clean up uploaded file
        os.remove(uploaded_file_path)
        
        return jsonify({
            'success': True,
            'download_url': f'/api/download/{zip_filename}',
            'metadata': metadata,
            'audio_duration': audio_duration_seconds,
            'estimated_time': estimated_transcription_time
        })
    
    except Exception as e:
        error_message = str(e)
        print(f"Error: {error_message}")
        
        # Provide helpful error messages for common issues
        if "cuda" in error_message.lower() or "out of memory" in error_message.lower() or "memory" in error_message.lower():
            error_message = "GPU memory limit exceeded. Your audio file is too long for Replicate's GPU. Please try splitting your audio into smaller files (10-15 minutes each) and processing them separately."
        elif "timeout" in error_message.lower():
            error_message = "Processing timed out. This usually happens with very large files. Try splitting your audio into smaller files first."
        elif "404" in error_message or "not found" in error_message.lower():
            error_message = "Replicate model not found. Please check your internet connection and try again."
        
        # Clean up on error
        try:
            if uploaded_file_path and os.path.exists(uploaded_file_path):
                os.remove(uploaded_file_path)
            if output_dir and os.path.exists(output_dir):
                shutil.rmtree(output_dir)
        except Exception as cleanup_error:
            print(f"Cleanup error: {str(cleanup_error)}")
        
        return jsonify({'error': error_message}), 500

@app.route('/api/download/<filename>')
def download_file(filename):
    # Validate filename to prevent path traversal attacks
    filename = secure_filename(filename)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True, download_name=filename)
    return jsonify({'error': 'File not found'}), 404

@app.route('/api/cleanup/<filename>', methods=['POST'])
def cleanup_files(filename):
    """Clean up files after download"""
    try:
        filename = secure_filename(filename)
        zip_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Remove ZIP file
        if os.path.exists(zip_path):
            os.remove(zip_path)
        
        # Remove corresponding output directory
        output_dir = zip_path.replace('.zip', '').replace('segments_', 'output_')
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/combine-videos', methods=['POST'])
def combine_videos():
    """Combine multiple video files into one using ffmpeg"""
    import subprocess
    
    try:
        # Get uploaded video files
        videos = request.files.getlist('videos')
        
        if not videos or len(videos) < 1:
            return jsonify({'error': 'No videos uploaded'}), 400
        
        # Create temp directory for this operation
        temp_dir = tempfile.mkdtemp()
        video_files = []
        
        # Save all uploaded videos with proper ordering
        for i, video in enumerate(videos):
            filename = secure_filename(video.filename)
            video_path = os.path.join(temp_dir, filename)
            video.save(video_path)
            video_files.append(video_path)
        
        # Sort files by name to ensure correct order (segment_001, segment_002, etc.)
        video_files.sort()
        
        # Create concat file for ffmpeg
        concat_file_path = os.path.join(temp_dir, 'concat.txt')
        with open(concat_file_path, 'w') as f:
            for video_file in video_files:
                # Escape single quotes and wrap in single quotes for ffmpeg
                escaped_path = video_file.replace("'", "'\\''")
                f.write(f"file '{escaped_path}'\n")
        
        # Output file path
        output_filename = f'combined_video_{datetime.now().strftime("%Y%m%d_%H%M%S")}.mp4'
        output_path = os.path.join(temp_dir, output_filename)
        
        # Use ffmpeg to concatenate videos
        # -f concat: use concat demuxer
        # -safe 0: allow any file path
        # -i: input concat file
        # -c copy: copy streams without re-encoding (fastest)
        ffmpeg_cmd = [
            'ffmpeg',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_file_path,
            '-c', 'copy',
            output_path
        ]
        
        print(f'Running ffmpeg command: {" ".join(ffmpeg_cmd)}')
        
        # Run ffmpeg
        result = subprocess.run(
            ffmpeg_cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        if result.returncode != 0:
            print(f'FFmpeg error: {result.stderr}')
            return jsonify({'error': f'FFmpeg failed: {result.stderr}'}), 500
        
        # Check if output file was created
        if not os.path.exists(output_path):
            return jsonify({'error': 'Combined video file was not created'}), 500
        
        print(f'Successfully combined {len(video_files)} videos into {output_filename}')
        
        # Send the combined video file
        return send_file(
            output_path,
            mimetype='video/mp4',
            as_attachment=True,
            download_name=output_filename
        )
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Video combining timed out (>5 minutes)'}), 500
    except Exception as e:
        print(f'Error combining videos: {str(e)}')
        return jsonify({'error': str(e)}), 500
    finally:
        # Clean up temp files after a delay (to allow download to complete)
        # In production, you'd want a better cleanup mechanism
        try:
            if 'temp_dir' in locals():
                # Give the download 10 seconds to complete before cleanup
                import threading
                def cleanup_later():
                    import time
                    time.sleep(10)
                    try:
                        shutil.rmtree(temp_dir)
                        print(f'Cleaned up temp directory: {temp_dir}')
                    except:
                        pass
                threading.Thread(target=cleanup_later, daemon=True).start()
        except:
            pass

@app.route('/trim-videos-zip', methods=['POST'])
def trim_videos_zip():
    """Trim multiple video files to specified durations and return as ZIP"""
    import subprocess
    
    try:
        # Get uploaded video files
        videos = request.files.getlist('videos')
        durations_json = request.form.get('durations')
        
        if not videos or len(videos) < 1:
            return jsonify({'error': 'No videos uploaded'}), 400
        
        if not durations_json:
            return jsonify({'error': 'No durations provided'}), 400
        
        # Parse durations mapping (filename -> duration in seconds)
        durations_map = json.loads(durations_json)
        
        # Create temp directory for this operation
        temp_dir = tempfile.mkdtemp()
        trimmed_files = []
        
        print(f'Trimming {len(videos)} videos...')
        
        # Process each video
        for video in videos:
            filename = secure_filename(video.filename)
            
            # Check if we have a duration for this video
            if filename not in durations_map:
                print(f'Warning: No duration specified for {filename}, skipping trim')
                # Save without trimming
                video_path = os.path.join(temp_dir, filename)
                video.save(video_path)
                trimmed_files.append(video_path)
                continue
            
            target_duration = durations_map[filename]
            
            # Save original video
            original_path = os.path.join(temp_dir, f'original_{filename}')
            video.save(original_path)
            
            # Output path for trimmed video
            trimmed_path = os.path.join(temp_dir, filename)
            
            # Trim video using ffmpeg with millisecond precision
            # -y: overwrite without asking
            # -i: input file
            # -t: duration to trim to (with millisecond precision)
            # -c:v libx264: re-encode video for precise cutting
            # -preset fast: balance between speed and quality
            # -crf 18: high quality (lower = better, 18 is near-lossless)
            # -c:a aac: re-encode audio
            # -b:a 192k: audio bitrate
            ffmpeg_cmd = [
                'ffmpeg',
                '-y',
                '-i', original_path,
                '-t', f'{target_duration:.3f}',  # Format to 3 decimal places (milliseconds)
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '18',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-avoid_negative_ts', 'make_zero',
                trimmed_path
            ]
            
            print(f'Trimming {filename} to {target_duration:.3f}s (millisecond precision)...')
            
            result = subprocess.run(
                ffmpeg_cmd,
                capture_output=True,
                text=True,
                timeout=120  # Increased timeout for re-encoding
            )
            
            if result.returncode != 0:
                print(f'FFmpeg trim error for {filename}: {result.stderr}')
                # Use original if trim fails
                shutil.copy(original_path, trimmed_path)
            
            trimmed_files.append(trimmed_path)
            
            # Remove original file to save space
            os.remove(original_path)
        
        # Create ZIP file
        zip_filename = f'trimmed_videos_{datetime.now().strftime("%Y%m%d_%H%M%S")}.zip'
        zip_path = os.path.join(temp_dir, zip_filename)
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for video_file in trimmed_files:
                zipf.write(video_file, os.path.basename(video_file))
        
        print(f'Successfully trimmed and zipped {len(trimmed_files)} videos')
        
        # Send the ZIP file
        return send_file(
            zip_path,
            mimetype='application/zip',
            as_attachment=True,
            download_name=zip_filename
        )
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Video trimming timed out'}), 500
    except Exception as e:
        print(f'Error trimming videos: {str(e)}')
        return jsonify({'error': str(e)}), 500
    finally:
        # Clean up temp files after a delay
        try:
            if 'temp_dir' in locals():
                import threading
                def cleanup_later():
                    import time
                    time.sleep(10)
                    try:
                        shutil.rmtree(temp_dir)
                        print(f'Cleaned up temp directory: {temp_dir}')
                    except:
                        pass
                threading.Thread(target=cleanup_later, daemon=True).start()
        except:
            pass


@app.route('/trim-and-combine-videos', methods=['POST'])
def trim_and_combine_videos():
    """Trim videos to specified durations and then combine them into one"""
    import subprocess
    
    try:
        # Get uploaded video files
        videos = request.files.getlist('videos')
        durations_json = request.form.get('durations')
        
        if not videos or len(videos) < 1:
            return jsonify({'error': 'No videos uploaded'}), 400
        
        if not durations_json:
            return jsonify({'error': 'No durations provided'}), 400
        
        # Parse durations mapping (filename -> duration in seconds)
        durations_map = json.loads(durations_json)
        
        # Create temp directory for this operation
        temp_dir = tempfile.mkdtemp()
        trimmed_files = []
        
        print(f'Trimming and combining {len(videos)} videos...')
        print(f'Received videos in this order:')
        for idx, video in enumerate(videos, 1):
            print(f'  {idx}. {video.filename}')
        
        # Step 1: Trim each video
        for video in videos:
            filename = secure_filename(video.filename)
            
            # Check if we have a duration for this video
            if filename not in durations_map:
                print(f'Warning: No duration specified for {filename}, using original')
                # Save without trimming
                video_path = os.path.join(temp_dir, filename)
                video.save(video_path)
                trimmed_files.append(video_path)
                continue
            
            target_duration = durations_map[filename]
            
            # Save original video
            original_path = os.path.join(temp_dir, f'original_{filename}')
            video.save(original_path)
            
            # Output path for trimmed video
            trimmed_path = os.path.join(temp_dir, filename)
            
            # Trim video using ffmpeg with millisecond precision
            # -y: overwrite without asking
            # -i: input file
            # -t: duration to trim to (with millisecond precision)
            # -c:v libx264: re-encode video for precise cutting
            # -preset fast: balance between speed and quality
            # -crf 18: high quality (lower = better, 18 is near-lossless)
            # -c:a aac: re-encode audio
            # -b:a 192k: audio bitrate
            ffmpeg_cmd = [
                'ffmpeg',
                '-y',
                '-i', original_path,
                '-t', f'{target_duration:.3f}',  # Format to 3 decimal places (milliseconds)
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '18',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-avoid_negative_ts', 'make_zero',
                trimmed_path
            ]
            
            print(f'Trimming {filename} to {target_duration:.3f}s (millisecond precision)...')
            
            result = subprocess.run(
                ffmpeg_cmd,
                capture_output=True,
                text=True,
                timeout=120  # Increased timeout for re-encoding
            )
            
            if result.returncode != 0:
                print(f'FFmpeg trim error for {filename}: {result.stderr}')
                # Use original if trim fails
                shutil.copy(original_path, trimmed_path)
            
            trimmed_files.append(trimmed_path)
            
            # Remove original file to save space
            os.remove(original_path)
        
        # Step 2: Sort files by name to ensure correct order
        trimmed_files.sort()
        
        # Debug: Print the order of files
        print(f'Sorted order for combining:')
        for idx, video_file in enumerate(trimmed_files, 1):
            print(f'  {idx}. {os.path.basename(video_file)}')
        
        # Step 3: Create concat file for ffmpeg
        concat_file_path = os.path.join(temp_dir, 'concat.txt')
        with open(concat_file_path, 'w') as f:
            for video_file in trimmed_files:
                # Escape single quotes and wrap in single quotes for ffmpeg
                escaped_path = video_file.replace("'", "'\\''")
                f.write(f"file '{escaped_path}'\n")
        
        # Debug: Print concat file contents
        print(f'Concat file contents:')
        with open(concat_file_path, 'r') as f:
            print(f.read())
        
        # Step 4: Combine trimmed videos
        output_filename = f'combined_trimmed_{datetime.now().strftime("%Y%m%d_%H%M%S")}.mp4'
        output_path = os.path.join(temp_dir, output_filename)
        
        ffmpeg_cmd = [
            'ffmpeg',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_file_path,
            '-c', 'copy',
            output_path
        ]
        
        print(f'Combining {len(trimmed_files)} trimmed videos...')
        
        result = subprocess.run(
            ffmpeg_cmd,
            capture_output=True,
            text=True,
            timeout=300
        )
        
        if result.returncode != 0:
            print(f'FFmpeg combine error: {result.stderr}')
            return jsonify({'error': f'FFmpeg failed: {result.stderr}'}), 500
        
        if not os.path.exists(output_path):
            return jsonify({'error': 'Combined video file was not created'}), 500
        
        print(f'Successfully trimmed and combined {len(trimmed_files)} videos into {output_filename}')
        
        # Send the combined video file
        return send_file(
            output_path,
            mimetype='video/mp4',
            as_attachment=True,
            download_name=output_filename
        )
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Video processing timed out'}), 500
    except Exception as e:
        print(f'Error processing videos: {str(e)}')
        return jsonify({'error': str(e)}), 500
    finally:
        # Clean up temp files after a delay
        try:
            if 'temp_dir' in locals():
                import threading
                def cleanup_later():
                    import time
                    time.sleep(10)
                    try:
                        shutil.rmtree(temp_dir)
                        print(f'Cleaned up temp directory: {temp_dir}')
                    except:
                        pass
                threading.Thread(target=cleanup_later, daemon=True).start()
        except:
            pass


@app.route('/api/kling-lipsync', methods=['POST'])
def kling_lipsync():
    """Submit video and audio to Kling AI for lip sync"""
    video_file_path = None
    audio_file_path = None
    
    try:
        # Check if files are present
        if 'video' not in request.files or 'audio' not in request.files:
            return jsonify({'error': 'Video and audio files are required'}), 400
        
        video_file = request.files['video']
        audio_file = request.files['audio']
        
        if video_file.filename == '' or audio_file.filename == '':
            return jsonify({'error': 'No files selected'}), 400
        
        # Get API keys
        access_key = request.form.get('kling_access_key')
        secret_key = request.form.get('kling_secret_key')
        if not access_key or not secret_key:
            return jsonify({'error': 'Both Kling Access Key and Secret Key are required'}), 400
        
        # Save files temporarily
        video_filename = secure_filename(video_file.filename)
        audio_filename = secure_filename(audio_file.filename)
        
        video_file_path = os.path.join(app.config['UPLOAD_FOLDER'], video_filename)
        audio_file_path = os.path.join(app.config['UPLOAD_FOLDER'], audio_filename)
        
        video_file.save(video_file_path)
        audio_file.save(audio_file_path)
        
        print(f"Files saved: video={video_file_path}, audio={audio_file_path}")
        
        # Read and encode files as base64
        print("Encoding video file...")
        with open(video_file_path, 'rb') as f:
            video_base64 = base64.b64encode(f.read()).decode('utf-8')
        
        print("Encoding audio file...")
        with open(audio_file_path, 'rb') as f:
            audio_base64 = base64.b64encode(f.read()).decode('utf-8')
        
        # Submit lip sync job to Kling AI
        kling_api_url = "https://api.klingai.com/v1/videos/video-to-lip"
        
        headers = {
            "Authorization": f"Bearer {access_key}:{secret_key}",
            "Content-Type": "application/json"
        }
        
        # Prepare JSON payload with base64-encoded files
        payload = {
            "model_name": "kling-v1",
            "video_file": video_base64,
            "audio_file": audio_base64,
            "cfg_scale": 0.5,
            "mode": "std"
        }
        
        print(f"Submitting to Kling API (video: {len(video_base64)} chars, audio: {len(audio_base64)} chars)...")
        
        response = requests.post(kling_api_url, headers=headers, json=payload, timeout=120)
        
        if response.status_code != 200:
            error_msg = f"Kling API error: {response.status_code} - {response.text}"
            print(error_msg)
            return jsonify({'error': error_msg}), 500
        
        result = response.json()
        print(f"Kling API response: {result}")
        
        if result.get('code') != 0:
            error_msg = f"Kling API error: {result.get('message', 'Unknown error')}"
            print(error_msg)
            return jsonify({'error': error_msg}), 500
        
        task_id = result['data']['task_id']
        
        print(f"Kling task created: {task_id}")
        
        # Store task info for polling
        # In production, use a database
        task_info = {
            'task_id': task_id,
            'status': 'processing',
            'video_file': video_file_path,
            'audio_file': audio_file_path,
            'access_key': access_key,
            'secret_key': secret_key
        }
        
        # Clean up temp files after a delay
        # In production, clean up after task completes
        
        return jsonify({
            'success': True,
            'task_id': task_id
        })
    
    except requests.exceptions.RequestException as e:
        error_message = f'Network error: {str(e)}'
        print(f"Error: {error_message}")
        
        # Clean up on error
        if video_file_path and os.path.exists(video_file_path):
            os.remove(video_file_path)
        if audio_file_path and os.path.exists(audio_file_path):
            os.remove(audio_file_path)
        
        return jsonify({'error': error_message}), 500
    
    except Exception as e:
        error_message = str(e)
        print(f"Error: {error_message}")
        
        # Clean up on error
        if video_file_path and os.path.exists(video_file_path):
            os.remove(video_file_path)
        if audio_file_path and os.path.exists(audio_file_path):
            os.remove(audio_file_path)
        
        return jsonify({'error': error_message}), 500

@app.route('/api/kling-status/<task_id>')
def kling_status(task_id):
    """Poll Kling AI for task status"""
    try:
        # In production, retrieve API keys from database
        # For now, accept them as query parameters
        access_key = request.args.get('access_key')
        secret_key = request.args.get('secret_key')
        if not access_key or not secret_key:
            return jsonify({'error': 'Both Access Key and Secret Key required'}), 400
        
        # Query Kling API for task status
        kling_api_url = f"https://api.klingai.com/v1/videos/video-to-lip/{task_id}"
        
        headers = {
            "Authorization": f"Bearer {access_key}:{secret_key}"
        }
        
        response = requests.get(kling_api_url, headers=headers, timeout=15)
        
        if response.status_code != 200:
            return jsonify({'error': f'Kling API error: {response.status_code}'}), 500
        
        result = response.json()
        
        if result.get('code') != 0:
            return jsonify({'error': result.get('message', 'Unknown error')}), 500
        
        task_data = result['data']['task']
        task_status = task_data['status']
        
        response_data = {
            'task_id': task_id,
            'status': task_status
        }
        
        # Status can be: processing, succeed, failed
        if task_status == 'succeed':
            response_data['video_url'] = task_data['task_result']['videos'][0]['url']
            response_data['status'] = 'completed'
        elif task_status == 'failed':
            response_data['error'] = task_data.get('task_status_msg', 'Task failed')
            response_data['status'] = 'failed'
        
        return jsonify(response_data)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Use threaded mode to handle multiple requests
    # Set higher timeout limits for long-running transcription tasks
    app.run(debug=True, port=5003, host='127.0.0.1', threaded=True)

