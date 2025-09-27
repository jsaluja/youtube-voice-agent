/**
 * YouTube Voice Control - Stable Web Speech API Version
 * Uses browser's built-in speech recognition with better error handling
 */

class YouTubeVoiceControl {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.isActive = false;
    this.overlay = null;
    this.restartTimeout = null;
    
    // Wake Word System
    this.wakeWordDetected = false;
    this.wakeWordTimeout = null;
    this.wakeWordWindow = 4000; // 4 seconds to say command after wake word
    
    // Audio ducking for better voice separation
    this.originalVolume = 1.0;
    this.duckingVolume = 0.05;  // Very low volume during command window
    this.isDucking = false;
    
    // Voice Activity Detection (for wake word detection)
    this.audioContext = null;
    this.microphone = null;
    this.analyser = null;
    this.voiceThreshold = 60;  // Higher threshold for more selective detection
    this.isUserSpeaking = false;
    this.voiceDetectionActive = false;
    
    // Transcript System
    this.transcript = null;
    this.transcriptCache = new Map(); // Cache transcripts by video ID
    this.currentVideoId = null;
    
    // Speaker Enrollment System
    this.enrollmentMode = false;
    this.voiceprint = null;
    this.enrollmentSamples = [];
    this.enrollmentPhraseMatched = false;
    this.enrollmentPhrases = [
      // Core playback commands
      "YouTube pause",
      "YouTube play",
      "YouTube stop", 
      "YouTube resume",
      
      // Audio commands
      "YouTube mute",
      "YouTube unmute",
      
      // Navigation commands
      "YouTube skip",
      "YouTube back",
      "YouTube forward",
      "YouTube restart",
      
      // Speed commands
      "YouTube faster",
      "YouTube slower",
      
      // Volume commands
      "YouTube louder",
      "YouTube quieter",
      
      // Timestamp commands (examples)
      "YouTube go to 30 seconds",
      "YouTube jump to 2 minutes",
      "YouTube seek 1 hour",
      
      // Transcript search commands
      "YouTube find introduction",
      "YouTube search tutorial"
    ];
    this.currentEnrollmentPhrase = 0;
    this.samplesPerPhrase = 1; // Reduced since we have more phrases
    this.currentSampleCount = 0;
    
