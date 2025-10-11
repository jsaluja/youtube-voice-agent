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
from sentence_transformers import SentenceTransformer
import numpy as np
import re
from functools import lru_cache

app = Flask(__name__)
CORS(app)  # Allow CORS for extension

# Initialize embedding model
print("🧠 Loading embedding model...")
embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
print("✅ Embedding model loaded!")

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


# Define placeholders to remove from transcript text
PLACEHOLDERS = [
    '[Music]', '[Applause]', '[Laughter]', '[Silence]', 
    '♪', '♫', '♬', '>>', '<<', '<c>', '</c>',
    '<c.colorCCCCCC>', '<c.yellow>', '<c.white>', '<c.cyan>', '<c.magenta>'
]

def extract_word_timestamps_from_webvtt(file_path):
    word_timestamps = []
    prev_text = ""
    with open(file_path, 'r', encoding='utf-8-sig') as file:
        content = file.read()

    # Regex pattern to match caption blocks with timings
    caption_pattern = re.compile(
        r"(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3}).*?\n(.*?)(?=\n\n|\Z)", 
        re.DOTALL
    )

    # Regex pattern to match words and their timestamps within a caption
    word_pattern = re.compile(
        r"([^<>\s]+)<(\d{2}:\d{2}:\d{2}\.\d{3})>|<c>(.*?)</c>(?:<(\d{2}:\d{2}:\d{2}\.\d{3})>)?"
    )

    # Iterate through each caption block
    for match in caption_pattern.finditer(content):
        start_time, end_time, text = match.groups()
        start_seconds = time_to_seconds(start_time)
        end_seconds = time_to_seconds(end_time)
        if '[ਸੰਗੀਤ]\n' == text or '\n[ਸੰਗੀਤ]' == text:
            continue

        if text.strip() and not re.search(r"<\d{2}:\d{2}:\d{2}\.\d{3}>", text) and ' ' not in text.strip():
            if text.startswith(' \n'):
                prev_text = text.lstrip(' \n').strip()
                word_timestamps.append({
                    "text": prev_text,
                    "start": start_seconds,
                    "end": end_seconds
                })
            elif text.endswith('\n ') and text.rstrip('\n ').strip() == prev_text:
                word_timestamps[-1]["end"] = end_seconds 
            elif text.startswith(f'{prev_text}\n'):
                prev_text = text.lstrip(prev_text).lstrip('\n').strip()
                word_timestamps.append({
                    "text": prev_text,
                    "start": start_seconds,
                    "end": end_seconds
                }) 
            else:
                prev_text = text.strip()
                word_timestamps.append({
                    "text": prev_text,
                    "start": start_seconds,
                    "end": end_seconds
                })
            continue

        # Find all words with their timestamps
        words = word_pattern.findall(text)
        previous_end_seconds = start_seconds  # Initialize for the first word

        for i, word_match in enumerate(words):
            if word_match[0]:  # Standalone word followed by a timestamp
                word = word_match[0]
                end_time_word = time_to_seconds(word_match[1])
            elif word_match[2]:  # Word inside <c> tags
                word = word_match[2]
                end_time_word = time_to_seconds(word_match[3]) if word_match[3] else end_seconds
            else:
                continue

            # Append word with start and end timestamps
            word_timestamps.append({
                "text": word.strip(),
                "start": previous_end_seconds,
                "end": end_time_word
            })

            # Update previous_end_seconds for the next word
            previous_end_seconds = end_time_word

    cleaned_entries = []
    for entry in word_timestamps:
        for substring in PLACEHOLDERS:
            entry['text'] = entry['text'].replace(substring, '')
        entry['text'] = entry['text'].strip()
        if entry['text']:
            cleaned_entries.append(entry)

    return cleaned_entries

