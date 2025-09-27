#!/usr/bin/env python3
"""
Enhanced transcript server for YouTube Voice Control Extension
Uses yt-dlp to download audio and Whisper AI for word-level timestamps
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import yt_dlp
from urllib.parse import urlparse, parse_qs
import os
import json
import tempfile
from openai import OpenAI

app = Flask(__name__)
CORS(app)  # Allow CORS for extension

# Initialize OpenAI client for Whisper
client = OpenAI(
    api_key="aa58691d-f326-439d-97c0-371ed375928a",  # Replace with actual API key
    base_url="https://api.sambanova.ai/v1",
)

def extract_video_id(url):
    """Extract video ID from YouTube URL"""
    if 'v=' in url:
        return url.split('v=')[1].split('&')[0]
    elif 'youtu.be/' in url:
        return url.split('youtu.be/')[1].split('?')[0]
    return url  # Assume it's already a video ID

def download_audio(video_id):
    """Download audio from YouTube video using yt-dlp"""
    try:
        url = f"https://www.youtube.com/watch?v={video_id}"
        
        # Create temp directory for audio files
        audio_dir = os.path.join(os.path.dirname(__file__), 'audio')
        os.makedirs(audio_dir, exist_ok=True)
        
        audio_path = os.path.join(audio_dir, f"{video_id}.mp3")
        
        # Check if audio already exists
        if os.path.exists(audio_path):
            print(f"[AUDIO] Using existing audio for {video_id}")
            return audio_path
        
        print(f"[AUDIO] Downloading audio for {video_id}")
        
        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'outtmpl': os.path.join(audio_dir, f"{video_id}.%(ext)s"),
            'quiet': True,
            'no_warnings': True
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        
        if os.path.exists(audio_path):
            print(f"[AUDIO] Successfully downloaded audio for {video_id}")
            return audio_path
        else:
            print(f"[AUDIO] Failed to download audio for {video_id}")
            return None
            
    except Exception as e:
        print(f"[AUDIO] Error downloading audio: {e}")
        return None

def transcribe_audio(audio_path):
    """Transcribe audio using Whisper with word-level timestamps"""
    try:
        print(f"[WHISPER] Transcribing audio: {audio_path}")
        
        with open(audio_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model="Whisper-Large-v3",
                file=audio_file,
                response_format="verbose_json",
                timestamp_granularities=["word"]
            )
        
        print(f"[WHISPER] Transcription completed with {len(response.words)} words")
        return response
        
    except Exception as e:
        print(f"[WHISPER] Error transcribing audio: {e}")
        return None

def format_whisper_to_vtt(whisper_response, video_id):
    """Convert Whisper response to VTT format with word-level timestamps"""
    try:
        vtt_content = "WEBVTT\nKind: captions\nLanguage: en\n\n"
        
        if not hasattr(whisper_response, 'words') or not whisper_response.words:
            print("[VTT] No word-level data available")
            return None
        
        # Group words into segments (every 5 seconds or 10 words)
        segments = []
        current_segment = []
        segment_start = 0
        
        for i, word in enumerate(whisper_response.words):
            if not current_segment:
                segment_start = word.start
            
            current_segment.append(word)
            
            # End segment if 5+ seconds passed or 10+ words
            should_end = (
                (word.end - segment_start >= 5.0) or 
                (len(current_segment) >= 10) or 
                (i == len(whisper_response.words) - 1)
            )
            
            if should_end:
                segments.append({
                    'start': segment_start,
                    'end': word.end,
                    'words': current_segment[:]
                })
                current_segment = []
        
        # Generate VTT with word-level timestamps
        for segment in segments:
            start_time = format_vtt_time(segment['start'])
            end_time = format_vtt_time(segment['end'])
            
            vtt_content += f"{start_time} --> {end_time} align:start position:0%\n"
            
            # Build line with word-level timestamps
            line_parts = []
            for i, word in enumerate(segment['words']):
                word_time = format_vtt_time(word.start)
                if i == 0:
                    line_parts.append(f"{word.word}<{word_time}><c>")
                else:
                    line_parts.append(f" {word.word}</c><{word_time}><c>")
            
            if line_parts:
                line_parts[-1] = line_parts[-1].replace('><c>', '') + '</c>'
                vtt_content += ''.join(line_parts) + '\n\n'
        
        print(f"[VTT] Generated VTT with {len(segments)} segments")
        return vtt_content
        
    except Exception as e:
        print(f"[VTT] Error formatting VTT: {e}")
        return None

def format_vtt_time(seconds):
    """Format seconds to VTT timestamp format (HH:MM:SS.mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"

def get_transcript(video_id, use_whisper=False):
    """Get transcript using either yt-dlp captions or Whisper AI"""
    import requests
    transcripts_dir = os.path.join(os.path.dirname(__file__), 'transcripts')
    os.makedirs(transcripts_dir, exist_ok=True)
    
    whisper_vtt_path = os.path.join(transcripts_dir, f"{video_id}_whisper.vtt")
    original_vtt_path = os.path.join(transcripts_dir, f"{video_id}.vtt")
    
    # Priority: Whisper > Original captions
    if use_whisper or not os.path.exists(original_vtt_path):
        # Try Whisper transcription first
        if os.path.exists(whisper_vtt_path) and os.path.getsize(whisper_vtt_path) > 0:
            print(f"[CACHE] Using existing Whisper transcript for {video_id}")
            return {
                'video_id': video_id,
                'title': f"Whisper - {video_id}",
                'duration': 0,
                'subtitle_url': f"http://localhost:5000/cached/{video_id}_whisper",
                'format': 'vtt',
                'cached': True,
                'source': 'whisper'
            }
        
        # Generate new Whisper transcript
        print(f"[WHISPER] Creating new transcript for {video_id}")
        
        # Download audio
        audio_path = download_audio(video_id)
        if not audio_path:
            print(f"[WHISPER] Failed to download audio for {video_id}")
            return get_original_transcript(video_id)  # Fallback
        
        # Transcribe with Whisper
        whisper_response = transcribe_audio(audio_path)
        if not whisper_response:
            print(f"[WHISPER] Failed to transcribe audio for {video_id}")
            return get_original_transcript(video_id)  # Fallback
        
        # Convert to VTT format
        vtt_content = format_whisper_to_vtt(whisper_response, video_id)
        if not vtt_content:
            print(f"[WHISPER] Failed to format VTT for {video_id}")
            return get_original_transcript(video_id)  # Fallback
        
        # Save Whisper VTT
        try:
            with open(whisper_vtt_path, 'w', encoding='utf-8') as f:
                f.write(vtt_content)
            print(f"[CACHE] Saved Whisper transcript for {video_id}")
            
            return {
                'video_id': video_id,
                'title': f"Whisper - {video_id}",
                'duration': 0,
                'subtitle_url': f"http://localhost:5000/cached/{video_id}_whisper",
                'format': 'vtt',
                'cached': False,
                'source': 'whisper'
            }
        except Exception as e:
            print(f"[WHISPER] Error saving VTT: {e}")
            return get_original_transcript(video_id)  # Fallback
    
    # Use original transcript method
    return get_original_transcript(video_id)

def get_original_transcript(video_id):
    """Original transcript method using yt-dlp captions"""
    import requests
    transcripts_dir = os.path.join(os.path.dirname(__file__), 'transcripts')
    os.makedirs(transcripts_dir, exist_ok=True)
    vtt_path = os.path.join(transcripts_dir, f"{video_id}.vtt")

    # Check if cached file exists and is valid
    if os.path.exists(vtt_path) and os.path.getsize(vtt_path) > 0:
        print(f"[CACHE] Using existing original transcript for {video_id}")
        cached = True
        title = f"Original - {video_id}"
        duration = 0
    else:
        # Need to download transcript
        print(f"[DOWNLOAD] Fetching original transcript for {video_id}")
        cached = False
        
        try:
            url = f"https://www.youtube.com/watch?v={video_id}"
            ydl_opts = {
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': ['en'],
                'skip_download': True,
                'quiet': True,
                'no_warnings': True
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                subtitles = info.get('subtitles', {})
                auto_captions = info.get('automatic_captions', {})
                captions_data = subtitles.get('en') or auto_captions.get('en')
                
                if not captions_data:
                    return None
                    
                vtt_subtitle = None
                for subtitle in captions_data:
                    if subtitle.get('ext') == 'vtt':
                        vtt_subtitle = subtitle
                        break
                        
                if not vtt_subtitle:
                    return None
                    
                subtitle_url = vtt_subtitle['url']
                title = info.get('title', 'Unknown')
                duration = info.get('duration', 0)
                
                # Download and cache the VTT content
                try:
                    resp = requests.get(subtitle_url, timeout=10)
                    if resp.status_code == 200 and resp.text.strip():
                        with open(vtt_path, 'w', encoding='utf-8') as f:
                            f.write(resp.text)
                        print(f"[CACHE] Saved original transcript for {video_id}")
                    else:
                        print(f"[DOWNLOAD] Failed to download VTT content for {video_id}")
                        return None
                except Exception as e:
                    print(f"[DOWNLOAD] Error downloading VTT: {e}")
                    return None
                    
        except Exception as e:
            print(f"Error extracting original transcript for {video_id}: {e}")
            return None

    # Always return consistent cached URL format
    return {
        'video_id': video_id,
        'title': title,
        'duration': duration,
        'subtitle_url': f"http://localhost:5000/cached/{video_id}",
        'format': 'vtt',
        'cached': cached,
        'source': 'original'
    }

@app.route('/transcript/<video_id>')
def get_video_transcript(video_id):
    """Get transcript for a video ID - directly serve VTT content"""
    try:
        transcripts_dir = os.path.join(os.path.dirname(__file__), 'transcripts')
        
        # Check for use_whisper parameter
        use_whisper = request.args.get('whisper', 'false').lower() == 'true'
        
        # Ensure transcript exists (download if needed)
        transcript_info = get_transcript(video_id, use_whisper=use_whisper)
        if not transcript_info:
            return jsonify({
                'success': False,
                'error': 'No transcript available'
            }), 404
        
        # Determine which file to serve
        if transcript_info.get('source') == 'whisper':
            vtt_path = os.path.join(transcripts_dir, f"{video_id}_whisper.vtt")
            source_type = "Whisper AI"
        else:
            vtt_path = os.path.join(transcripts_dir, f"{video_id}.vtt")
            source_type = "Original"
        
        # Serve the VTT content directly
        if os.path.exists(vtt_path) and os.path.getsize(vtt_path) > 0:
            with open(vtt_path, 'r', encoding='utf-8') as f:
                vtt_content = f.read()
            
            print(f"[DIRECT] Serving {source_type} VTT content for {video_id} ({len(vtt_content)} chars)")
            return vtt_content, 200, {
                'Content-Type': 'text/vtt',
                'Access-Control-Allow-Origin': '*',
                'X-Transcript-Source': source_type
            }
        else:
            return jsonify({
                'success': False,
                'error': 'Transcript file not found'
            }), 404
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/whisper/<video_id>')
def get_whisper_transcript(video_id):
    """Force Whisper transcription for a video ID"""
    return get_video_transcript(video_id + "?whisper=true")

@app.route('/cached/<video_id>')
def serve_cached_transcript(video_id):
    """Serve cached VTT transcript files (supports both original and whisper)"""
    transcripts_dir = os.path.join(os.path.dirname(__file__), 'transcripts')
    
    # Check for Whisper version first if requested
    if video_id.endswith('_whisper'):
        vtt_path = os.path.join(transcripts_dir, f"{video_id}.vtt")
        source_type = "Whisper"
    else:
        vtt_path = os.path.join(transcripts_dir, f"{video_id}.vtt")
        source_type = "Original"
    
    if os.path.exists(vtt_path) and os.path.getsize(vtt_path) > 0:
        try:
            with open(vtt_path, 'r', encoding='utf-8') as f:
                vtt_content = f.read()
            print(f"[CACHE] Serving cached {source_type} VTT for {video_id}")
            return vtt_content, 200, {
                'Content-Type': 'text/vtt',
                'X-Transcript-Source': source_type
            }
        except Exception as e:
            print(f"[CACHE] Error reading cached file: {e}")
            return f"Error reading cached transcript: {e}", 500
    else:
        print(f"[CACHE] Cached file not found or empty for {video_id}")
        return "Cached transcript not found", 404

@app.route('/save-words/<video_id>', methods=['POST'])
def save_word_timestamps(video_id):
    """Save word-level timestamps to JSON file in transcripts directory"""
    try:
        data = request.get_json()
        if not data or 'words' not in data:
            return jsonify({'success': False, 'error': 'Invalid data format'}), 400
        
        transcripts_dir = os.path.join(os.path.dirname(__file__), 'transcripts')
        os.makedirs(transcripts_dir, exist_ok=True)
        
        words_file = os.path.join(transcripts_dir, f"{video_id}_words.json")
        
        # Add metadata
        save_data = {
            'videoId': video_id,
            'timestamp': data.get('timestamp', ''),
            'wordCount': data.get('wordCount', len(data['words'])),
            'source': data.get('source', 'unknown'),
            'words': data['words']
        }
        
        with open(words_file, 'w', encoding='utf-8') as f:
            json.dump(save_data, f, indent=2, ensure_ascii=False)
        
        print(f"[WORDS] Saved {len(data['words'])} word timestamps to {words_file}")
        
        return jsonify({
            'success': True, 
            'message': f'Saved {len(data["words"])} words to {video_id}_words.json',
            'filename': f'{video_id}_words.json'
        })
        
    except Exception as e:
        print(f"[WORDS] Error saving word timestamps: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/words/<video_id>')
def get_word_timestamps(video_id):
    """Retrieve word-level timestamps from JSON file"""
    try:
        transcripts_dir = os.path.join(os.path.dirname(__file__), 'transcripts')
        words_file = os.path.join(transcripts_dir, f"{video_id}_words.json")
        
        if not os.path.exists(words_file):
            return jsonify({'success': False, 'error': 'Word timestamps not found'}), 404
        
        with open(words_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        print(f"[WORDS] Serving {len(data['words'])} word timestamps for {video_id}")
        
        return jsonify({
            'success': True,
            'videoId': video_id,
            'wordCount': len(data['words']),
            'timestamp': data.get('timestamp', ''),
            'source': data.get('source', 'unknown'),
            'words': data['words']
        })
        
    except Exception as e:
        print(f"[WORDS] Error loading word timestamps: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/health')
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    print("🎤 Enhanced YouTube Transcript Server starting...")
    print("📄 Install dependencies: pip install yt-dlp flask flask-cors openai ffmpeg")
    print("🧠 Features: Original captions + Whisper AI word-level timestamps")
    print("🌐 Server will run on http://localhost:5000")
    print("📋 Usage:")
    print("   • Original captions: GET /transcript/{video_id}")
    print("   • Whisper AI: GET /transcript/{video_id}?whisper=true")
    print("   • Force Whisper: GET /whisper/{video_id}")
    print("🔑 Make sure to set your SAMBANOVA_API_KEY in the code")
    
    app.run(host='localhost', port=5000, debug=True)