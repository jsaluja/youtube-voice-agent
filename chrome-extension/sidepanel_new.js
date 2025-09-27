console.log("🎤 Side panel script loaded");

let currentTab = null;
let isListening = false;
let isTraining = false;

// Get current tab when panel opens
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    currentTab = tabs[0];
    console.log("🎤 Current tab:", currentTab.url);
  }
});

// Add event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  console.log("🎤 Side panel DOM loaded");
  
  // Listening button
  const listeningBtn = document.getElementById('listening-btn');
  if (listeningBtn) {
    listeningBtn.addEventListener('click', toggleListening);
  }
  
  // Training button
  const trainingBtn = document.getElementById('training-btn');
  if (trainingBtn) {
    trainingBtn.addEventListener('click', toggleTraining);
  }
  
  // Close search results button
  const closeSearchBtn = document.getElementById('close-search-btn');
  if (closeSearchBtn) {
    closeSearchBtn.addEventListener('click', function() {
      hideSearchResults();
    });
  }
  
  updateButtonStates();
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("🎤 Side panel received message:", message);
  
  if (message.type === 'trainingUpdate') {
    updateTrainingProgress(message.data);
  } else if (message.type === 'trainingComplete') {
    trainingComplete();
  } else if (message.type === 'trainingCancelled') {
    trainingCancelled();
  } else if (message.type === 'showSearchResults') {
    console.log("🔍 Received showSearchResults message:", message.data);
    showSearchResults(message.data);
  }
});

function toggleListening() {
  console.log("🎤 Toggle listening clicked");
  
  if (!currentTab) {
    console.error("No current tab found");
    return;
  }
  
  isListening = !isListening;
  
  // Send message to content script
  const messageType = isListening ? 'startListening' : 'stopListening';
  chrome.tabs.sendMessage(currentTab.id, { type: messageType }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error sending listening message:", chrome.runtime.lastError);
      isListening = !isListening; // Revert on error
    } else {
      console.log(`Listening ${isListening ? 'started' : 'stopped'} successfully`);
    }
    updateButtonStates();
  });
}

function toggleTraining() {
  console.log("🎯 Toggle training clicked");
  
  if (!currentTab) {
    console.error("No current tab found");
    return;
  }
  
  if (isTraining) {
    // Stop training
    chrome.tabs.sendMessage(currentTab.id, { type: 'stopTraining' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error stopping training:", chrome.runtime.lastError);
      } else {
        console.log("Training stopped successfully");
      }
    });
  } else {
    // Start training
    chrome.tabs.sendMessage(currentTab.id, { type: 'startTraining' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error starting training:", chrome.runtime.lastError);
      } else {
        console.log("Training started successfully");
        isTraining = true;
        showTrainingInterface();
        updateButtonStates();
      }
    });
  }
}

function updateButtonStates() {
  const listeningBtn = document.getElementById('listening-btn');
  const listeningIcon = document.getElementById('listening-icon');
  const listeningText = document.getElementById('listening-text');
  const trainingBtn = document.getElementById('training-btn');
  const trainingIcon = document.getElementById('training-icon');
  const trainingText = document.getElementById('training-text');
  const statusText = document.getElementById('status-text');
  
  if (listeningBtn && listeningIcon && listeningText) {
    if (isListening) {
      listeningBtn.classList.add('active');
      listeningIcon.textContent = '🔴';
      listeningText.textContent = 'Stop Listening';
    } else {
      listeningBtn.classList.remove('active');
      listeningIcon.textContent = '🎤';
      listeningText.textContent = 'Start Listening';
    }
  }
  
  if (trainingBtn && trainingIcon && trainingText) {
    if (isTraining) {
      trainingBtn.classList.add('training');
      trainingIcon.textContent = '⏹️';
      trainingText.textContent = 'Stop Training';
    } else {
      trainingBtn.classList.remove('training');
      trainingIcon.textContent = '🎯';
      trainingText.textContent = 'Start Training';
    }
  }
  
  if (statusText) {
    let status = '';
    if (isListening && isTraining) {
      status = 'Voice training in progress...';
    } else if (isListening) {
      status = 'Listening for voice commands on YouTube.';
    } else if (isTraining) {
      status = 'Voice training in progress...';
    } else {
      status = 'Click "Start Listening" to enable voice commands on YouTube.<br>Click "Start Training" to train your voice if needed.';
    }
    statusText.innerHTML = status;
  }
}

