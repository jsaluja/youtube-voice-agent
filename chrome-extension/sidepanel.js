console.log("🔍 Transcript Search Panel loaded");

let currentTab = null;

// Get current tab when panel opens
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    currentTab = tabs[0];
    console.log("🔍 Current tab:", currentTab.url);
  }
});

// DOM elements
let searchInput, searchBtn, statusMessage, resultsList, noResults;

// Listen for messages from background/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("🔍 Side panel received message:", message);
  
  if (message.type === 'showSearchResults') {
    console.log("🔍 Showing voice search results:", message.data);
    
    // Update search input with the query
    if (searchInput) {
      searchInput.value = message.data.query;
    }
    
    // Display the results
    if (message.data.results && message.data.results.length > 0) {
      hideStatus();
      displayResults(message.data.results, message.data.query);
    } else {
      hideStatus();
      if (noResults) {
        noResults.style.display = 'block';
      }
    }
    
    sendResponse({ success: true });
  }
});

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log("🔍 Side panel DOM loaded");
  
  // Get DOM elements
  searchInput = document.getElementById('search-input');
  searchBtn = document.getElementById('search-btn');
  statusMessage = document.getElementById('status-message');
  resultsList = document.getElementById('results-list');
  noResults = document.getElementById('no-results');
  
  // Add event listeners
  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });
  
  // Auto-focus search input
  searchInput.focus();
});

