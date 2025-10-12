console.log("🔍 Transcript Search Panel loaded");

let currentTab = null;

// Get current tab when panel opens
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    currentTab = tabs[0];
    console.log("🔍 Current tab:", currentTab.url);
  }
});

// Global DOM elements
let searchInput, searchBtn, statusMessage, resultsList, noResults, resultsSummary;
let totalVideos = 0;
let totalChunks = 0;

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
  
  // Get DOM elements and assign to global variables
  searchInput = document.getElementById('search-input');
  searchBtn = document.getElementById('search-btn');
  resultsList = document.getElementById('results-list');
  noResults = document.getElementById('no-results');
  statusMessage = document.getElementById('status-message');
  resultsSummary = document.getElementById('results-summary');
  
  // Add event listeners
  if (searchBtn) {
    searchBtn.addEventListener('click', function() {
      console.log("🔍 Search button clicked!");
      performSearch();
    });
    console.log("🔍 Search button event listener added");
  } else {
    console.error("❌ Search button not found!");
  }
  
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        console.log("🔍 Enter key pressed!");
        performSearch();
      }
    });
    // Auto-focus search input
    searchInput.focus();
    console.log("🔍 Search input event listener added");
  } else {
    console.error("❌ Search input not found!");
  }
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
  console.log("🔍 performSearch() function called");
  
  if (!searchInput) {
    console.error("❌ searchInput is null in performSearch");
    return;
  }
  
  const query = searchInput.value.trim();
  console.log("🔍 Query value:", query);
  
  if (!query) {
    console.log("🔍 Empty query, showing error");
    showStatus('Please enter a search term', 'error');
    return;
  }
  
  console.log("🔍 YoutubeAgent searching for:", query);
  showStatus('Searching YouTube videos...', 'loading');
  searchBtn.disabled = true;
  
  // Clear previous results and reset counters
  resultsList.innerHTML = '';
  noResults.style.display = 'none';
  if (resultsSummary) {
    resultsSummary.classList.remove('show');
  }
  totalVideos = 0;
  totalChunks = 0;
  
  try {
    // Step 1: Search for videos using YoutubeAgent
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
          } else {
            console.error(`No chunks found for video ${video.video_id}:`, rankData);
          }
        } else {
          console.error(`Rank request failed for video ${video.video_id}:`, rankResponse.status);
          const errorData = await rankResponse.text();
          console.error('Error details:', errorData);
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
    console.error("YoutubeAgent search error:", error);
    showStatus(`Search failed: ${error.message}`, 'error');
    noResults.style.display = 'block';
  } finally {
    searchBtn.disabled = false;
  }
}