function showTrainingInterface() {
  console.log("🎯 Showing training interface");
  document.getElementById('training-container').style.display = 'block';
}

function hideTrainingInterface() {
  console.log("🎯 Hiding training interface");
  document.getElementById('training-container').style.display = 'none';
}

function updateTrainingProgress(data) {
  console.log("📊 Updating training progress:", data);
  
  // Update phrase counter
  const counter = document.getElementById('phrase-counter');
  if (counter) {
    counter.textContent = `${data.currentPhrase} / ${data.totalPhrases}`;
  }
  
  // Update progress bar
  const progressBar = document.getElementById('progress-bar');
  if (progressBar) {
    const percentage = (data.currentPhrase / data.totalPhrases) * 100;
    progressBar.style.width = `${percentage}%`;
  }
  
  // Update current phrase
  const phraseElement = document.getElementById('current-phrase');
  if (phraseElement) {
    phraseElement.textContent = `"${data.phrase}"`;
  }
  
  // Update status
  const statusElement = document.getElementById('training-status');
  if (statusElement) {
    statusElement.textContent = data.status;
  }
}

function trainingComplete() {
  console.log("✅ Training complete");
  isTraining = false;
  hideTrainingInterface();
  updateButtonStates();
}

function trainingCancelled() {
  console.log("❌ Training cancelled");
  isTraining = false;
  hideTrainingInterface();
  updateButtonStates();
}

function showSearchResults(searchData) {
  console.log("🔍 Displaying search results:", searchData);
  
  // Show search results container
  const searchContainer = document.getElementById('search-results-container');
  if (!searchContainer) {
    console.error("🔍 ❌ No search-results-container found in DOM!");
    return;
  }
  
  searchContainer.style.display = 'block';
  
  // Set search query
  const queryElement = document.getElementById('search-query-text');
  if (queryElement) {
    queryElement.textContent = searchData.query;
  } else {
    console.error("🔍 ❌ No search-query-text element found!");
  }
  
  // Populate results
  const resultsContainer = document.getElementById('search-results-list');
  if (!resultsContainer) {
    console.error("🔍 ❌ No search-results-list element found!");
    return;
  }
  
  resultsContainer.innerHTML = '';
  
  if (!searchData.results || searchData.results.length === 0) {
    console.error("🔍 ❌ No search results provided!");
    return;
  }
  
  console.log(`🔍 ✅ Creating ${searchData.results.length} search result items`);
  
  searchData.results.forEach((result, index) => {
    const resultElement = document.createElement('div');
    resultElement.className = `search-result-item ${index === 0 ? 'first-result' : ''}`;
    
    // Format timestamp
    const minutes = Math.floor(result.start / 60);
    const seconds = Math.floor(result.start % 60);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    // Highlight search terms in text
    let highlightedText = result.text;
    const searchTerms = searchData.query.toLowerCase().split(/\s+/);
    searchTerms.forEach(term => {
      const regex = new RegExp(`(${term})`, 'gi');
      highlightedText = highlightedText.replace(regex, '<span class="search-result-highlight">$1</span>');
    });
    
    resultElement.innerHTML = `
      <div class="search-result-header">
        ${index === 0 ? '▶️ ' : ''}${timeStr} - ${result.matchType} (${result.score}%)
      </div>
      <div class="search-result-text">${highlightedText}</div>
    `;
    
    // Add click handler to jump to timestamp
    resultElement.addEventListener('click', () => {
      jumpToTimestamp(result.start);
    });
    
    resultsContainer.appendChild(resultElement);
    console.log(`🔍 ✅ Added result item ${index + 1}: ${timeStr}`);
  });
  
  console.log("🔍 ✅ Search results display complete");
}

function hideSearchResults() {
  console.log("🔍 Hiding search results");
  const searchContainer = document.getElementById('search-results-container');
  if (searchContainer) {
    searchContainer.style.display = 'none';
  }
}

function jumpToTimestamp(timestamp) {
  console.log(`🔍 Jumping to timestamp: ${timestamp}s`);
  
  if (!currentTab) {
    console.error("No current tab found");
    return;
  }
  
  // Send message to content script to jump to timestamp
  chrome.tabs.sendMessage(currentTab.id, {
    type: 'jumpToTimestamp',
    timestamp: timestamp
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error sending jump message:", chrome.runtime.lastError);
    } else {
      console.log("Jump command sent successfully");
    }
  });
}