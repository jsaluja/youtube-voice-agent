# Omi YouTube Voice Agent

A simple MCP server for Omi that enables voice control of YouTube videos.

## Features

- 🎵 **Voice Controls**: Play, pause, mute, speed control
- 🔍 **Video Search**: Search YouTube videos by voice
- 📝 **Transcript Search**: Find keywords within video transcripts
- ⏱️ **Time Navigation**: Jump to specific timestamps

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **No API Key Needed!**
   - Uses yt-dlp for YouTube search (no authentication required)
   - Just install yt-dlp: `pip install yt-dlp` or `brew install yt-dlp`

3. **Install yt-dlp (for transcripts):**
   ```bash
   pip install yt-dlp  # or brew install yt-dlp
   ```

4. **Build and run:**
   ```bash
   npm run build
   npm start
   ```

## Voice Commands

### Basic Controls
- "play" - Play current video
- "pause" - Pause current video
- "mute" / "unmute" - Audio control
- "faster" / "slower" - Speed control
- "skip 10" / "back 10" - Skip forward/backward

### Search
- "search for machine learning" - Search YouTube videos
- "play number 1" - Play first search result

### Transcript Search
- "find neural networks in this video" - Search within transcript
- "jump to 120 seconds" - Jump to specific time

## Architecture

This is a standalone MCP server that:
- Uses yt-dlp for YouTube search (no API keys needed!)
- Uses yt-dlp for transcript extraction
- Provides JavaScript commands for browser injection
- No complex ML or databases - pure command-line tools

## For Hackathon

This implementation is designed for a 12-hour solo hackathon:
- ✅ Simple, focused functionality
- ✅ No complex dependencies
- ✅ Easy to understand and modify
- ✅ Works with basic Omi integration

## Limitations

- Requires manual JavaScript injection for controls (would need browser extension in production)
- Transcript search is basic text matching (no semantic search)
- No user preferences or learning
- Limited error handling

## Next Steps

For production:
- Add browser extension for automatic JavaScript injection
- Implement semantic search for transcripts
- Add user preferences and history
- Better error handling and retry logic