function displayReflexResults(chunks, query, video) {
  console.log("🔍 Displaying", chunks.length, "ranked chunks for video:", video.title);
  
  // Update results summary
  updateResultsSummary(chunks.length, video.title);
  
  // Create main video card container
  const videoCard = document.createElement('div');
  videoCard.className = 'video-card';
  
  // Video header with collapse toggle
  const videoHeader = document.createElement('div');
  videoHeader.className = 'video-header';
  videoHeader.innerHTML = `
    <div class="video-info">
      <h3>📹 ${video.title}</h3>
      <p>Channel: ${video.channel} • ${chunks.length} relevant moments</p>
    </div>
    <div class="collapse-toggle expanded">▶</div>
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
    
    const relevancePercent = (chunk.relevance_score * 100).toFixed(1);
    const cardId = `chunk-${video.video_id}-${chunk.start_time}`;
    
    timestampCard.innerHTML = `
      <div class="timestamp-header">
        ⏯️ ${timeStr} | 🎯 ${relevancePercent}% relevant
      </div>
      <div class="timestamp-text">
        ${highlightedText}
      </div>
      <div class="rating-container">
        <span class="rating-label">Rate relevance:</span>
        <div class="star-rating" data-chunk-id="${cardId}">
          <span class="star" data-rating="1">★</span>
          <span class="star" data-rating="2">★</span>
          <span class="star" data-rating="3">★</span>
          <span class="star" data-rating="4">★</span>
          <span class="star" data-rating="5">★</span>
        </div>
        <span class="rating-feedback">Thanks!</span>
      </div>
    `;

    // Add click handler for timestamp (not rating area)
    const timestampHeader = timestampCard.querySelector('.timestamp-header');
    const timestampText = timestampCard.querySelector('.timestamp-text');

    [timestampHeader, timestampText].forEach(element => {
      element.addEventListener('click', () => {
        jumpToTimestamp(chunk.start_time, video.video_id);
        logInteraction(query, video.video_id, chunk, 'click');
      });
    });

    // Add star rating functionality
    setupStarRating(timestampCard, query, video, chunk);

    timestampsContainer.appendChild(timestampCard);
  });

  // Add collapse functionality
  videoHeader.addEventListener('click', () => {
    const toggle = videoHeader.querySelector('.collapse-toggle');
    const isExpanded = toggle.classList.contains('expanded');

    if (isExpanded) {
      // Collapse
      toggle.classList.remove('expanded');
      timestampsContainer.classList.add('collapsed');
      videoCard.classList.add('collapsed');
    } else {
      // Expand
      toggle.classList.add('expanded');
      timestampsContainer.classList.remove('collapsed');
      videoCard.classList.remove('collapsed');
    }
  });

  // Add timestamps container to video card
  videoCard.appendChild(timestampsContainer);

  // Add the complete video card to results
  resultsList.appendChild(videoCard);
}

function updateResultsSummary(chunksCount, videoTitle) {
  if (!resultsSummary) return;
  
  // Update global counters
  totalVideos++;
  totalChunks += chunksCount;
  
  // Show summary
  resultsSummary.innerHTML = `
    📊 Found ${totalChunks} relevant moments across ${totalVideos} video${totalVideos > 1 ? 's' : ''}
  `;
  resultsSummary.classList.add('show');
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

// Session management
let sessionId = null;

function getSessionId() {
  if (!sessionId) {
    sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }
  return sessionId;
}

function setupStarRating(timestampCard, query, video, chunk) {
  const starRating = timestampCard.querySelector('.star-rating');
  const stars = starRating.querySelectorAll('.star');
  const feedback = timestampCard.querySelector('.rating-feedback');
  
  let currentRating = 0;
  
  stars.forEach((star, index) => {
    const rating = index + 1;
    
    // Hover effects
    star.addEventListener('mouseenter', () => {
      highlightStars(stars, rating);
    });
    
    star.addEventListener('mouseleave', () => {
      highlightStars(stars, currentRating);
    });
    
    // Click to rate
    star.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent timestamp jump
      currentRating = rating;
      highlightStars(stars, rating);
      
      // Show feedback
      feedback.classList.add('show');
      setTimeout(() => {
        feedback.classList.remove('show');
      }, 2000);
      
      // Send rating to server
      sendRating(query, video, chunk, rating);
    });
  });
}

function highlightStars(stars, rating) {
  stars.forEach((star, index) => {
    star.classList.remove('active', 'hover');
    if (index < rating) {
      star.classList.add('active');
    }
  });
}

function sendRating(query, video, chunk, rating) {
  const ratingData = {
    type: 'rating',
    session_id: getSessionId(),
    query: query,
    video_id: video.video_id,
    chunk_start_time: chunk.start_time,
    chunk_end_time: chunk.end_time,
    chunk_text: chunk.text,
    relevance_score: chunk.relevance_score,
    rating: rating
  };
  
  fetch('http://127.0.0.1:5000/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(ratingData)
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      console.log(`✅ Rating ${rating}/5 saved for chunk at ${chunk.start_time}s`);
    } else {
      console.error('❌ Failed to save rating:', data.error);
    }
  })
  .catch(error => {
    console.error('❌ Error sending rating:', error);
  });
}

function logInteraction(query, videoId, chunk, actionType, timeSpent = 0) {
  const interactionData = {
    type: 'interaction',
    session_id: getSessionId(),
    query: query,
    video_id: videoId,
    chunk_start_time: chunk.start_time,
    chunk_end_time: chunk.end_time,
    chunk_text: chunk.text,
    relevance_score: chunk.relevance_score,
    action_type: actionType,
    time_spent: timeSpent
  };
  
  fetch('http://127.0.0.1:5000/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(interactionData)
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      console.log(`✅ ${actionType} interaction logged for ${videoId}`);
    }
  })
  .catch(error => {
    console.error('❌ Error logging interaction:', error);
  });
}