def extract_word_timestamps_from_content(vtt_content):
    """Extract word timestamps from VTT content string (not file)"""
    word_timestamps = []
    prev_text = ""

    # Regex pattern to match caption blocks with timings
    caption_pattern = re.compile(
        r"(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3}).*?\n(.*?)(?=\n\n|\Z)", 
        re.DOTALL
    )

    # Regex pattern to match words and their timestamps within a caption
    word_pattern = re.compile(
        r"([^<>\s]+)<(\d{2}:\d{2}:\d{2}\.\d{3})>|<c>(.*?)</c>(?:<(\d{2}:\d{2}:\d{2}\.\d{3})>)?"
    )

    # Iterate through each caption block
    for match in caption_pattern.finditer(vtt_content):
        start_time, end_time, text = match.groups()
        start_seconds = time_to_seconds(start_time)
        end_seconds = time_to_seconds(end_time)
        if '[ਸੰਗੀਤ]\n' == text or '\n[ਸੰਗੀਤ]' == text:
            continue

        if text.strip() and not re.search(r"<\d{2}:\d{2}:\d{2}\.\d{3}>", text) and ' ' not in text.strip():
            if text.startswith(' \n'):
                prev_text = text.lstrip(' \n').strip()
                word_timestamps.append({
                    "text": prev_text,
                    "start": start_seconds,
                    "end": end_seconds
                })
            elif text.endswith('\n ') and text.rstrip('\n ').strip() == prev_text:
                word_timestamps[-1]["end"] = end_seconds 
            elif text.startswith(f'{prev_text}\n'):
                prev_text = text.lstrip(prev_text).lstrip('\n').strip()
                word_timestamps.append({
                    "text": prev_text,
                    "start": start_seconds,
                    "end": end_seconds
                }) 
            else:
                prev_text = text.strip()
                word_timestamps.append({
                    "text": prev_text,
                    "start": start_seconds,
                    "end": end_seconds
                })
            continue

        # Find all words with their timestamps
        words = word_pattern.findall(text)
        previous_end_seconds = start_seconds  # Initialize for the first word

        for i, word_match in enumerate(words):
            if word_match[0]:  # Standalone word followed by a timestamp
                word = word_match[0]
                end_time_word = time_to_seconds(word_match[1])
            elif word_match[2]:  # Word inside <c> tags
                word = word_match[2]
                end_time_word = time_to_seconds(word_match[3]) if word_match[3] else end_seconds
            else:
                continue

            # Append word with start and end timestamps
            word_timestamps.append({
                "text": word.strip(),
                "start": previous_end_seconds,
                "end": end_time_word
            })

            # Update previous_end_seconds for the next word
            previous_end_seconds = end_time_word

    cleaned_entries = []
    for entry in word_timestamps:
        for substring in PLACEHOLDERS:
            entry['text'] = entry['text'].replace(substring, '')
        entry['text'] = entry['text'].strip()
        if entry['text']:
            cleaned_entries.append(entry)

    return cleaned_entries

def create_transcript_chunks(transcript_content, chunk_duration=45):
    """Split transcript into timestamped chunks using improved VTT parsing"""
    try:
        if not transcript_content:
            return []
        
        # Use improved VTT parsing to extract clean word timestamps
        word_timestamps = extract_word_timestamps_from_content(transcript_content)
        
        if not word_timestamps:
            print("[CHUNKS] No valid timestamps found in VTT content")
            return []
        
        chunks = []
        current_chunk = {
            'start_time': word_timestamps[0]['start'],
            'end_time': word_timestamps[0]['end'],
            'text': '',
            'word_count': 0
        }
        
        for entry in word_timestamps:
            # Add text to current chunk
            if current_chunk['text']:
                current_chunk['text'] += ' ' + entry['text']
            else:
                current_chunk['text'] = entry['text']
            
            current_chunk['end_time'] = entry['end']
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
                    'start_time': entry['end'],
                    'end_time': entry['end'],
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
        
        print(f"[CHUNKS] Created {len(chunks)} chunks from {len(word_timestamps)} word timestamps")
        return chunks
        
    except Exception as e:
        print(f"[CHUNKS] Error creating chunks: {e}")
        return []

