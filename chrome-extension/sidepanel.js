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

function performSearch() {
  const query = searchInput.value.trim();
  
  if (!query) {
    showStatus('Please enter a search term', 'error');
    return;
  }
  
  if (!currentTab) {
    showStatus('No active YouTube tab found', 'error');
    return;
  }
  
  console.log("🔍 Searching for:", query);
  showStatus('Searching transcript...', 'loading');
  searchBtn.disabled = true;
  
  // Clear previous results
  resultsList.innerHTML = '';
  noResults.style.display = 'none';
  
  // Send search request to content script
  chrome.tabs.sendMessage(currentTab.id, {
    type: 'searchTranscript',
    query: query
  }, (response) => {
    searchBtn.disabled = false;
    
    if (chrome.runtime.lastError) {
      console.error("Search failed:", chrome.runtime.lastError);
      showStatus('Failed to search transcript', 'error');
      return;
    }
    
    if (!response) {
      showStatus('No response from page', 'error');
      return;
    }
    
    if (response.success && response.results && response.results.length > 0) {
      hideStatus();
      displayResults(response.results, query);
    } else {
      hideStatus();
      noResults.style.display = 'block';
    }
  });
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

function jumpToTimestamp(timestamp) {
  console.log(`🔍 Jumping to timestamp: ${timestamp}s`);
  
  if (!currentTab) {
    showStatus('No active tab found', 'error');
    return;
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