function showStatus(message, type = 'loading') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message status-${type}`;
  statusMessage.style.display = 'block';
}

function hideStatus() {
  statusMessage.style.display = 'none';
}

async function performSearch() {
  const query = searchInput.value.trim();
  
  if (!query) {
    showStatus('Please enter a search term', 'error');
    return;
  }
  
  console.log("🔍 ReflexAgent searching for:", query);
  showStatus('Searching YouTube videos...', 'loading');
  searchBtn.disabled = true;
  
  // Clear previous results
  resultsList.innerHTML = '';
  noResults.style.display = 'none';
  
  try {
    // Step 1: Search for videos using ReflexAgent
    const searchResponse = await fetch(`http://127.0.0.1:5000/search/${encodeURIComponent(query)}`);
    
    if (!searchResponse.ok) {
      throw new Error(`Search failed: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.json();
    
    if (!searchData.success || !searchData.videos || searchData.videos.length === 0) {
      showStatus('No videos found', 'error');
      searchBtn.disabled = false;
      noResults.style.display = 'block';
      return;
    }
    
    console.log(`🔍 Found ${searchData.videos.length} videos`);
    showStatus('Ranking video chunks...', 'loading');
    
    // Step 2: Process all videos (limit to first 3 for performance)
    const videosToProcess = searchData.videos.slice(0, 3);
    let hasResults = false;
    
    for (const video of videosToProcess) {
      try {
        const rankResponse = await fetch('http://127.0.0.1:5000/rank-chunks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: query,
            video_id: video.video_id
          })
        });
        
        if (rankResponse.ok) {
          const rankData = await rankResponse.json();
          
          if (rankData.success && rankData.chunks && rankData.chunks.length > 0) {
            displayReflexResults(rankData.chunks, query, video);
            hasResults = true;
          }
        }
      } catch (error) {
        console.error(`Error processing video ${video.video_id}:`, error);
        // Continue with next video
      }
    }
    
    if (hasResults) {
      hideStatus();
    } else {
      hideStatus();
      noResults.style.display = 'block';
    }
    
  } catch (error) {
    console.error("ReflexAgent search error:", error);
    showStatus(`Search failed: ${error.message}`, 'error');
    noResults.style.display = 'block';
  } finally {
    searchBtn.disabled = false;
  }
}

function displayReflexResults(chunks, query, video) {
  console.log("🔍 Displaying", chunks.length, "ranked chunks for video:", video.title);
  
  // Create main video card container
  const videoCard = document.createElement('div');
  videoCard.className = 'video-card';
  
  // Video header
  const videoHeader = document.createElement('div');
  videoHeader.className = 'video-header';
  videoHeader.innerHTML = `
    <div class="video-info">
      <h3>📹 ${video.title}</h3>
      <p>Channel: ${video.channel}</p>
    </div>
  `;
  videoCard.appendChild(videoHeader);
  
  // Timestamps container (nested inside video card)
  const timestampsContainer = document.createElement('div');
  timestampsContainer.className = 'timestamps-container';
  
  // Auto-jump to first result
  if (chunks.length > 0) {
    console.log("🔍 Auto-jumping to first result at", chunks[0].start_time, "seconds");
    jumpToTimestamp(chunks[0].start_time, video.video_id);
  }
  
  chunks.forEach((chunk, index) => {
    const timestampCard = document.createElement('div');
    timestampCard.className = 'timestamp-card';
    
    // Format timestamp
    const minutes = Math.floor(chunk.start_time / 60);
    const seconds = Math.floor(chunk.start_time % 60);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    // Highlight search terms
    let highlightedText = chunk.text;
    const searchTerms = query.toLowerCase().split(/\s+/);
    searchTerms.forEach(term => {
      if (term.length > 2) { // Only highlight meaningful words
        const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
        highlightedText = highlightedText.replace(regex, '<span class="highlight">$1</span>');
      }
    });
    
    // Show relevance score
    const relevanceScore = (chunk.relevance_score * 100).toFixed(1);
    
    // Truncate text for better UI (max 150 characters)
    let displayText = highlightedText;
    if (displayText.length > 150) {
      displayText = displayText.substring(0, 150) + '...';
    }
    
    timestampCard.innerHTML = `
      <div class="timestamp-header">
        ⏯️ ${timeStr} | 🎯 ${relevanceScore}% relevant
      </div>
      <div class="timestamp-text">${displayText}</div>
    `;
    
    // Add click handler
    timestampCard.addEventListener('click', () => {
      jumpToTimestamp(chunk.start_time, video.video_id);
    });
    
    timestampsContainer.appendChild(timestampCard);
  });
  
  // Add timestamps container to video card
  videoCard.appendChild(timestampsContainer);
  
  // Add the complete video card to results
  resultsList.appendChild(videoCard);
}

function displayResults(results, query) {
  console.log("🔍 Displaying", results.length, "results before deduplication");
  
  // Final deduplication: Remove duplicates within 4 seconds, keep first one
  const deduplicated = [];
  results.forEach((result) => {
    const isDuplicate = deduplicated.some(existing => 
      Math.abs(existing.start - result.start) < 4
    );
    
    if (!isDuplicate) {
      deduplicated.push(result);
    }
  });
  
  console.log("🔍 Displaying", deduplicated.length, "results after deduplication");
  
  // Auto-jump to first result
  if (deduplicated.length > 0) {
    console.log("🔍 Auto-jumping to first result at", deduplicated[0].start, "seconds");
    jumpToTimestamp(deduplicated[0].start);
  }
  
  deduplicated.forEach((result, index) => {
    const resultElement = document.createElement('div');
    resultElement.className = 'result-item';
    
    // Format timestamp
    const minutes = Math.floor(result.start / 60);
    const seconds = Math.floor(result.start % 60);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    // Highlight search terms
    let highlightedText = result.text;
    const searchTerms = query.toLowerCase().split(/\s+/);
    searchTerms.forEach(term => {
      if (term.length > 2) { // Only highlight meaningful words
        const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
        highlightedText = highlightedText.replace(regex, '<span class="highlight">$1</span>');
      }
    });
    
    resultElement.innerHTML = `
      <div class="result-header">
        ⏯️ ${timeStr}
      </div>
      <div class="result-text">${highlightedText}</div>
    `;
    
    // Add click handler
    resultElement.addEventListener('click', () => {
      jumpToTimestamp(result.start);
    });
    
    resultsList.appendChild(resultElement);
  });
}

function jumpToTimestamp(timestamp, videoId = null) {
  console.log(`🔍 Jumping to timestamp: ${timestamp}s${videoId ? ` in video ${videoId}` : ''}`);
  
  if (!currentTab) {
    showStatus('No active tab found', 'error');
    return;
  }
  
  // If video ID is provided, navigate to that video first
  if (videoId) {
    const currentUrl = currentTab.url;
    const currentVideoId = new URLSearchParams(new URL(currentUrl).search).get('v');
    
    if (currentVideoId !== videoId) {
      // Navigate to the new video
      const newUrl = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(timestamp)}s`;
      chrome.tabs.update(currentTab.id, { url: newUrl });
      return;
    }
  }
  
  chrome.tabs.sendMessage(currentTab.id, {
    type: 'jumpToTimestamp',
    timestamp: timestamp
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Jump failed:", chrome.runtime.lastError);
      showStatus('Failed to jump to timestamp', 'error');
    } else {
      // Jump successful - no status message needed
      hideStatus();
    }
  });
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