@lru_cache(maxsize=128)
def time_to_seconds(time_str):
    """Convert VTT timestamp to seconds with caching"""
    h, m, s = map(float, time_str.replace(',', '.').split(':'))
    return round(h * 3600 + m * 60 + s, 2)

def embed_text(text):
    """Generate embedding for text using the loaded model"""
    try:
        embedding = embedding_model.encode(text)
        return embedding
    except Exception as e:
        print(f"[EMBED] Error generating embedding: {e}")
        return None

def calculate_similarity(query_embedding, chunk_embeddings):
    """Calculate cosine similarity between query and chunks"""
    try:
        # Normalize embeddings
        query_norm = query_embedding / np.linalg.norm(query_embedding)
        chunk_norms = chunk_embeddings / np.linalg.norm(chunk_embeddings, axis=1, keepdims=True)
        
        # Calculate cosine similarity
        similarities = np.dot(chunk_norms, query_norm)
        return similarities
    except Exception as e:
        print(f"[SIMILARITY] Error calculating similarity: {e}")
        return np.array([])

def rank_chunks_by_relevance(query, chunks):
    """Rank transcript chunks by relevance to query"""
    try:
        if not chunks or not query:
            return []
        
        print(f"[RANK] Ranking {len(chunks)} chunks for query: '{query}'")
        
        # Generate query embedding
        query_embedding = embed_text(query)
        if query_embedding is None:
            return chunks  # Return unranked if embedding fails
        
        # Generate embeddings for all chunks
        chunk_texts = [chunk['text'] for chunk in chunks]
        chunk_embeddings = embedding_model.encode(chunk_texts)
        
        # Calculate similarities
        similarities = calculate_similarity(query_embedding, chunk_embeddings)
        
        # Add similarity scores to chunks and sort
        ranked_chunks = []
        for i, chunk in enumerate(chunks):
            chunk_with_score = chunk.copy()
            chunk_with_score['relevance_score'] = float(similarities[i]) if i < len(similarities) else 0.0
            ranked_chunks.append(chunk_with_score)
        
        # Sort by relevance score (highest first)
        ranked_chunks.sort(key=lambda x: x['relevance_score'], reverse=True)
        
        print(f"[RANK] Top chunk score: {ranked_chunks[0]['relevance_score']:.3f}")
        return ranked_chunks
        
    except Exception as e:
        print(f"[RANK] Error ranking chunks: {e}")
        return chunks  # Return unranked if error

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

@app.route('/rank-chunks', methods=['POST'])
def rank_chunks():
    """Rank transcript chunks by relevance to query"""
    try:
        data = request.get_json()
        if not data or 'query' not in data or 'video_id' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing query or video_id in request body'
            }), 400
        
        query = data['query']
        video_id = data['video_id']
        
        print(f"[RANK] Processing query: '{query}' for video: {video_id}")
        
        # Get transcript content
        transcript_response = get_video_transcript(video_id)
        if isinstance(transcript_response, tuple) and transcript_response[1] != 200:
            return jsonify({
                'success': False,
                'error': 'Could not get transcript for video'
            }), 404
        
        # Extract VTT content
        vtt_content = transcript_response[0] if isinstance(transcript_response, tuple) else transcript_response
        
        # Create chunks from transcript
        chunks = create_transcript_chunks(vtt_content, chunk_duration=45)
        if not chunks:
            return jsonify({
                'success': False,
                'error': 'Could not create chunks from transcript'
            }), 500
        
        # Rank chunks by relevance
        ranked_chunks = rank_chunks_by_relevance(query, chunks)
        
        # Return top chunks (limit to 10 for performance)
        top_chunks = ranked_chunks[:10]
        
        return jsonify({
            'success': True,
            'query': query,
            'video_id': video_id,
            'total_chunks': len(chunks),
            'returned_chunks': len(top_chunks),
            'chunks': top_chunks
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
    print("   • Rank chunks: POST /rank-chunks")
    print("   • Cached transcripts: GET /cached/{video_id}")
    print("✨ Embedding-based chunk ranking enabled!")
    
    app.run(host='127.0.0.1', port=5000, debug=True)