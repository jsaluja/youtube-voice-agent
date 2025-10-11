#!/usr/bin/env python3
"""
YouTube ReflexAgent Server
Uses yt-dlp for YouTube captions and video search
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import yt_dlp
from urllib.parse import urlparse, parse_qs
import os
import json

app = Flask(__name__)
CORS(app)  # Allow CORS for extension

def extract_video_id(url):
    """Extract video ID from YouTube URL"""
    if 'v=' in url:
        return url.split('v=')[1].split('&')[0]
    elif 'youtu.be/' in url:
        return url.split('youtu.be/')[1].split('?')[0]
    return url  # Assume it's already a video ID


def get_transcript(video_id):
    """Get transcript using yt-dlp captions only"""
    import requests
    transcripts_dir = os.path.join(os.path.dirname(__file__), 'transcripts')
    os.makedirs(transcripts_dir, exist_ok=True)
    
    vtt_path = os.path.join(transcripts_dir, f"{video_id}.vtt")

    # Check if cached file exists and is valid
    if os.path.exists(vtt_path) and os.path.getsize(vtt_path) > 0:
        print(f"[CACHE] Using existing transcript for {video_id}")
        return {
            'video_id': video_id,
            'title': f"Captions - {video_id}",
            'duration': 0,
            'subtitle_url': f"http://127.0.0.1:5000/cached/{video_id}",
            'format': 'vtt',
            'cached': True,
            'source': 'original'
        }
    
    # Download new transcript
    print(f"[DOWNLOAD] Fetching transcript for {video_id}")
    
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
                print(f"[ERROR] No captions available for {video_id}")
                return None
                
            vtt_subtitle = None
            for subtitle in captions_data:
                if subtitle.get('ext') == 'vtt':
                    vtt_subtitle = subtitle
                    break
                    
            if not vtt_subtitle:
                print(f"[ERROR] No VTT captions found for {video_id}")
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
                    print(f"[CACHE] Saved transcript for {video_id}")
                    
                    return {
                        'video_id': video_id,
                        'title': title,
                        'duration': duration,
                        'subtitle_url': f"http://127.0.0.1:5000/cached/{video_id}",
                        'format': 'vtt',
                        'cached': False,
                        'source': 'original'
                    }
                else:
                    print(f"[ERROR] Failed to download VTT content for {video_id}")
                    return None
            except Exception as e:
                print(f"[ERROR] Error downloading VTT: {e}")
                return None
                
    except Exception as e:
        print(f"[ERROR] Error extracting transcript for {video_id}: {e}")
        return None


@app.route('/transcript/<video_id>')
def get_video_transcript(video_id):
    """Get transcript for a video ID - directly serve VTT content"""
    try:
        transcripts_dir = os.path.join(os.path.dirname(__file__), 'transcripts')
        
        # Ensure transcript exists (download if needed)
        transcript_info = get_transcript(video_id)
        if not transcript_info:
            return jsonify({
                'success': False,
                'error': 'No transcript available'
            }), 404
        
        # Serve the VTT file
        vtt_path = os.path.join(transcripts_dir, f"{video_id}.vtt")
        source_type = "Original Captions"
        
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

@app.route('/cached/<video_id>')
def serve_cached_transcript(video_id):
    """Serve cached VTT transcript files"""
    transcripts_dir = os.path.join(os.path.dirname(__file__), 'transcripts')
    vtt_path = os.path.join(transcripts_dir, f"{video_id}.vtt")
    
    if os.path.exists(vtt_path) and os.path.getsize(vtt_path) > 0:
        try:
            with open(vtt_path, 'r', encoding='utf-8') as f:
                vtt_content = f.read()
            print(f"[CACHE] Serving cached VTT for {video_id}")
            return vtt_content, 200, {
                'Content-Type': 'text/vtt',
                'X-Transcript-Source': 'Original Captions'
            }
        except Exception as e:
            print(f"[CACHE] Error reading cached file: {e}")
            return f"Error reading cached transcript: {e}", 500
    else:
        print(f"[CACHE] Cached file not found or empty for {video_id}")
        return "Cached transcript not found", 404


def create_transcript_chunks(transcript_content, chunk_duration=45):
    """Split transcript into timestamped chunks"""
    try:
        if not transcript_content:
            return []
        
        chunks = []
        lines = transcript_content.strip().split('\n')
        
        current_chunk = {
            'start_time': 0,
            'end_time': 0,
            'text': '',
            'word_count': 0
        }
        
        for line in lines:
            line = line.strip()
            if not line or line.startswith('WEBVTT') or line.startswith('Kind:') or line.startswith('Language:'):
                continue
            
            # Parse VTT timestamp lines (e.g., "00:01:30.000 --> 00:01:35.000")
            if '-->' in line:
                try:
                    start_str, end_str = line.split(' --> ')
                    start_time = parse_vtt_timestamp(start_str.strip())
                    end_time = parse_vtt_timestamp(end_str.strip())
                    
                    # If this is the first chunk, set start time
                    if not current_chunk['text']:
                        current_chunk['start_time'] = start_time
                    
                    current_chunk['end_time'] = end_time
                    
                except Exception as e:
                    continue
            
            # Text content lines
            elif line and not line.startswith('<') and current_chunk['start_time'] is not None:
                # Clean up VTT formatting tags
                clean_text = line.replace('<c>', '').replace('</c>', '').replace('<c.colorCCCCCC>', '')
                clean_text = ' '.join(clean_text.split())  # Normalize whitespace
                
                if clean_text:
                    if current_chunk['text']:
                        current_chunk['text'] += ' ' + clean_text
                    else:
                        current_chunk['text'] = clean_text
                    
                    current_chunk['word_count'] = len(current_chunk['text'].split())
                    
                    # Check if chunk should be finalized
                    chunk_length = current_chunk['end_time'] - current_chunk['start_time']
                    
                    if (chunk_length >= chunk_duration or 
                        current_chunk['word_count'] >= 100):  # Max 100 words per chunk
                        
                        if current_chunk['text'].strip():
                            chunks.append({
                                'start_time': current_chunk['start_time'],
                                'end_time': current_chunk['end_time'],
                                'text': current_chunk['text'].strip(),
                                'word_count': current_chunk['word_count'],
                                'duration': chunk_length
                            })
                        
                        # Start new chunk
                        current_chunk = {
                            'start_time': current_chunk['end_time'],
                            'end_time': current_chunk['end_time'],
                            'text': '',
                            'word_count': 0
                        }
        
        # Add final chunk if it has content
        if current_chunk['text'].strip():
            chunks.append({
                'start_time': current_chunk['start_time'],
                'end_time': current_chunk['end_time'],
                'text': current_chunk['text'].strip(),
                'word_count': current_chunk['word_count'],
                'duration': current_chunk['end_time'] - current_chunk['start_time']
            })
        
        print(f"[CHUNKS] Created {len(chunks)} chunks from transcript")
        return chunks
        
    except Exception as e:
        print(f"[CHUNKS] Error creating chunks: {e}")
        return []

def parse_vtt_timestamp(timestamp_str):
    """Parse VTT timestamp format (HH:MM:SS.mmm) to seconds"""
    try:
        # Handle format: "00:01:30.000"
        parts = timestamp_str.split(':')
        if len(parts) == 3:
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds_parts = parts[2].split('.')
            seconds = int(seconds_parts[0])
            milliseconds = int(seconds_parts[1]) if len(seconds_parts) > 1 else 0
            
            total_seconds = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
            return total_seconds
        return 0
    except Exception:
        return 0

def search_youtube_videos(query, max_results=5):
    """Search YouTube for videos using yt-dlp"""
    try:
        search_query = f"ytsearch{max_results}:{query}"
        print(f"[SEARCH] Searching YouTube for: {query}")
        
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,  # Get full info
            'skip_download': True
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            search_results = ydl.extract_info(search_query, download=False)
            
            if not search_results or 'entries' not in search_results:
                return []
            
            videos = []
            for entry in search_results['entries']:
                if entry:  # Skip None entries
                    video_info = {
                        'video_id': entry.get('id', ''),
                        'title': entry.get('title', 'Unknown Title'),
                        'duration': entry.get('duration', 0),
                        'view_count': entry.get('view_count', 0),
                        'channel': entry.get('uploader', 'Unknown Channel'),
                        'upload_date': entry.get('upload_date', ''),
                        'url': f"https://www.youtube.com/watch?v={entry.get('id', '')}"
                    }
                    videos.append(video_info)
            
            print(f"[SEARCH] Found {len(videos)} videos for query: {query}")
            return videos
            
    except Exception as e:
        print(f"[SEARCH] Error searching YouTube: {e}")
        return []

@app.route('/search/<query>')
def search_videos(query):
    """Search YouTube videos by query"""
    try:
        max_results = request.args.get('max_results', 5, type=int)
        max_results = min(max_results, 10)  # Limit to 10 videos max
        
        videos = search_youtube_videos(query, max_results)
        
        if not videos:
            return jsonify({
                'success': False,
                'error': 'No videos found',
                'query': query
            }), 404
        
        return jsonify({
            'success': True,
            'query': query,
            'video_count': len(videos),
            'videos': videos
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'query': query
        }), 500

@app.route('/batch-transcripts', methods=['POST'])
def batch_transcripts():
    """Process transcripts for multiple videos"""
    try:
        data = request.get_json()
        if not data or 'video_ids' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing video_ids in request body'
            }), 400
        
        video_ids = data['video_ids']
        
        if not isinstance(video_ids, list) or len(video_ids) == 0:
            return jsonify({
                'success': False,
                'error': 'video_ids must be a non-empty list'
            }), 400
        
        # Limit batch size
        if len(video_ids) > 10:
            return jsonify({
                'success': False,
                'error': 'Maximum 10 videos per batch'
            }), 400
        
        print(f"[BATCH] Processing {len(video_ids)} videos")
        
        results = {}
        for video_id in video_ids:
            try:
                transcript_info = get_transcript(video_id)
                if transcript_info:
                    results[video_id] = {
                        'success': True,
                        'transcript_info': transcript_info
                    }
                    print(f"[BATCH] ✅ {video_id}: transcript ready")
                else:
                    results[video_id] = {
                        'success': False,
                        'error': 'No transcript available'
                    }
                    print(f"[BATCH] ❌ {video_id}: no transcript")
            except Exception as e:
                results[video_id] = {
                    'success': False,
                    'error': str(e)
                }
                print(f"[BATCH] ❌ {video_id}: error - {e}")
        
        successful_count = sum(1 for r in results.values() if r['success'])
        
        return jsonify({
            'success': True,
            'processed_count': len(video_ids),
            'successful_count': successful_count,
            'results': results
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/health')
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    print("🎤 YouTube ReflexAgent Server starting...")
    print("📄 Install dependencies: pip install yt-dlp flask flask-cors sentence-transformers")
    print("🧠 Features: Video search + Original captions + Chunk ranking")
    print("🌐 Server will run on http://127.0.0.1:5000")
    print("📋 Usage:")
    print("   • Search videos: GET /search/{query}")
    print("   • Batch transcripts: POST /batch-transcripts")
    print("   • Get transcript: GET /transcript/{video_id}")
    print("   • Cached transcripts: GET /cached/{video_id}")
    print("✨ Simplified: Fast captions-only processing")
    
    app.run(host='localhost', port=5000, debug=True)