    this.init();
  }
  
  init() {
    console.log("🎤 YouTube Voice Control - Initializing...");
    
    // Listen for messages from side panel
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log("🎤 Content script received message:", message);
      
      if (message.type === 'startListening') {
        console.log("🎤 Start listening command received");
        if (!this.isActive) {
          this.startListening();
        }
        sendResponse({ success: true });
      } else if (message.type === 'stopListening') {
        console.log("🎤 Stop listening command received");
        this.stopListening();
        sendResponse({ success: true });
      } else if (message.type === 'startTraining') {
        this.startSpeakerEnrollment();
        sendResponse({ success: true });
      } else if (message.type === 'stopTraining') {
        this.cancelTraining();
        sendResponse({ success: true });
      } else if (message.type === 'jumpToTimestamp') {
        const video = document.querySelector('video');
        if (video && message.timestamp !== undefined) {
          video.currentTime = message.timestamp;
          const formattedTime = this.formatTime(message.timestamp);
          this.showOverlay("success", `🔍 Jumped to ${formattedTime}`);
          console.log(`🔍 Jumped to timestamp: ${message.timestamp}s (${formattedTime})`);
          sendResponse({ success: true });
        } else {
          console.error("No video found or invalid timestamp");
          sendResponse({ success: false, error: "No video found" });
        }
      } else if (message.type === 'searchTranscript') {
        console.log("🔍 Search transcript request:", message.query);
        
        if (!this.transcript || this.transcript.length === 0) {
          sendResponse({ 
            success: false, 
            error: "No transcript available for this video" 
          });
          return;
        }
        
        this.searchTranscript(message.query).then(searchResults => {
          if (searchResults && searchResults.allMatches && searchResults.allMatches.length > 0) {
            sendResponse({
              success: true,
              results: searchResults.allMatches
            });
          } else {
            sendResponse({
              success: true,
              results: []
            });
          }
        }).catch(error => {
          console.error("Search failed:", error);
          sendResponse({ success: false, error: error.message });
        });
        return true; // Keep message channel open for async response
      }
    });
    
    // Check if Web Speech API is supported
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.log("❌ Speech Recognition not supported");
      this.showOverlay("error", "Speech Recognition not supported");
      return;
    }
    
    console.log("✅ Speech Recognition supported");
    this.createOverlay();
    this.showOverlay("idle", "🎤 Initializing...");
    
    // Load existing voiceprint
    const hasVoiceprint = this.loadVoiceprint();
    
    this.setupVoiceDetection();
    this.setupSpeechRecognition();
    this.setupKeyboardShortcuts();
    
    // Show enrollment hint if no voiceprint
    if (!hasVoiceprint) {
      this.showOverlay("idle", "🎤 Click 'Train Voice' button to get started");
      setTimeout(() => {
        this.showOverlay("idle", "🎤 Training required for voice control");
      }, 3000);
    } else {
      this.showOverlay("idle", "🎤 Voice trained - Say 'YouTube' to start");
    }
    
    // Auto-start wake word detection
    setTimeout(() => this.startInitialListening(), 500);
    
    // Extract transcript for current video (non-blocking)
    setTimeout(() => {
      try {
        this.extractTranscript();
      } catch (error) {
        console.error("📄 Transcript extraction failed:", error);
      }
    }, 2000); // Increased delay to let YouTube fully load
    
    // Watch for video changes (non-blocking)
    try {
      this.watchForVideoChanges();
    } catch (error) {
      console.error("📄 Video change watching failed:", error);
    }
  }
  
  setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    
    // Configuration for stability
    this.recognition.continuous = false;         // Don't keep continuous (causes aborts)
    this.recognition.interimResults = false;     // Only final results
    this.recognition.lang = 'en-US';            // English
    this.recognition.maxAlternatives = 1;       // Single best result
    
    // Event handlers
    this.recognition.onstart = () => {
      this.isListening = true;
      if (this.wakeWordDetected) {
        this.duckAudio(true);  // Lower video volume during command window
        this.showOverlay("listening", "🎤 Command window - Say your command...");
      } else {
        this.showOverlay("listening", "🎤 Listening for 'YouTube'...");
      }
    };
    
    this.recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.trim().toLowerCase();
      console.log(`🎤 Heard: "${transcript}"`);
      console.log(`🎤 Wake word detected: ${this.wakeWordDetected}`);
      console.log(`🎤 Enrollment mode: ${this.enrollmentMode}`);
      
      // Skip processing if in enrollment mode
      if (this.enrollmentMode) {
        console.log(`🎤 Skipping - in enrollment mode`);
        return;
      }
      
      if (!this.wakeWordDetected) {
        // Check for wake word
        console.log(`🎤 Processing wake word for: "${transcript}"`);
        this.processWakeWord(transcript);
      } else {
        // Process command in wake word window
        console.log(`🎤 Processing command: "${transcript}"`);
        this.duckAudio(false);  // Restore volume after command
        this.processCommand(transcript);
      }
    };
    
    this.recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') {
        // Ignore these common errors
        return;
      }
      
      // Only show significant errors
      if (event.error === 'not-allowed') {
        this.showOverlay("error", "Microphone access denied");
        return;
      }
    };
    
    this.recognition.onend = () => {
      this.isListening = false;
      this.duckAudio(false);  // Always restore volume when done
      
      // Auto-restart after a brief pause
      if (this.isActive) {
        this.restartTimeout = setTimeout(() => {
          this.startListening();
        }, 300);
      }
    };
  }
  
  startListening() {
    if (this.isListening || !this.recognition) return;
    
    try {
      this.isActive = true;
      this.recognition.start();
      this.updateOverlayStatus();
    } catch (error) {
      // Ignore start errors, try again later
      if (this.isActive) {
        setTimeout(() => this.startListening(), 1000);
      }
    }
  }
  
  startInitialListening() {
    // Only start if voice detection setup is complete
    if (this.analyser) {
      this.startVoiceDetection();
      this.showOverlay("idle", "🎤 Ready - Say 'YouTube' to start");
    } else {
      setTimeout(() => this.startInitialListening(), 500);
    }
  }
  
  stopListening() {
    this.isActive = false;
    this.resetWakeWord(); // Clear wake word state
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
    this.showOverlay("idle", "Voice control stopped");
    this.updateOverlayStatus();
  }
  
  toggleListening() {
    if (this.isActive) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }
  
  processWakeWord(transcript) {
    // Detect wake word "YouTube"
    if (transcript.includes('youtube')) {
      console.log("🎯 Wake word 'YouTube' detected!");
      
      // Multi-layer speaker verification if voiceprint exists
      if (this.voiceprint) {
        const currentFeatures = this.captureVoiceFeatures(transcript, false);
        const verification = this.multiLayerVerification(currentFeatures, 'wake_word');
        
        if (!verification.isVerified) {
          console.log(`🚫 Multi-layer verification failed (confidence: ${(verification.confidence * 100).toFixed(1)}%)`);
          console.log(`🚫 Layers passed: ${verification.passedLayers}/${verification.totalLayers}`);
          this.showOverlay("error", "🚫 Voice verification failed");
          return;
        }
        
        console.log(`✅ Multi-layer verification passed (confidence: ${(verification.confidence * 100).toFixed(1)}%)`);
        console.log(`✅ Layers passed: ${verification.passedLayers}/${verification.totalLayers}`);
      }
      
      this.wakeWordDetected = true;
      
      // Check if command is in the same phrase (e.g., "YouTube pause")
      const commandPart = transcript.replace('youtube', '').trim();
      if (commandPart) {
        console.log(`🎯 Command in same phrase: "${commandPart}"`);
        // Process command immediately
        console.log("🔊 📢 Same-phrase command detected - calling duckAudio(true)");
        this.duckAudio(true);
        this.processCommand(commandPart);
        return;
      }
      
      // No immediate command, start command window
      console.log("🔊 📢 Wake word detected - calling duckAudio(true)");
      this.duckAudio(true);
      this.showOverlay("processing", "🎯 Verified - Say command...");
      
      // Set timeout for command window
      this.wakeWordTimeout = setTimeout(() => {
        this.resetWakeWord();
      }, this.wakeWordWindow);
      
      return;
    }
    
    // No wake word detected
    this.showOverlay("idle", "🎤 Say 'YouTube' first...");
  }
  
  processCommand(transcript) {
    if (!this.wakeWordDetected) {
      return; // Should not happen, but safety check
    }
    
    // Multi-layer verification for commands if voiceprint exists
    if (this.voiceprint) {
      const currentFeatures = this.captureVoiceFeatures(transcript, false);
      const verification = this.multiLayerVerification(currentFeatures, 'command');
      
      if (!verification.isVerified) {
        console.log(`🚫 Command verification failed (confidence: ${(verification.confidence * 100).toFixed(1)}%)`);
        console.log(`🚫 Layers passed: ${verification.passedLayers}/${verification.totalLayers}`);
        this.showOverlay("error", "🚫 Command verification failed");
        this.resetWakeWord();
        return;
      }
      
      console.log(`✅ Command verification passed (confidence: ${(verification.confidence * 100).toFixed(1)}%)`);
    }
    
    const commands = this.extractCommands(transcript);
    
    if (commands.length === 0) {
      this.showOverlay("error", "❌ Command not recognized");
      this.resetWakeWord();
      return;
    }
    
    const command = commands[0];
    this.executeCommand(command);
    this.resetWakeWord();
  }
  
  resetWakeWord() {
    this.wakeWordDetected = false;
    this.duckAudio(false); // Restore volume
    if (this.wakeWordTimeout) {
      clearTimeout(this.wakeWordTimeout);
      this.wakeWordTimeout = null;
    }
    this.showOverlay("idle", "🎤 Ready - Say 'YouTube' to start");
  }
  
  extractCommands(text) {
    const commands = [];
    const lowText = text.toLowerCase();
    
    // Check for timestamp commands first (go to specific time)
    const timestampCommand = this.parseTimestampCommand(lowText);
    if (timestampCommand) {
      commands.push(timestampCommand);
      return commands; // Return early for timestamp commands
    }

    // Check for transcript search commands (find/search specific content)
    const searchCommand = this.parseSearchCommand(lowText);
    if (searchCommand) {
      commands.push(searchCommand);
      return commands; // Return early for search commands
    }
    
    // Regular command extraction (after wake word detected)
    if (lowText.includes('pause') || lowText.includes('stop')) {
      commands.push('pause');
    }
    else if (lowText.includes('play') || lowText.includes('resume') || lowText.includes('start')) {
      commands.push('play');
    }
    else if (lowText.includes('mute') && !lowText.includes('unmute')) {
      commands.push('mute');
    }
    else if (lowText.includes('unmute')) {
      commands.push('unmute');
    }
    else if (lowText.includes('skip') || lowText.includes('forward')) {
      commands.push('skip');
    }
    else if (lowText.includes('back') || lowText.includes('rewind')) {
      commands.push('back');
    }
    else if (lowText.includes('faster') || lowText.includes('speed up')) {
      commands.push('faster');
    }
    else if (lowText.includes('slower') || lowText.includes('slow down')) {
      commands.push('slower');
    }
    else if (lowText.includes('fullscreen')) {
      commands.push('fullscreen');
    }
    else if (lowText.includes('restart') || lowText.includes('beginning')) {
      commands.push('restart');
    }
    else if (lowText.includes('louder') || lowText.includes('increase volume') || lowText.includes('volume up')) {
      commands.push('louder');
    }
    else if (lowText.includes('quieter') || lowText.includes('reduce volume') || lowText.includes('decrease volume') || lowText.includes('volume down')) {
      commands.push('quieter');
    }
    
    return commands;
  }
  
  parseTimestampCommand(text) {
    // Simple patterns: "go to", "seek", "jump to", "move to", "play at"
    const patterns = [
      /(?:go to|seek|jump to|move to|play at)\s+(.+)/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const seconds = this.parseTimeToSeconds(match[1]);
        if (seconds !== null) {
          return {
            type: 'timestamp',
            seconds: seconds,
            originalText: match[1]
          };
        }
      }
    }
    
    return null;
  }
  
  parseTimeToSeconds(timeText) {
    const text = timeText.toLowerCase().trim();
    console.log(`🕐 Parsing time: "${text}"`);
    
    let totalSeconds = 0;
    
    // Parse hours
    const hourMatch = text.match(/(\d+)\s*(?:hour|hr)s?/);
    if (hourMatch) {
      totalSeconds += parseInt(hourMatch[1]) * 3600;
    }
    
    // Parse minutes  
    const minuteMatch = text.match(/(\d+)\s*(?:minute|min)s?/);
    if (minuteMatch) {
      totalSeconds += parseInt(minuteMatch[1]) * 60;
    }
    
    // Parse seconds
    const secondMatch = text.match(/(\d+)\s*(?:second|sec)s?/);
    if (secondMatch) {
      totalSeconds += parseInt(secondMatch[1]);
    }
    
    // If no units found, treat standalone number as seconds
    if (totalSeconds === 0) {
      const numberMatch = text.match(/(\d+)/);
      if (numberMatch) {
        totalSeconds = parseInt(numberMatch[1]);
      }
    }
    
    console.log(`🕐 Final parsed time: ${totalSeconds} seconds`);
    return totalSeconds > 0 ? totalSeconds : null;
  }
  
  executeTimestampCommand(command, video) {
    console.log(`🕐 Executing timestamp command: ${command.seconds} seconds`);
    
    const targetTime = command.seconds;
    const videoDuration = video.duration;
    
    // Validate timestamp is within video duration
    if (targetTime > videoDuration) {
      const maxTime = this.formatTime(videoDuration);
      this.showOverlay("error", `⏰ Time beyond video (max: ${maxTime})`);
      return;
    }
    
    // Set video to target time
    video.currentTime = targetTime;
    
    // Show success message with formatted time
    const formattedTime = this.formatTime(targetTime);
    this.showOverlay("success", `⏰ Jumped to ${formattedTime}`);
    
    console.log(`🕐 Successfully jumped to ${formattedTime} (${targetTime}s)`);
  }

  async executeSearchCommand(command, video) {
    console.log(`🔍 Executing search command: "${command.query}"`);
    
    // Check if we have transcript available
    if (!this.transcript || this.transcript.length === 0) {
      this.showOverlay("processing", "📄 Loading transcript...");
      console.log("📄 No transcript loaded - extracting now...");
      
      // Try to extract transcript and search again
      this.extractTranscript().then(() => {
        if (this.transcript && this.transcript.length > 0) {
          console.log("📄 Transcript loaded - retrying search");
          // Retry search after transcript loads
          setTimeout(() => this.executeSearchCommand(command, video), 500);
        } else {
          this.showOverlay("error", "📄 No captions available for this video");
          console.log("📄 This video does not have accessible captions");
        }
      }).catch(error => {
        this.showOverlay("error", "📄 Caption loading failed");
        console.error("📄 Transcript extraction failed:", error);
      });
      return;
    }
    
    // Search transcript for the query
    const result = await this.searchTranscript(command.query);
    
    if (result) {
      console.log(`🔍 Voice search found ${result.allMatches ? result.allMatches.length : 1} results - showing in side panel`);
      
      // Send search results directly to side panel (assume it's already open)
      console.log(`🔍 Sending message for query: "${command.query}" with ${result.allMatches ? result.allMatches.length : 1} results`);
      
      chrome.runtime.sendMessage({
        type: 'showSearchResults',
        data: {
          query: command.query,
          results: result.allMatches || [result]
        }
      }, (response) => {
        console.log(`🔍 Message response:`, response, `Error:`, chrome.runtime.lastError);
        
        if (chrome.runtime.lastError) {
          console.log("Failed to send search results:", chrome.runtime.lastError?.message);
          // Fallback: jump directly if message fails
          const targetTime = result.start || result.timestamp;
          if (targetTime <= video.duration) {
            video.currentTime = targetTime;
            const formattedTime = this.formatTime(targetTime);
            this.showOverlay("success", `🔍 Found: "${command.query}" at ${formattedTime}`);
          }
        } else {
          console.log(`🔍 SUCCESS: Voice search results sent to side panel for "${command.query}"`);
          // Show success overlay
          const resultCount = result.allMatches ? result.allMatches.length : 1;
          this.showOverlay("success", `🔍 Found ${resultCount} results for "${command.query}"`);
        }
      });
      
    } else {
      // Not found - provide helpful feedback
      const words = command.query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      let errorMessage = `🔍 "${command.query}" not found`;
      
      if (words.length > 1) {
        errorMessage += ` (try individual words)`;
      }
      
      this.showOverlay("error", errorMessage);
      console.log(`🔍 Search term "${command.query}" not found in transcript`);
    }
  }
  
  formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  }

  parseSearchCommand(text) {
    console.log(`🔍 Parsing search command: "${text}"`);
    
    // Match patterns like "find introduction", "search tutorial", "look for machine learning"
    const searchPatterns = [
      /(?:find|search|look for|go to|jump to)\s+(.+)/i,
      /where is (.+)/i,
      /show me (.+)/i
    ];
    
    for (const pattern of searchPatterns) {
      const match = text.match(pattern);
      if (match) {
        const searchTerm = match[1].trim();
        console.log(`🔍 Extracted search term: "${searchTerm}"`);
        return {
          type: 'search',
          query: searchTerm,
          originalText: text
        };
      }
    }
    
    return null;
  }
  
  async executeCommand(command) {
    const video = document.querySelector('video');
    if (!video) {
      this.showOverlay("error", "No video found");
      return;
    }
    
    try {
      // Handle timestamp commands
      if (typeof command === 'object' && command.type === 'timestamp') {
        this.executeTimestampCommand(command, video);
        return;
      }

      // Handle search commands
      if (typeof command === 'object' && command.type === 'search') {
        await this.executeSearchCommand(command, video);
        return;
      }
      
      // Handle regular string commands
      this.showOverlay("processing", `${command}`);
      
      switch (command) {
        case 'pause':
          video.pause();
          this.showOverlay("success", "⏸️ Paused");
          break;
          
        case 'play':
          video.play();
          this.showOverlay("success", "▶️ Playing");
          break;
          
        case 'mute':
          video.muted = true;
          this.showOverlay("success", "🔇 Muted");
          break;
          
        case 'unmute':
          video.muted = false;
          this.showOverlay("success", "🔊 Unmuted");
          break;
          
        case 'skip':
          video.currentTime = Math.min(video.currentTime + 10, video.duration);
          this.showOverlay("success", "⏭️ +10s");
          break;
          
        case 'back':
          video.currentTime = Math.max(video.currentTime - 10, 0);
          this.showOverlay("success", "⏮️ -10s");
          break;
          
        case 'faster':
          video.playbackRate = Math.min(video.playbackRate + 0.25, 3);
          this.showOverlay("success", `⚡ ${video.playbackRate.toFixed(2)}x`);
          break;
          
        case 'slower':
          video.playbackRate = Math.max(video.playbackRate - 0.25, 0.25);
          this.showOverlay("success", `🐌 ${video.playbackRate.toFixed(2)}x`);
          break;
          
        case 'fullscreen':
          if (video.requestFullscreen) {
            video.requestFullscreen();
          } else if (video.webkitRequestFullscreen) {
            video.webkitRequestFullscreen();
          }
          this.showOverlay("success", "🖥️ Fullscreen");
          break;
          
        case 'restart':
          video.currentTime = 0;
          this.showOverlay("success", "🔄 Restarted");
          break;
          
        case 'louder':
          const oldVolumeLouder = video.volume;
          video.volume = Math.min(video.volume + 0.25, 1.0);
          const louderPercent = Math.round(video.volume * 100);
          console.log(`🔊 Volume changed: ${Math.round(oldVolumeLouder * 100)}% → ${louderPercent}%`);
          this.showOverlay("success", `🔊 Volume ${louderPercent}%`);
          break;
          
        case 'quieter':
          const oldVolumeQuieter = video.volume;
          video.volume = Math.max(video.volume - 0.25, 0.0);
          const quieterPercent = Math.round(video.volume * 100);
          console.log(`🔉 Volume changed: ${Math.round(oldVolumeQuieter * 100)}% → ${quieterPercent}%`);
          this.showOverlay("success", `🔉 Volume ${quieterPercent}%`);
          break;
      }
      
      // Return to listening state
      setTimeout(() => {
        if (this.isActive) {
          this.showOverlay("listening", "🎤 Listening...");
        }
      }, 1500);
      
    } catch (error) {
      this.showOverlay("error", "Command failed");
    }
  }
  
  createOverlay() {
    console.log("🎨 Creating combined overlay...");
    this.overlay = document.createElement('div');
    this.overlay.id = 'youtube-voice-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      overflow: hidden;
      pointer-events: auto;
      min-width: 200px;
      transition: all 0.2s ease;
    `;
    
    // Combined overlay content
    this.overlay.innerHTML = `
      <div id="voice-status-bar" style="
        padding: 8px 12px;
        background: #f5f5f5;
        border-bottom: 1px solid #ddd;
        font-weight: 600;
        color: #333;
        text-align: center;
        font-size: 13px;
      ">
        🎤 Initializing...
      </div>
      <div style="padding: 8px;">
        <button id="voice-toggle-btn" style="
          width: 100%;
          padding: 6px 10px;
          margin-bottom: 6px;
          background: #34a853;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          font-weight: 500;
        ">
          � Start Listening
        </button>
        <button id="voice-enrollment-btn" style="
          width: 100%;
          padding: 6px 10px;
          margin-bottom: 6px;
          background: #1a73e8;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          font-weight: 500;
        ">
          � Train Voice
        </button>

      </div>
    `;
    
    document.body.appendChild(this.overlay);
    
    // Add event listeners
    this.setupOverlayEvents();
    
    console.log("✅ Combined overlay created");
  }
  
  setupOverlayEvents() {
    // Train Voice button
    const enrollBtn = document.getElementById('voice-enrollment-btn');
    if (enrollBtn) {
      enrollBtn.addEventListener('click', () => {
        console.log("🎯 Enrollment button clicked");
        this.startSpeakerEnrollment();
      });
    }
    
    // Toggle Listening button
    const toggleBtn = document.getElementById('voice-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        console.log("� Toggle button clicked");
        this.toggleListening();
        this.updateOverlayStatus();
      });
    }
    
    // Update status initially
    setTimeout(() => this.updateOverlayStatus(), 1000);
  }
  
  createTrainingPanel() {
    console.log("🎨 Creating improved training panel...");
    
    // Remove existing training panel if it exists
    const existingPanel = document.getElementById('youtube-voice-training-panel');
    if (existingPanel) {
      existingPanel.remove();
    }
    
    this.trainingPanel = document.createElement('div');
    this.trainingPanel.id = 'youtube-voice-training-panel';
    this.trainingPanel.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      z-index: 10001;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: white;
      overflow: hidden;
      pointer-events: auto;
      width: 350px;
      transition: all 0.3s ease;
      backdrop-filter: blur(10px);
    `;
    
    this.trainingPanel.innerHTML = `
      <div style="
        padding: 20px;
        background: rgba(255,255,255,0.1);
        border-bottom: 1px solid rgba(255,255,255,0.2);
      ">
        <div style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 15px;
        ">
          <h3 style="margin: 0; font-size: 18px; font-weight: 600;">
            🎤 Voice Training
          </h3>
          <button id="training-close-btn" style="
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
          ">×</button>
        </div>
        
        <!-- Phrase Progress -->
        <div style="margin-bottom: 15px;">
          <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          ">
            <span style="font-size: 14px; font-weight: 500;">Progress</span>
            <span id="phrase-counter" style="font-size: 14px; font-weight: 600;">1 / 30</span>
          </div>
          <div style="
            background: rgba(255,255,255,0.2);
            height: 8px;
            border-radius: 4px;
            overflow: hidden;
          ">
            <div id="phrase-progress-bar" style="
              background: linear-gradient(90deg, #4CAF50, #8BC34A);
              height: 100%;
              width: 3.3%;
              transition: width 0.4s ease;
              border-radius: 4px;
            "></div>
          </div>
        </div>
        
        <!-- Countdown Timer -->
        <div style="margin-bottom: 15px;">
          <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          ">
            <span style="font-size: 14px; font-weight: 500;">Time Remaining</span>
            <span id="countdown-time" style="font-size: 14px; font-weight: 600;">5s</span>
          </div>
          <div style="
            background: rgba(255,255,255,0.2);
            height: 8px;
            border-radius: 4px;
            overflow: hidden;
          ">
            <div id="countdown-progress-bar" style="
              background: linear-gradient(90deg, #FF9800, #FF5722);
              height: 100%;
              width: 100%;
              transition: width 0.1s linear;
              border-radius: 4px;
            "></div>
          </div>
        </div>
      </div>
      
      <div style="padding: 20px;">
        <!-- Current Phrase -->
        <div style="
          background: rgba(255,255,255,0.1);
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 15px;
          text-align: center;
        ">
          <div style="font-size: 12px; opacity: 0.8; margin-bottom: 5px;">SAY EXACTLY:</div>
          <div id="current-phrase" style="
            font-size: 16px;
            font-weight: 600;
            line-height: 1.3;
          ">"YouTube play"</div>
        </div>
        
        <!-- Status -->
        <div id="training-status" style="
          text-align: center;
          font-size: 14px;
          font-weight: 500;
          padding: 10px;
          background: rgba(255,255,255,0.1);
          border-radius: 6px;
        ">
          🔴 Recording... Speak now!
        </div>
      </div>
    `;
    
    document.body.appendChild(this.trainingPanel);
    
    // Add close button handler
    const closeBtn = document.getElementById('training-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.cancelTraining();
      });
    }
  }
  
  updateTrainingPanel(phraseIndex, totalPhrases, phrase, status, timeLeft = null) {
    if (!this.trainingPanel) return;
    
    // Update phrase counter
    const counter = document.getElementById('phrase-counter');
    if (counter) {
      counter.textContent = `${phraseIndex + 1} / ${totalPhrases}`;
    }
    
    // Update phrase progress bar
    const progressBar = document.getElementById('phrase-progress-bar');
    if (progressBar) {
      const percentage = ((phraseIndex) / totalPhrases) * 100;
      progressBar.style.width = `${Math.max(percentage, 3.6)}%`;
    }
    
    // Update current phrase
    const currentPhrase = document.getElementById('current-phrase');
    if (currentPhrase) {
      currentPhrase.textContent = `"${phrase}"`;
    }
    
    // Update status
    const statusElement = document.getElementById('training-status');
    if (statusElement) {
      statusElement.innerHTML = status;
    }
    
    // Update countdown
    if (timeLeft !== null) {
      const countdownTime = document.getElementById('countdown-time');
      const countdownBar = document.getElementById('countdown-progress-bar');
      
      if (countdownTime) {
        countdownTime.textContent = `${timeLeft}s`;
      }
      
      if (countdownBar) {
        const percentage = (timeLeft / 5) * 100;
        countdownBar.style.width = `${Math.max(percentage, 0)}%`;
      }
    }
  }
  
  hideTrainingPanel() {
    if (this.trainingPanel) {
      this.trainingPanel.style.opacity = '0';
      this.trainingPanel.style.transform = 'translateX(-20px)';
      setTimeout(() => {
        if (this.trainingPanel && this.trainingPanel.parentNode) {
          this.trainingPanel.parentNode.removeChild(this.trainingPanel);
        }
        this.trainingPanel = null;
      }, 300);
    }
  }
  
  cancelTraining() {
    console.log("🚫 Training cancelled by user");
    
    // Stop any active recognition
    if (this.enrollmentRecognition) {
      this.enrollmentRecognition.stop();
    }
    
    // Clear any intervals/timeouts
    if (this.enrollmentCountdownInterval) {
      clearInterval(this.enrollmentCountdownInterval);
    }
    
    // Reset enrollment state
    this.enrollmentMode = false;
    this.isActive = false;
    
    // Hide training panel
    this.hideTrainingPanel();
    
    // Show cancellation message
    this.showOverlay("error", "❌ Training cancelled");
    
    // Return to normal state after a moment
    setTimeout(() => {
      this.updateOverlayStatus();
    }, 2000);
  }

  updateOverlayStatus() {
    // Update button states
    const toggleBtn = document.getElementById('voice-toggle-btn');
    if (toggleBtn) {
      toggleBtn.textContent = this.isActive ? '⏸️ Stop Listening' : '🎤 Start Listening';
      toggleBtn.style.background = this.isActive ? '#f57c00' : '#34a853';
    }
    
    // Update enrollment button based on training status
    const enrollBtn = document.getElementById('voice-enrollment-btn');
    if (enrollBtn) {
      if (this.voiceprint) {
        enrollBtn.textContent = '🔄 Retrain Voice';
        enrollBtn.style.background = '#9c27b0';
      } else {
        enrollBtn.textContent = '� Train Voice';
        enrollBtn.style.background = '#1a73e8';
      }
    }
  }
  
  getTrainingInfo() {
    try {
      const saved = localStorage.getItem('youtube_voice_voiceprint');
      if (saved) {
        const voiceprintData = JSON.parse(saved);
        if (voiceprintData.version && voiceprintData.trainingDate) {
          return {
            date: new Date(voiceprintData.trainingDate).toLocaleDateString(),
            samples: voiceprintData.enrollmentSamples?.length || 0,
            phraseCount: voiceprintData.phraseCount || 0,
            daysAgo: Math.floor((Date.now() - voiceprintData.trainingTimestamp) / (1000 * 60 * 60 * 24))
          };
        }
      }
    } catch (error) {
      console.error("Failed to get training info:", error);
    }
    return null;
  }


  
  showOverlay(state, message) {
    console.log(`📱 Showing overlay: ${state} - ${message}`);
    const statusBar = document.getElementById('voice-status-bar');
    if (!statusBar) {
      console.log("❌ No status bar element found!");
      return;
    }
    
    const colors = {
      listening: { bg: '#1a73e8', color: 'white' },
      processing: { bg: '#f59e0b', color: 'white' },
      success: { bg: '#059669', color: 'white' },
      error: { bg: '#dc2626', color: 'white' },
      idle: { bg: '#6b7280', color: 'white' }
    };
    
    const style = colors[state] || colors.idle;
    statusBar.style.backgroundColor = style.bg;
    statusBar.style.color = style.color;
    statusBar.textContent = message;
    
    // Also update button states
    this.updateOverlayStatus();
    
    console.log(`✅ Overlay updated: ${state} - ${message}`);
  }
  
  async setupVoiceDetection() {
    try {
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // Setup Web Audio API for voice detection
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      
      this.microphone.connect(this.analyser);
      
    } catch (error) {
      console.error("Voice detection setup failed:", error);
      this.showOverlay("error", "Microphone access denied");
    }
  }
  
  startVoiceDetection() {
    if (!this.analyser || this.voiceDetectionActive) return;
    
    this.voiceDetectionActive = true;
    this.detectVoiceActivity();
  }
  
  detectVoiceActivity() {
    if (!this.voiceDetectionActive || !this.analyser) return;
    
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);
    
    // Calculate voice activity in human speech frequency range (300-3000 Hz)
    let voiceEnergy = 0;
    const startBin = Math.floor(300 * bufferLength / (this.audioContext.sampleRate / 2));
    const endBin = Math.floor(3000 * bufferLength / (this.audioContext.sampleRate / 2));
    
    for (let i = startBin; i < endBin; i++) {
      voiceEnergy += dataArray[i];
    }
    
    const avgVoiceEnergy = voiceEnergy / (endBin - startBin);
    
    // Detect if user is speaking
    const wasUserSpeaking = this.isUserSpeaking;
    this.isUserSpeaking = avgVoiceEnergy > this.voiceThreshold;
    
    // Trigger speech recognition when user starts speaking
    if (this.isUserSpeaking && !wasUserSpeaking && !this.isListening) {
      this.startListening();
    }
    
    // Continue monitoring
    requestAnimationFrame(() => this.detectVoiceActivity());
  }
  
  duckAudio(enable) {
    const video = document.querySelector('video');
    if (!video) {
      console.log("🔊 ❌ No video element found for ducking");
      return;
    }
    
    console.log(`🔊 Ducking ${enable ? 'ENABLE' : 'DISABLE'} - Current volume: ${video.volume}, isDucking: ${this.isDucking}`);
    
    if (enable && !this.isDucking) {
      // Store original volume and lower it
      this.originalVolume = video.volume;
      console.log(`🔊 📉 Ducking audio: ${video.volume} → ${this.duckingVolume}`);
      video.volume = this.duckingVolume;
      this.isDucking = true;
      console.log(`🔊 ✅ Audio ducked to ${video.volume}`);
    } else if (!enable && this.isDucking) {
      // Restore original volume
      console.log(`🔊 📈 Restoring audio: ${video.volume} → ${this.originalVolume}`);
      video.volume = this.originalVolume;
      this.isDucking = false;
      console.log(`🔊 ✅ Audio restored to ${video.volume}`);
    } else {
      console.log(`🔊 ⏭️ Ducking skipped - enable: ${enable}, isDucking: ${this.isDucking}`);
    }
  }

  // Transcript System
  async extractTranscript() {
    console.log("📄 🚀 extractTranscript() called - starting transcript extraction");
    try {
      const videoId = this.getCurrentVideoId();
      console.log(`📄 📹 Current video ID: ${videoId}`);
      if (!videoId) {
        console.log("📄 ❌ No video ID found, skipping transcript extraction");
        return;
      }

      // Check if we already have this transcript cached
      if (this.transcriptCache.has(videoId)) {
        this.transcript = this.transcriptCache.get(videoId);
        console.log(`📄 Using cached transcript for ${videoId} (${this.transcript.length} entries)`);
        return;
      }

      console.log(`📄 Extracting transcript for video: ${videoId}`);
      this.currentVideoId = videoId;
      
      // Try multiple methods to get transcript
      let transcript = await this.fetchYouTubeTranscript(videoId);
      
      if (transcript && transcript.length > 0) {
        this.transcript = transcript;
        this.transcriptCache.set(videoId, transcript);
        console.log(`📄 ✅ Transcript extracted: ${transcript.length} entries`);
        console.log(`📄 Sample: "${transcript[0]?.text}" at ${transcript[0]?.start}s`);
      } else {
        console.log("📄 ❌ No transcript available for this video");
      }
      
    } catch (error) {
      console.error("📄 Transcript extraction failed:", error);
    }
  }

  getCurrentVideoId() {
    // Extract video ID from current YouTube URL
    const url = window.location.href;
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : null;
  }

  async fetchYouTubeTranscript(videoId, useWhisper = false) {
    console.log(`📄 🚀 Fetching transcript for ${videoId} ${useWhisper ? '(Whisper AI)' : '(Original)'}`);
    
    try {
      // Construct URL based on preference
      let serverUrl;
      if (useWhisper) {
        serverUrl = `http://localhost:5000/transcript/${videoId}?whisper=true`;
      } else {
        serverUrl = `http://localhost:5000/transcript/${videoId}`;
      }
      
      console.log(`📄 Fetching VTT from: ${serverUrl}`);
      
      const response = await fetch(serverUrl);
      console.log(`📄 Response status: ${response.status}`);
      
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      
      const contentType = response.headers.get('content-type');
      const transcriptSource = response.headers.get('x-transcript-source') || 'Unknown';
      console.log(`📄 Content-Type: ${contentType}, Source: ${transcriptSource}`);
      
      if (contentType && contentType.includes('application/json')) {
        // Error response in JSON format
        const errorData = await response.json();
        throw new Error(errorData.error || 'Server returned error');
      }
      
      // Should be VTT content
      const vttText = await response.text();
      console.log(`📄 VTT content length: ${vttText.length} chars (${transcriptSource} source)`);
      
      if (!vttText || vttText.length < 10) {
        throw new Error('Empty or invalid VTT content');
      }
      
      console.log(`📄 🔄 About to call parseVTTFormat with ${vttText.length} chars`);
      const transcript = this.parseVTTFormat(vttText);
      console.log(`📄 ✅ parseVTTFormat returned ${transcript ? transcript.length : 0} entries`);
      
      if (transcript && transcript.length > 0) {
        console.log(`📄 ✅ SUCCESS: Parsed ${transcript.length} transcript entries`);
        console.log(`📄 Sample entry:`, transcript[0]);
        
        // Simple processing - just return the transcript
        console.log(`📄 ✅ Successfully parsed transcript, no complex processing needed`);
        
        return transcript;
      } else {
        throw new Error('VTT parsing returned empty transcript');
      }
      
    } catch (error) {
      console.error(`📄 ❌ Transcript fetch failed:`, error.message);
      throw error;
    }
  }

  parseJSON3Format(data) {
    if (!data.events) return null;
    
    const transcript = [];
    for (const event of data.events) {
      if (event.segs) {
        let text = '';
        for (const seg of event.segs) {
          if (seg.utf8) {
            text += seg.utf8;
          }
        }
        
        if (text.trim()) {
          transcript.push({
            text: text.trim().replace(/\n/g, ' '),
            start: event.tStartMs / 1000,
            duration: event.dDurationMs / 1000
          });
        }
      }
    }
    return transcript;
  }

  parseVTTFormat(vttText) {
    console.log(`📄 🔍 parseVTTFormat called with ${vttText.length} chars`);
    const transcript = [];
    const lines = vttText.split('\n');
    let currentEntry = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines and headers
      if (!line || line.includes('WEBVTT') || line.includes('Kind:') || line.includes('Language:')) {
        continue;
      }
      
      // Time stamp line (e.g., "00:00:01.000 --> 00:00:03.000")
      if (line.includes('-->')) {
        const timeParts = line.split('-->');
        if (timeParts.length === 2) {
          const startTime = this.parseVTTTime(timeParts[0].trim());
          const endTime = this.parseVTTTime(timeParts[1].trim());
          currentEntry = {
            start: startTime,
            duration: endTime - startTime,
            text: ''
          };
        }
      } 
      // Text line
      else if (currentEntry && line) {
        // Clean the line - remove VTT formatting tags
        let cleanLine = line.replace(/<[^>]*>/g, '').replace(/align:\w+|position:\d+%/g, '').trim();
        
        if (cleanLine) {
          currentEntry.text += (currentEntry.text ? ' ' : '') + cleanLine;
        }
        
        // If next line is empty or timestamp, finish this entry
        if (i + 1 >= lines.length || !lines[i + 1].trim() || lines[i + 1].includes('-->')) {
          if (currentEntry.text.trim()) {
            transcript.push({
              text: currentEntry.text.trim().replace(/\s+/g, ' '),
              start: currentEntry.start,
              duration: currentEntry.duration
            });
          }
          currentEntry = null;
        }
      }
    }
    
    // Clean up and deduplicate the transcript
    return this.cleanupTranscript(transcript);
  }

  cleanupTranscript(rawTranscript) {
    if (!rawTranscript || rawTranscript.length === 0) return null;
    
    console.log(`📄 Cleaning up transcript: ${rawTranscript.length} raw entries`);
    
    // Step 1: Remove empty entries and entries that are too short
    let filtered = rawTranscript.filter(entry => {
      const text = entry.text.trim();
      return text.length > 2 && !text.match(/^[^\w]*$/); // Must have actual words
    });
    
    // Step 2: Remove duplicates based on text content
    const seen = new Set();
    let deduplicated = [];
    
    for (const entry of filtered) {
      const normalizedText = entry.text.toLowerCase().trim();
      
      // Skip if we've seen this exact text before
      if (seen.has(normalizedText)) {
        continue;
      }
      
      // Skip if this text is completely contained in a previous entry
      let isSubstring = false;
      for (const prevText of seen) {
        if (prevText.includes(normalizedText) && prevText.length > normalizedText.length + 10) {
          isSubstring = true;
          break;
        }
      }
      
      if (!isSubstring) {
        seen.add(normalizedText);
        deduplicated.push(entry);
      }
    }
    
    // Step 3: Sort by timestamp
    deduplicated.sort((a, b) => a.start - b.start);
    
    console.log(`📄 Cleanup complete: ${rawTranscript.length} → ${deduplicated.length} entries`);
    
    return deduplicated.length > 0 ? deduplicated : null;
  }

  parseVTTTime(timeStr) {
    // Parse VTT time format (e.g., "00:01:23.456")
    const parts = timeStr.split(':');
    if (parts.length < 2) return 0;
    
    const seconds = parseFloat(parts[parts.length - 1]);
    const minutes = parseInt(parts[parts.length - 2]) || 0;
    const hours = parseInt(parts[parts.length - 3]) || 0;
    
    return hours * 3600 + minutes * 60 + seconds;
  }

  extractTranscriptFromPageData(videoId) {
    try {
      console.log("📄 Trying to extract from page data...");
      
      // Method 1: Try YouTube's player response
      if (window.ytplayer && window.ytplayer.config) {
        const playerResponse = window.ytplayer.config.args.player_response;
        if (playerResponse) {
          const parsed = JSON.parse(playerResponse);
          if (parsed.captions && parsed.captions.playerCaptionsTracklistRenderer) {
            const tracks = parsed.captions.playerCaptionsTracklistRenderer.captionTracks;
            const englishTrack = tracks.find(track => 
              track.languageCode === 'en' || track.languageCode.startsWith('en')
            );
            
            if (englishTrack && englishTrack.baseUrl) {
              console.log(`📄 Found player track URL: ${englishTrack.baseUrl}`);
              return this.fetchTranscriptViaProxy(englishTrack.baseUrl);
            }
          }
        }
      }
      
      // Method 2: Search in script tags
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        if (script.textContent.includes('captionTracks')) {
          const match = script.textContent.match(/"captionTracks":\s*(\[.*?\])/);
          if (match) {
            const captionTracks = JSON.parse(match[1]);
            const englishTrack = captionTracks.find(track => 
              track.languageCode === 'en' || track.languageCode === 'en-US'
            );
            
            if (englishTrack && englishTrack.baseUrl) {
              console.log(`📄 Found script track URL: ${englishTrack.baseUrl}`);
              return this.fetchTranscriptViaProxy(englishTrack.baseUrl);
            }
          }
        }
      }
      
      console.log("📄 No transcript data found in page");
      return null;
      
    } catch (error) {
      console.log("📄 Page data extraction failed:", error);
      return null;
    }
  }

  async fetchTranscriptViaProxy(url) {
    try {
      // Try using a CORS proxy or fetch with different headers
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      console.log(`📄 Trying CORS proxy: ${proxyUrl}`);
      
      const response = await fetch(proxyUrl);
      if (response.ok) {
        const data = await response.json();
        const xmlText = data.contents;
        return this.parseXMLTranscript(xmlText);
      }
      
      throw new Error('Proxy failed');
      
    } catch (error) {
      console.log("📄 Proxy method failed, trying direct:", error.message);
      
      // Fallback to direct fetch with different approach
      try {
        const response = await fetch(url, {
          method: 'GET',
          mode: 'no-cors', // This might work for some requests
          cache: 'no-cache'
        });
        
        // With no-cors, we can't read the response, but we can try
        console.log("📄 Direct no-cors fetch attempted");
        return null;
        
      } catch (directError) {
        console.log("📄 All fetch methods failed");
        return null;
      }
    }
  }

  parseXMLTranscript(xmlText) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      const textElements = xmlDoc.querySelectorAll('text');
      
      const transcript = [];
      textElements.forEach(element => {
        const text = element.textContent.trim().replace(/\n/g, ' ');
        const start = parseFloat(element.getAttribute('start') || 0);
        const duration = parseFloat(element.getAttribute('dur') || 2);
        
        if (text) {
          transcript.push({ text, start, duration });
        }
      });
      
      return transcript.length > 0 ? transcript : null;
      
    } catch (error) {
      console.log("📄 XML parsing failed:", error);
      return null;
    }
  }

  async fetchTranscriptFromUrl(url) {
    try {
      const response = await fetch(url);
      const xmlText = await response.text();
      
      // Parse XML transcript
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      const textElements = xmlDoc.querySelectorAll('text');
      
      const transcript = [];
      textElements.forEach(element => {
        const text = element.textContent.trim();
        const start = parseFloat(element.getAttribute('start') || 0);
        const duration = parseFloat(element.getAttribute('dur') || 2);
        
        if (text) {
          transcript.push({ text, start, duration });
        }
      });
      
      return transcript;
      
    } catch (error) {
      console.log("📄 URL fetch failed:", error);
      return null;
    }
  }

  async searchTranscript(query) {
    console.log(`📄 🔍 Simple search for: "${query}"`);
    
    // Check if we have transcript data
    if (!this.transcript || this.transcript.length === 0) {
      console.log(`📄 ❌ No transcript available`);
      return null;
    }
    
    const searchTerm = query.toLowerCase().trim();
    const matches = [];
    
    // Simple text search through transcript entries
    for (const entry of this.transcript) {
      if (entry.text.toLowerCase().includes(searchTerm)) {
        // Check if we already have a similar match within 3 seconds or same/similar text
        const isDuplicate = matches.some(existing => {
          const timeDiff = Math.abs(existing.start - entry.start);
          const sameText = existing.text.toLowerCase() === entry.text.toLowerCase();
          const similarText = existing.text.toLowerCase().includes(entry.text.toLowerCase()) || 
                             entry.text.toLowerCase().includes(existing.text.toLowerCase());
          
          return (timeDiff < 3 && sameText) || similarText;
        });
        
        if (!isDuplicate) {
          matches.push({
            start: entry.start,
            duration: entry.duration,
            text: entry.text,
            score: 100,
            matchType: 'text match'
          });
          console.log(`📄 ✅ Found match: "${entry.text.substring(0, 50)}..." at ${entry.start}s`);
        } else {
          console.log(`📄 ⏭️ Skipped duplicate: "${entry.text.substring(0, 50)}..." at ${entry.start}s`);
        }
      }
    }
    
    console.log(`📄 📊 Found ${matches.length} matches for "${searchTerm}"`);
    
    if (matches.length === 0) {
      return null;
    }
    
    // Return first match with all matches
    return {
      start: matches[0].start,
      duration: matches[0].duration, 
      text: matches[0].text,
      score: matches[0].score,
      allMatches: matches
    };
  }



  calculateTextSimilarity(text1, text2) {
    // Simple similarity check based on common words
    const words1 = text1.split(/\s+/).filter(w => w.length > 2);
    const words2 = text2.split(/\s+/).filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const commonWords = words1.filter(word => words2.includes(word));
    const totalWords = Math.max(words1.length, words2.length);
    
    return commonWords.length / totalWords;
  }



  watchForVideoChanges() {
    // Watch for URL changes to detect new videos
    let currentUrl = window.location.href;
    
    const checkForVideoChange = () => {
      const newUrl = window.location.href;
      if (newUrl !== currentUrl) {
        const newVideoId = this.getCurrentVideoId();
        if (newVideoId && newVideoId !== this.currentVideoId) {
          console.log(`📄 New video detected: ${newVideoId}`);
          // Small delay to let YouTube load the page
          setTimeout(() => this.extractTranscript(), 2000);
        }
        currentUrl = newUrl;
      }
    };
    
    // Check every 2 seconds for URL changes
    setInterval(checkForVideoChange, 2000);
    
    // Also listen for popstate events (back/forward navigation)
    window.addEventListener('popstate', () => {
      setTimeout(checkForVideoChange, 1000);
    });
  }
  
  setupKeyboardShortcuts() {
    console.log("🎮 Setting up keyboard shortcuts...");
    document.addEventListener('keydown', (event) => {
      console.log(`🎮 Key pressed: ${event.key}, Ctrl: ${event.ctrlKey}, Meta: ${event.metaKey}, Shift: ${event.shiftKey}`);
      
      // Ctrl/Cmd + Shift + V to toggle
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'V') {
        console.log("🎮 Ctrl+Shift+V detected - toggling listening");
        event.preventDefault();
        this.toggleListening();
      }
      
      // Ctrl/Cmd + Shift + E to start enrollment
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'E') {
        console.log("🎮 Ctrl+Shift+E detected - starting enrollment");
        event.preventDefault();
        this.startSpeakerEnrollment();
      }
    });
    console.log("✅ Keyboard shortcuts set up complete");
  }
  
  // Speaker Enrollment System
  startSpeakerEnrollment() {
    console.log("🎯 Starting speaker enrollment...");
    console.log("🎯 Enrollment mode activated");
    
    // Stop any existing speech recognition first
    this.isActive = false;
    this.enrollmentMode = true;
    
    if (this.recognition && this.isListening) {
      console.log("🎯 Stopping existing recognition...");
      this.recognition.stop();
      
      // Wait for recognition to fully stop before starting enrollment
      setTimeout(() => {
        this.initializeEnrollment();
      }, 500);
    } else {
      this.initializeEnrollment();
    }
  }
  
  initializeEnrollment() {
    console.log("🎯 Initializing enrollment...");
    
    this.enrollmentSamples = [];
    this.currentEnrollmentPhrase = 0;
    this.currentSampleCount = 0;
    this.samplesPerPhrase = 1; // One sample per phrase for faster training
    
    // Make sure all background recognition is completely stopped
    this.isActive = false;
    this.wakeWordDetected = false;
    this.voiceDetectionActive = false;
    
    // Create and show training panel
    this.createTrainingPanel();
    
    // Update control panel
    this.updateOverlayStatus();
    
    // Show brief intro message
    this.showOverlay("processing", "🎤 Voice Training Started!");
    
    // Show instructions with more time
    setTimeout(() => {
      this.continueEnrollment();
    }, 2000);
  }
  
  continueEnrollment() {
    if (this.currentEnrollmentPhrase >= this.enrollmentPhrases.length) {
      this.completeEnrollment();
      return;
    }
    
    const phrase = this.enrollmentPhrases[this.currentEnrollmentPhrase];
    const totalPhrases = this.enrollmentPhrases.length;
    const currentPhrase = this.currentEnrollmentPhrase + 1;
    
    // Update training panel with current phrase and get ready status
    this.updateTrainingPanel(
      this.currentEnrollmentPhrase,
      totalPhrases,
      phrase,
      `🎤 Get ready to speak... (${currentPhrase}/${totalPhrases})`
    );
    
    // Show clear instruction to user with progress
    this.showOverlay("processing", `🎤 Training ${currentPhrase}/${totalPhrases}`);
    
    // Brief pause to read instruction, then start recording immediately
    setTimeout(() => {
      this.showOverlay("listening", `🔴 Recording phrase ${currentPhrase}...`);
      this.startEnrollmentListening();
    }, 1500); // Just 1.5 seconds to read the instruction
  }
  
  startEnrollmentListening() {
    console.log("🎤 Starting enrollment listening...");
    
    // Create a fresh speech recognition instance for enrollment
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.enrollmentRecognition = new SpeechRecognition();
    
    // Configuration for enrollment with longer timeout
    this.enrollmentRecognition.continuous = true;  // Keep listening
    this.enrollmentRecognition.interimResults = true; // Get partial results
    this.enrollmentRecognition.lang = 'en-US';
    this.enrollmentRecognition.maxAlternatives = 1;
    
    // Manual timeout after 5 seconds
    let enrollmentTimeout;
    let hasGotResult = false;
    const phrase = this.enrollmentPhrases[this.currentEnrollmentPhrase];
    
    this.enrollmentRecognition.onstart = () => {
      console.log("🎤 Enrollment recording started");
      
      // Update training panel with recording status
      this.updateTrainingPanel(
        this.currentEnrollmentPhrase,
        this.enrollmentPhrases.length,
        phrase,
        "🔴 Recording... Speak now!",
        5
      );
      
      this.showOverlay("listening", "🎤 Recording...");
      
      // Start 5-second timeout countdown with training panel updates
      let timeLeft = 5;
      this.enrollmentCountdownInterval = setInterval(() => {
        if (hasGotResult) {
          // Stop countdown immediately if we got a result
          clearInterval(this.enrollmentCountdownInterval);
          return;
        }
        
        timeLeft--;
        
        if (timeLeft > 0) {
          // Update training panel countdown
          this.updateTrainingPanel(
            this.currentEnrollmentPhrase,
            this.enrollmentPhrases.length,
            phrase,
            `🔴 Recording... ${timeLeft}s remaining`,
            timeLeft
          );
          this.showOverlay("listening", `🎤 Recording... ${timeLeft}s`);
        } else {
          // Time's up - clear interval and show timeout message
          clearInterval(this.enrollmentCountdownInterval);
          this.updateTrainingPanel(
            this.currentEnrollmentPhrase,
            this.enrollmentPhrases.length,
            phrase,
            "❌ Time's up! No speech detected",
            0
          );
          this.showOverlay("error", "❌ Time's up! No speech detected");
        }
      }, 1000);
      
      // Set manual timeout
      enrollmentTimeout = setTimeout(() => {
        if (!hasGotResult) {
          console.log("🎤 Enrollment timeout - no speech detected");
          // Clear interval to prevent flickering
          clearInterval(this.enrollmentCountdownInterval);
          this.enrollmentRecognition.stop();
        }
      }, 5000);
      
      // Backup timeout to prevent getting stuck in "Processing speech..." 
      this.processingTimeout = setTimeout(() => {
        if (hasGotResult && !this.enrollmentPhraseMatched) {
          console.log("🚨 Processing timeout - forcing completion");
          this.updateTrainingPanel(
            this.currentEnrollmentPhrase,
            this.enrollmentPhrases.length,
            phrase,
            "❌ Processing timeout - try again",
            null
          );
          this.showOverlay("error", "❌ Processing timeout - try again");
          this.enrollmentRecognition.stop();
        }
      }, 8000); // 8 seconds total timeout
    };
    
    this.enrollmentRecognition.onresult = (event) => {
      // Process the most recent result
      const lastResult = event.results[event.results.length - 1];
      const transcript = lastResult[0].transcript.trim();
      
      // Check if we have enough words before processing
      const expectedPhrase = this.enrollmentPhrases[this.currentEnrollmentPhrase].toLowerCase();
      const expectedWordCount = expectedPhrase.split(/\s+/).length;
      const currentWordCount = transcript.trim().split(/\s+/).length;
      
      // Only process when we have roughly the right number of words OR it's been a while
      const hasEnoughWords = currentWordCount >= expectedWordCount;
      const isLongEnough = transcript.length >= expectedPhrase.length * 0.7; // 70% of expected length
      
      if ((hasEnoughWords || isLongEnough) && transcript.length >= 2 && !hasGotResult) {
        console.log(`🎤 Processing speech: "${transcript}" (${currentWordCount}/${expectedWordCount} words)`);
        
        // IMMEDIATELY clear timers and set flag
        clearTimeout(enrollmentTimeout);
        clearInterval(this.enrollmentCountdownInterval);
        clearTimeout(this.processingTimeout);
        hasGotResult = true;
        
        // Process the speech right now
        const similarity = this.calculatePhraseSimilarity(transcript.toLowerCase(), expectedPhrase);
        const requiredSimilarity = expectedWordCount <= 3 ? 0.8 : 0.7;
        
        console.log(`🎤 Comparing: "${transcript}" vs "${expectedPhrase}" (similarity: ${(similarity * 100).toFixed(1)}%)`);
        
        if (similarity >= requiredSimilarity) {
          // PERFECT MATCH - IMMEDIATE SUCCESS AND ADVANCE
          console.log(`✅ PHRASE MATCHED! Moving to next phrase immediately`);
          
          // STOP EVERYTHING immediately
          this.enrollmentRecognition.stop();
          this.enrollmentPhraseMatched = true;
          
          // Capture voice features
          this.captureVoiceFeatures(transcript, true);
          
          // Show success briefly
          this.updateTrainingPanel(
            this.currentEnrollmentPhrase,
            this.enrollmentPhrases.length,
            phrase,
            `✅ Perfect! "${transcript}"`,
            null
          );
          this.showOverlay("success", `✅ Good! "${transcript}"`);
          
          // IMMEDIATELY advance to next phrase (no waiting!)
          setTimeout(() => {
            this.advanceEnrollment();
          }, 800); // Just 0.8 seconds to show success message
          
        } else {
          // Poor match - immediate retry (no long waits)
          console.log(`❌ Poor match - retrying same phrase quickly`);
          
          // STOP recognition immediately
          this.enrollmentRecognition.stop();
          this.enrollmentPhraseMatched = false;
          
          this.updateTrainingPanel(
            this.currentEnrollmentPhrase,
            this.enrollmentPhrases.length,
            phrase,
            `❌ Try again - say exactly: "${this.enrollmentPhrases[this.currentEnrollmentPhrase]}"`,
            null
          );
          
          this.showOverlay("error", `❌ Try again: "${this.enrollmentPhrases[this.currentEnrollmentPhrase]}"`);
          
          // Quick retry - no long waits
          setTimeout(() => {
            this.continueEnrollment();
          }, 1200); // Just 1.2 seconds to show error
        }
        
        return; // Exit function - we're done processing
      }
    };
    
    this.enrollmentRecognition.onerror = (event) => {
      console.error("Enrollment recognition error:", event.error);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        // Update training panel with error
        this.updateTrainingPanel(
          this.currentEnrollmentPhrase,
          this.enrollmentPhrases.length,
          phrase,
          `❌ Recording error: ${event.error}`,
          null
        );
        this.showOverlay("error", `Recording error: ${event.error}`);
      }
    };
    
    this.enrollmentRecognition.onend = () => {
      console.log("🎤 Enrollment recording ended");
      
      // Clear any remaining timeouts and intervals (safe to call multiple times)
      if (enrollmentTimeout) {
        clearTimeout(enrollmentTimeout);
        enrollmentTimeout = null;
      }
      if (this.enrollmentCountdownInterval) {
        clearInterval(this.enrollmentCountdownInterval);
        this.enrollmentCountdownInterval = null;
      }
      if (this.processingTimeout) {
        clearTimeout(this.processingTimeout);
        this.processingTimeout = null;
      }
      
      // Only advance if phrase was not already matched in onresult
      // If it was matched, advancement is handled in onresult callback
      if (!this.enrollmentPhraseMatched && !hasGotResult) {
        // No speech detected within 5 seconds - show message and retry
        this.updateTrainingPanel(
          this.currentEnrollmentPhrase,
          this.enrollmentPhrases.length,
          phrase,
          "❌ No speech detected - try again",
          null
        );
        this.showOverlay("error", "❌ No speech detected in 5 seconds. Try again...");
        setTimeout(() => {
          this.continueEnrollment();
        }, 2000);
      }
      
      // Reset the flag for next attempt
      this.enrollmentPhraseMatched = false;
    };
    
    try {
      this.enrollmentRecognition.start();
    } catch (error) {
      console.error("Enrollment listening failed:", error);
      this.updateTrainingPanel(
        this.currentEnrollmentPhrase,
        this.enrollmentPhrases.length,
        phrase,
        "❌ Recording failed - try again",
        null
      );
      this.showOverlay("error", "Recording failed - try again");
    }
  }
  
  advanceEnrollment() {
    this.currentSampleCount++;
    
    if (this.currentSampleCount >= this.samplesPerPhrase) {
      // Move to next phrase
      this.currentEnrollmentPhrase++;
      this.currentSampleCount = 0;
      
      if (this.currentEnrollmentPhrase >= this.enrollmentPhrases.length) {
        this.completeEnrollment();
        return;
      }
      
      // Show progress message between phrases
      const totalPhrases = this.enrollmentPhrases.length;
      const completed = this.currentEnrollmentPhrase;
      this.showOverlay("processing", `✅ Progress: ${completed}/${totalPhrases} phrases complete`);
      
      setTimeout(() => {
        this.continueEnrollment();
      }, 2000);
    } else {
      // Continue with same phrase, next sample
      setTimeout(() => {
        this.continueEnrollment();
      }, 1000);
    }
  }

  completeEnrollment() {
    console.log("🎯 Speaker enrollment complete!");
    this.enrollmentMode = false;
    
    // Update training panel to show completion
    this.updateTrainingPanel(
      this.enrollmentPhrases.length - 1,
      this.enrollmentPhrases.length,
      "Training Complete!",
      "🎉 Voice training completed successfully!",
      null
    );
    
    // Process all samples to create voiceprint
    this.createVoiceprint();
    
    // Save voiceprint to localStorage
    this.saveVoiceprint();
    
    // Update control panel
    this.updateOverlayStatus();
    
    this.showOverlay("success", "✅ Voice training complete!");
    
    // Hide training panel after showing completion
    setTimeout(() => {
      this.hideTrainingPanel();
    }, 1500);
    
    // Resume normal operation
    setTimeout(() => {
      console.log("🎯 Resuming normal voice control...");
      
      // Reset all states
      this.isActive = false;
      this.wakeWordDetected = false;
      this.voiceDetectionActive = false;
      
      // Restart speech recognition system
      this.setupSpeechRecognition(); // Reset speech recognition handlers
      
      // Ensure audio context is active for wake word detection
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().then(() => {
          console.log("🎯 Audio context resumed");
          this.startInitialListening();
        });
      } else {
        this.startInitialListening();
      }
      
      this.updateOverlayStatus();
    }, 3000);
  }
  
  captureVoiceFeatures(transcript, isEnrollment = false) {
    if (!this.analyser) return null;
    
    // Capture audio features
    const bufferLength = this.analyser.frequencyBinCount;
    const frequencyData = new Uint8Array(bufferLength);
    const timeDomainData = new Uint8Array(bufferLength);
    
    this.analyser.getByteFrequencyData(frequencyData);
    this.analyser.getByteTimeDomainData(timeDomainData);
    
    // Extract voice characteristics
    const features = {
      // Frequency domain features
      fundamentalFreq: this.extractFundamentalFrequency(frequencyData),
      formants: this.extractFormants(frequencyData),
      spectralCentroid: this.calculateSpectralCentroid(frequencyData),
      spectralRolloff: this.calculateSpectralRolloff(frequencyData),
      spectralFlux: this.calculateSpectralFlux(frequencyData),
      spectralFlatness: this.calculateSpectralFlatness(frequencyData),
      mfcc: this.calculateMFCC(frequencyData),
      
      // Time domain features  
      zeroCrossingRate: this.calculateZeroCrossingRate(timeDomainData),
      energy: this.calculateEnergy(timeDomainData),
      
      // Advanced voice characteristics
      voicedRatio: this.calculateVoicedRatio(frequencyData),
      harmonicRatio: this.calculateHarmonicRatio(frequencyData),
      
      // Context
      transcript: transcript,
      timestamp: Date.now()
    };
    
    if (isEnrollment) {
      this.enrollmentSamples.push(features);
      console.log(`📊 Captured enrollment sample ${this.enrollmentSamples.length}:`, features);
    }
    
    return features;
  }
  
  extractFundamentalFrequency(frequencyData) {
    // Advanced F0 estimation using autocorrelation method
    const sampleRate = this.audioContext.sampleRate;
    const nyquist = sampleRate / 2;
    
    // Focus on human speech range (80-400 Hz)
    const minF0 = 80;
    const maxF0 = 400;
    const startBin = Math.floor(minF0 * frequencyData.length / nyquist);
    const endBin = Math.floor(maxF0 * frequencyData.length / nyquist);
    
    // Find multiple peaks and use harmonic analysis
    const peaks = [];
    for (let i = startBin + 1; i < endBin - 1; i++) {
      if (frequencyData[i] > frequencyData[i-1] && frequencyData[i] > frequencyData[i+1]) {
        if (frequencyData[i] > 30) { // Minimum threshold
          peaks.push({
            bin: i,
            frequency: i * nyquist / frequencyData.length,
            magnitude: frequencyData[i]
          });
        }
      }
    }
    
    // Sort by magnitude
    peaks.sort((a, b) => b.magnitude - a.magnitude);
    
    // Return the most prominent peak in F0 range
    return peaks.length > 0 ? peaks[0].frequency : 0;
  }
  
  // Enhanced formant extraction
  extractFormants(frequencyData) {
    const sampleRate = this.audioContext.sampleRate;
    const nyquist = sampleRate / 2;
    
    // Formant frequency ranges (typical for adult speakers)
    const formantRanges = [
      { min: 300, max: 1000 },   // F1
      { min: 800, max: 2500 },   // F2  
      { min: 1500, max: 3500 }   // F3
    ];
    
    const formants = [];
    
    for (let f = 0; f < formantRanges.length; f++) {
      const range = formantRanges[f];
      const startBin = Math.floor(range.min * frequencyData.length / nyquist);
      const endBin = Math.floor(range.max * frequencyData.length / nyquist);
      
      let maxMagnitude = 0;
      let maxBin = startBin;
      
      // Find peak in formant range
      for (let i = startBin; i < endBin; i++) {
        if (frequencyData[i] > maxMagnitude) {
          maxMagnitude = frequencyData[i];
          maxBin = i;
        }
      }
      
      formants.push({
        frequency: maxBin * nyquist / frequencyData.length,
        magnitude: maxMagnitude
      });
    }
    
    return formants;
  }
  
  calculateSpectralCentroid(frequencyData) {
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < frequencyData.length; i++) {
      const freq = i * (this.audioContext.sampleRate / 2) / frequencyData.length;
      numerator += freq * frequencyData[i];
      denominator += frequencyData[i];
    }
    
    return denominator > 0 ? numerator / denominator : 0;
  }
  
  calculateSpectralRolloff(frequencyData) {
    const totalEnergy = frequencyData.reduce((sum, val) => sum + val, 0);
    const threshold = totalEnergy * 0.85; // 85% rolloff point
    
    let cumulativeEnergy = 0;
    for (let i = 0; i < frequencyData.length; i++) {
      cumulativeEnergy += frequencyData[i];
      if (cumulativeEnergy >= threshold) {
        return i * (this.audioContext.sampleRate / 2) / frequencyData.length;
      }
    }
    
    return 0;
  }
  
  calculateMFCC(frequencyData) {
    // Simplified MFCC calculation (first few coefficients)
    const melBands = 13;
    const mfcc = new Array(melBands).fill(0);
    
    // Create mel filter bank
    for (let m = 0; m < melBands; m++) {
      let sum = 0;
      const start = Math.floor(m * frequencyData.length / melBands);
      const end = Math.floor((m + 1) * frequencyData.length / melBands);
      
      for (let i = start; i < end; i++) {
        sum += frequencyData[i];
      }
      
      mfcc[m] = Math.log(sum + 1); // Log energy in mel band
    }
    
    return mfcc;
  }
  
  calculateZeroCrossingRate(timeDomainData) {
    let crossings = 0;
    const midpoint = 128; // Middle of 0-255 range
    
    for (let i = 1; i < timeDomainData.length; i++) {
      if ((timeDomainData[i-1] - midpoint) * (timeDomainData[i] - midpoint) < 0) {
        crossings++;
      }
    }
    
    return crossings / timeDomainData.length;
  }
  
  calculateEnergy(timeDomainData) {
    let energy = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
      const sample = (timeDomainData[i] - 128) / 128; // Normalize to -1 to 1
      energy += sample * sample;
    }
    return energy / timeDomainData.length;
  }
  
  calculateSpectralFlux(frequencyData) {
    // Measure of spectral change over time (simplified single-frame version)
    let flux = 0;
    for (let i = 1; i < frequencyData.length; i++) {
      const diff = frequencyData[i] - frequencyData[i-1];
      flux += diff * diff;
    }
    return Math.sqrt(flux / frequencyData.length);
  }
  
  calculateSpectralFlatness(frequencyData) {
    // Measure of how flat the spectrum is (noise vs tonal)
    let geometricMean = 1;
    let arithmeticMean = 0;
    let count = 0;
    
    for (let i = 1; i < frequencyData.length; i++) {
      if (frequencyData[i] > 0) {
        geometricMean *= Math.pow(frequencyData[i], 1.0 / frequencyData.length);
        arithmeticMean += frequencyData[i];
        count++;
      }
    }
    
    arithmeticMean /= count;
    return count > 0 ? geometricMean / arithmeticMean : 0;
  }
  
  calculateVoicedRatio(frequencyData) {
    // Ratio of voiced (harmonic) to unvoiced (noise) content
    const sampleRate = this.audioContext.sampleRate;
    const nyquist = sampleRate / 2;
    
    // Voiced speech typically has strong harmonics
    let harmonicEnergy = 0;
    let totalEnergy = 0;
    
    for (let i = 0; i < frequencyData.length; i++) {
      const freq = i * nyquist / frequencyData.length;
      totalEnergy += frequencyData[i];
      
      // Count energy in typical voiced frequency ranges
      if (freq >= 100 && freq <= 1000) {
        harmonicEnergy += frequencyData[i];
      }
    }
    
    return totalEnergy > 0 ? harmonicEnergy / totalEnergy : 0;
  }
  
  calculateHarmonicRatio(frequencyData) {
    // Measure harmonicity of the signal
    const f0 = this.extractFundamentalFrequency(frequencyData);
    if (f0 < 50) return 0; // No clear fundamental
    
    const sampleRate = this.audioContext.sampleRate;
    const nyquist = sampleRate / 2;
    
    let harmonicSum = 0;
    let totalSum = 0;
    
    // Check for harmonics (multiples of F0)
    for (let harmonic = 1; harmonic <= 8; harmonic++) {
      const harmonicFreq = f0 * harmonic;
      if (harmonicFreq > nyquist) break;
      
      const bin = Math.round(harmonicFreq * frequencyData.length / nyquist);
      if (bin < frequencyData.length) {
        harmonicSum += frequencyData[bin];
      }
    }
    
    // Total energy across all frequencies
    for (let i = 0; i < frequencyData.length; i++) {
      totalSum += frequencyData[i];
    }
    
    return totalSum > 0 ? harmonicSum / totalSum : 0;
  }
  
  createVoiceprint() {
    if (this.enrollmentSamples.length === 0) return null;
    
    console.log(`🎯 Creating voiceprint from ${this.enrollmentSamples.length} samples`);
    
    // Calculate average features across all samples
    const voiceprint = {
      // Basic features
      fundamentalFreq: this.averageFeature('fundamentalFreq'),
      spectralCentroid: this.averageFeature('spectralCentroid'),
      spectralRolloff: this.averageFeature('spectralRolloff'),
      spectralFlux: this.averageFeature('spectralFlux'),
      spectralFlatness: this.averageFeature('spectralFlatness'),
      zeroCrossingRate: this.averageFeature('zeroCrossingRate'),
      energy: this.averageFeature('energy'),
      voicedRatio: this.averageFeature('voicedRatio'),
      harmonicRatio: this.averageFeature('harmonicRatio'),
      
      // Complex features
      mfcc: this.averageMFCC(),
      formants: this.averageFormants(),
      
      // Statistical measures
      fundamentalFreqStd: this.calculateStdDev('fundamentalFreq'),
      energyStd: this.calculateStdDev('energy'),
      spectralCentroidStd: this.calculateStdDev('spectralCentroid'),
      
      sampleCount: this.enrollmentSamples.length,
      createdAt: Date.now()
    };
    
    this.voiceprint = voiceprint;
    console.log("🎯 Voiceprint created:", voiceprint);
    
    return voiceprint;
  }
  
  averageFeature(featureName) {
    const sum = this.enrollmentSamples.reduce((acc, sample) => acc + sample[featureName], 0);
    return sum / this.enrollmentSamples.length;
  }
  
  averageMFCC() {
    const mfccLength = this.enrollmentSamples[0].mfcc.length;
    const avgMFCC = new Array(mfccLength).fill(0);
    
    for (let i = 0; i < mfccLength; i++) {
      const sum = this.enrollmentSamples.reduce((acc, sample) => acc + sample.mfcc[i], 0);
      avgMFCC[i] = sum / this.enrollmentSamples.length;
    }
    
    return avgMFCC;
  }
  
  averageFormants() {
    if (this.enrollmentSamples.length === 0) return [];
    
    const formantCount = this.enrollmentSamples[0].formants.length;
    const avgFormants = [];
    
    for (let f = 0; f < formantCount; f++) {
      const freqSum = this.enrollmentSamples.reduce((acc, sample) => 
        acc + sample.formants[f].frequency, 0);
      const magSum = this.enrollmentSamples.reduce((acc, sample) => 
        acc + sample.formants[f].magnitude, 0);
      
      avgFormants.push({
        frequency: freqSum / this.enrollmentSamples.length,
        magnitude: magSum / this.enrollmentSamples.length
      });
    }
    
    return avgFormants;
  }
  
  calculateStdDev(featureName) {
    const mean = this.averageFeature(featureName);
    const squaredDiffs = this.enrollmentSamples.map(sample => 
      Math.pow(sample[featureName] - mean, 2)
    );
    const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / this.enrollmentSamples.length;
    return Math.sqrt(variance);
  }
  
  saveVoiceprint() {
    if (!this.voiceprint) return;
    
    try {
      const voiceprintData = {
        voiceprint: this.voiceprint,
        enrollmentSamples: this.enrollmentSamples,
        trainingTimestamp: Date.now(),
        trainingDate: new Date().toISOString(),
        phraseCount: this.enrollmentPhrases.length,
        version: "1.0"
      };
      
      localStorage.setItem('youtube_voice_voiceprint', JSON.stringify(voiceprintData));
      console.log(`💾 Voiceprint saved to localStorage with ${this.enrollmentSamples.length} samples`);
      console.log(`💾 Training completed on: ${voiceprintData.trainingDate}`);
    } catch (error) {
      console.error("Failed to save voiceprint:", error);
    }
  }
  
  loadVoiceprint() {
    try {
      const saved = localStorage.getItem('youtube_voice_voiceprint');
      if (saved) {
        const voiceprintData = JSON.parse(saved);
        
        // Handle both old format (direct voiceprint) and new format (with metadata)
        if (voiceprintData.version && voiceprintData.voiceprint) {
          // New format with metadata
          this.voiceprint = voiceprintData.voiceprint;
          this.enrollmentSamples = voiceprintData.enrollmentSamples || [];
          
          console.log("📥 Enhanced voiceprint loaded from localStorage");
          console.log(`📥 Training date: ${voiceprintData.trainingDate}`);
          console.log(`📥 Sample count: ${this.enrollmentSamples.length}`);
          console.log(`📥 Phrase count: ${voiceprintData.phraseCount}`);
        } else {
          // Legacy format - direct voiceprint
          this.voiceprint = voiceprintData;
          console.log("📥 Legacy voiceprint loaded from localStorage");
        }
        
        return true;
      }
    } catch (error) {
      console.error("Failed to load voiceprint:", error);
    }
    return false;
  }
  
  // Speaker Verification System
  verifySpeaker(currentFeatures) {
    if (!this.voiceprint || !currentFeatures) {
      console.log("🔍 No voiceprint or features available for verification");
      return { isMatch: false, confidence: 0, reason: "No voiceprint" };
    }
    
    console.log("🔍 Verifying speaker against voiceprint...");
    
    // Calculate similarity scores for different feature types
    const scores = {
      fundamentalFreq: this.calculateFrequencySimilarity(
        currentFeatures.fundamentalFreq, 
        this.voiceprint.fundamentalFreq,
        this.voiceprint.fundamentalFreqStd
      ),
      
      formants: this.calculateFormantSimilarity(
        currentFeatures.formants,
        this.voiceprint.formants
      ),
      
      spectral: this.calculateSpectralSimilarity(currentFeatures),
      
      mfcc: this.calculateMFCCSimilarity(
        currentFeatures.mfcc,
        this.voiceprint.mfcc
      ),
      
      voice: this.calculateVoiceSimilarity(currentFeatures)
    };
    
    // Weighted combination of scores
    const weights = {
      fundamentalFreq: 0.25,
      formants: 0.30,
      spectral: 0.20,
      mfcc: 0.15,
      voice: 0.10
    };
    
    let weightedScore = 0;
    for (const [feature, score] of Object.entries(scores)) {
      weightedScore += score * weights[feature];
    }
    
    // Determine if speaker matches
    const threshold = 0.65; // Adjustable threshold
    const isMatch = weightedScore >= threshold;
    
    console.log(`🔍 Speaker verification: ${isMatch ? 'MATCH' : 'NO MATCH'} (confidence: ${(weightedScore * 100).toFixed(1)}%)`);
    console.log("🔍 Individual scores:", scores);
    
    return {
      isMatch: isMatch,
      confidence: weightedScore,
      scores: scores,
      threshold: threshold
    };
  }
  
  calculateFrequencySimilarity(currentF0, voiceprintF0, stdDev) {
    if (currentF0 === 0 || voiceprintF0 === 0) return 0;
    
    const difference = Math.abs(currentF0 - voiceprintF0);
    const tolerance = Math.max(stdDev * 2, 20); // At least 20Hz tolerance
    
    // Gaussian-like similarity
    const similarity = Math.exp(-Math.pow(difference / tolerance, 2));
    return Math.max(0, Math.min(1, similarity));
  }
  
  calculateFormantSimilarity(currentFormants, voiceprintFormants) {
    if (!currentFormants || !voiceprintFormants || 
        currentFormants.length !== voiceprintFormants.length) {
      return 0;
    }
    
    let totalSimilarity = 0;
    const formantWeights = [0.4, 0.4, 0.2]; // F1 and F2 more important than F3
    
    for (let i = 0; i < currentFormants.length; i++) {
      const currentFreq = currentFormants[i].frequency;
      const voiceprintFreq = voiceprintFormants[i].frequency;
      
      if (currentFreq === 0 || voiceprintFreq === 0) continue;
      
      const difference = Math.abs(currentFreq - voiceprintFreq);
      const tolerance = voiceprintFreq * 0.15; // 15% tolerance
      
      const similarity = Math.exp(-Math.pow(difference / tolerance, 2));
      totalSimilarity += similarity * formantWeights[i];
    }
    
    return Math.max(0, Math.min(1, totalSimilarity));
  }
  
  calculateSpectralSimilarity(currentFeatures) {
    const spectralFeatures = [
      { current: currentFeatures.spectralCentroid, voiceprint: this.voiceprint.spectralCentroid, tolerance: 500 },
      { current: currentFeatures.spectralRolloff, voiceprint: this.voiceprint.spectralRolloff, tolerance: 1000 },
      { current: currentFeatures.spectralFlux, voiceprint: this.voiceprint.spectralFlux, tolerance: 10 },
      { current: currentFeatures.spectralFlatness, voiceprint: this.voiceprint.spectralFlatness, tolerance: 0.1 }
    ];
    
    let totalSimilarity = 0;
    let validFeatures = 0;
    
    for (const feature of spectralFeatures) {
      if (feature.current === 0 || feature.voiceprint === 0) continue;
      
      const difference = Math.abs(feature.current - feature.voiceprint);
      const similarity = Math.exp(-Math.pow(difference / feature.tolerance, 2));
      
      totalSimilarity += similarity;
      validFeatures++;
    }
    
    return validFeatures > 0 ? totalSimilarity / validFeatures : 0;
  }
  
  calculateMFCCSimilarity(currentMFCC, voiceprintMFCC) {
    if (!currentMFCC || !voiceprintMFCC || 
        currentMFCC.length !== voiceprintMFCC.length) {
      return 0;
    }
    
    // Cosine similarity for MFCC vectors
    let dotProduct = 0;
    let currentMagnitude = 0;
    let voiceprintMagnitude = 0;
    
    for (let i = 0; i < currentMFCC.length; i++) {
      dotProduct += currentMFCC[i] * voiceprintMFCC[i];
      currentMagnitude += currentMFCC[i] * currentMFCC[i];
      voiceprintMagnitude += voiceprintMFCC[i] * voiceprintMFCC[i];
    }
    
    const magnitude = Math.sqrt(currentMagnitude) * Math.sqrt(voiceprintMagnitude);
    return magnitude > 0 ? Math.max(0, dotProduct / magnitude) : 0;
  }
  
  calculateVoiceSimilarity(currentFeatures) {
    const voiceFeatures = [
      { current: currentFeatures.voicedRatio, voiceprint: this.voiceprint.voicedRatio, tolerance: 0.2 },
      { current: currentFeatures.harmonicRatio, voiceprint: this.voiceprint.harmonicRatio, tolerance: 0.2 },
      { current: currentFeatures.zeroCrossingRate, voiceprint: this.voiceprint.zeroCrossingRate, tolerance: 0.05 }
    ];
    
    let totalSimilarity = 0;
    let validFeatures = 0;
    
    for (const feature of voiceFeatures) {
      const difference = Math.abs(feature.current - feature.voiceprint);
      const similarity = Math.exp(-Math.pow(difference / feature.tolerance, 2));
      
      totalSimilarity += similarity;
      validFeatures++;
    }
    
    return validFeatures > 0 ? totalSimilarity / validFeatures : 0;
  }
  
  // Phrase similarity for enrollment validation
  calculatePhraseSimilarity(spoken, expected) {
    // Calculate Character Error Rate (CER) for more precise matching
    const cer = this.calculateCER(spoken.toLowerCase().trim(), expected.toLowerCase().trim());
    const wordCount = expected.split(/\s+/).length;
    
    // Use stricter thresholds based on phrase length
    const threshold = wordCount <= 3 ? 0.2 : 0.3; // Short phrases: CER < 0.2, Long phrases: CER < 0.3
    const similarity = 1 - cer; // Convert CER to similarity score
    
    console.log(`📊 CER Analysis: "${spoken}" vs "${expected}"`);
    console.log(`📊 CER: ${(cer * 100).toFixed(1)}%, Threshold: ${(threshold * 100).toFixed(0)}%, Words: ${wordCount}`);
    console.log(`📊 Similarity: ${(similarity * 100).toFixed(1)}%, Required: ${((1-threshold) * 100).toFixed(0)}%`);
    
    return similarity;
  }

  calculateCER(spoken, expected) {
    // Calculate Character Error Rate using Levenshtein distance
    const distance = this.levenshteinDistance(spoken, expected);
    const cer = distance / Math.max(expected.length, 1);
    return Math.min(cer, 1.0); // Cap at 100% error rate
  }

  levenshteinDistance(str1, str2) {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion  
          matrix[j - 1][i - 1] + substitutionCost // substitution
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }
  
  // 5-Layer Voice Verification System
  multiLayerVerification(currentFeatures, context = 'general') {
    if (!this.voiceprint || !currentFeatures) {
      return { isVerified: false, confidence: 0, layers: [], reason: "No voiceprint available" };
    }
    
    console.log(`🔒 Starting 5-layer verification (context: ${context})`);
    
    const layers = [
      { name: "Energy Pattern", weight: 0.15, threshold: 0.4 },        // Lowered from 0.6
      { name: "Fundamental Frequency", weight: 0.25, threshold: 0.5 },  // Lowered from 0.7
      { name: "Formant Structure", weight: 0.25, threshold: 0.45 },     // Lowered from 0.65
      { name: "Spectral Signature", weight: 0.20, threshold: 0.4 },     // Lowered from 0.6
      { name: "Voice Characteristics", weight: 0.15, threshold: 0.45 }  // Lowered from 0.65
    ];
    
    const layerResults = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;
    
    // Layer 1: Energy Pattern Analysis
    const energyScore = this.verifyEnergyPattern(currentFeatures);
    layerResults.push({
      name: layers[0].name,
      score: energyScore,
      passed: energyScore >= layers[0].threshold,
      weight: layers[0].weight,
      threshold: layers[0].threshold
    });
    totalWeightedScore += energyScore * layers[0].weight;
    totalWeight += layers[0].weight;
    
    // Layer 2: Fundamental Frequency Verification
    const f0Score = this.calculateFrequencySimilarity(
      currentFeatures.fundamentalFreq,
      this.voiceprint.fundamentalFreq,
      this.voiceprint.fundamentalFreqStd
    );
    layerResults.push({
      name: layers[1].name,
      score: f0Score,
      passed: f0Score >= layers[1].threshold,
      weight: layers[1].weight,
      threshold: layers[1].threshold
    });
    totalWeightedScore += f0Score * layers[1].weight;
    totalWeight += layers[1].weight;
    
    // Layer 3: Formant Structure Analysis
    const formantScore = this.calculateFormantSimilarity(
      currentFeatures.formants,
      this.voiceprint.formants
    );
    layerResults.push({
      name: layers[2].name,
      score: formantScore,
      passed: formantScore >= layers[2].threshold,
      weight: layers[2].weight,
      threshold: layers[2].threshold
    });
    totalWeightedScore += formantScore * layers[2].weight;
    totalWeight += layers[2].weight;
    
    // Layer 4: Spectral Signature Matching
    const spectralScore = this.calculateSpectralSimilarity(currentFeatures);
    layerResults.push({
      name: layers[3].name,
      score: spectralScore,
      passed: spectralScore >= layers[3].threshold,
      weight: layers[3].weight,
      threshold: layers[3].threshold
    });
    totalWeightedScore += spectralScore * layers[3].weight;
    totalWeight += layers[3].weight;
    
    // Layer 5: Voice Characteristics Verification
    const voiceScore = this.calculateVoiceSimilarity(currentFeatures);
    layerResults.push({
      name: layers[4].name,
      score: voiceScore,
      passed: voiceScore >= layers[4].threshold,
      weight: layers[4].weight,
      threshold: layers[4].threshold
    });
    totalWeightedScore += voiceScore * layers[4].weight;
    totalWeight += layers[4].weight;
    
    // Calculate overall confidence
    const overallConfidence = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
    
    // Determine verification thresholds based on context - Made more lenient for better usability
    const contextThresholds = {
      'wake_word': 0.45,     // More lenient for wake word (was 0.75)
      'command': 0.40,       // More lenient for commands (was 0.70)
      'general': 0.35        // More lenient for general (was 0.65)
    };
    
    const requiredThreshold = contextThresholds[context] || contextThresholds['general'];
    
    // Count passed layers - Made more lenient
    const passedLayers = layerResults.filter(layer => layer.passed).length;
    const requiredLayers = Math.ceil(layers.length * 0.4); // Need at least 40% of layers (2/5 instead of 3/5)
    
    // Final verification decision
    const isVerified = overallConfidence >= requiredThreshold && passedLayers >= requiredLayers;
    
    const result = {
      isVerified: isVerified,
      confidence: overallConfidence,
      passedLayers: passedLayers,
      totalLayers: layers.length,
      requiredLayers: requiredLayers,
      layers: layerResults,
      threshold: requiredThreshold,
      context: context
    };
    
    console.log(`🔒 Multi-layer verification: ${isVerified ? 'PASSED' : 'FAILED'}`);
    console.log(`🔒 Confidence: ${(overallConfidence * 100).toFixed(1)}% (required: ${(requiredThreshold * 100).toFixed(1)}%)`);
    console.log(`🔒 Layers passed: ${passedLayers}/${layers.length} (required: ${requiredLayers})`);
    
    return result;
  }
  
  verifyEnergyPattern(currentFeatures) {
    // Analyze energy distribution and patterns
    const currentEnergy = currentFeatures.energy;
    const voiceprintEnergy = this.voiceprint.energy;
    const energyStd = this.voiceprint.energyStd || 0.1;
    
    if (currentEnergy === 0 || voiceprintEnergy === 0) return 0;
    
    // Energy similarity
    const energyDiff = Math.abs(currentEnergy - voiceprintEnergy);
    const tolerance = Math.max(energyStd * 2, 0.05);
    const energySimilarity = Math.exp(-Math.pow(energyDiff / tolerance, 2));
    
    // Zero crossing rate similarity (speech pattern)
    const zcrDiff = Math.abs(currentFeatures.zeroCrossingRate - this.voiceprint.zeroCrossingRate);
    const zcrTolerance = 0.05;
    const zcrSimilarity = Math.exp(-Math.pow(zcrDiff / zcrTolerance, 2));
    
    // Combined energy pattern score
    return (energySimilarity * 0.6 + zcrSimilarity * 0.4);
  }
}

// Initialize when page loads
let voiceControl;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    voiceControl = new YouTubeVoiceControl();
  });
} else {
  voiceControl = new YouTubeVoiceControl();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (voiceControl) {
    voiceControl.duckAudio(false);  // Restore volume
    voiceControl.stopListening();
  }
});