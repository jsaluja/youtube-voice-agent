console.log("🎤 Background script loaded");

// Enable side panel globally
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // Enable side panel for this tab
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: 'sidepanel.html',
    enabled: true
  });
}); 