class CognitoTableBackground {
    constructor() {
        this.init();
    }

    init() {
        this.setupInstallListener();
        this.setupMessageListener();
        this.setupTabUpdateListener();
        this.setupActionListener();
    }

    setupInstallListener() {
        chrome.runtime.onInstalled.addListener((details) => {
            console.log('CognitoTable installed:', details);
            if (details.reason === 'install') {
                this.showWelcomeNotification();
            }
            this.initializeBadge();
        });
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            const tabId = sender.tab ? sender.tab.id : request.tabId;
            if (!tabId) return;

            switch (request.action) {
                case 'updateBadge':
                    this.updateBadgeCount(tabId, request.count);
                    break;
                case 'cacheTableData':
                    this.cacheTableData(tabId, request.tables);
                    break;
                case 'getCachedTableData':
                    this.getCachedTableData(tabId).then(sendResponse);
                    return true; // Indicates async response
                default:
                    // Default case for unknown actions
                    break;
            }
        });
    }

    setupTabUpdateListener() {
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            // If the tab's URL changes, it's a navigation, so clear the cache.
            if (changeInfo.url) {
                this.cleanupTabData(tabId);
            }
            if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
                this.triggerBadgeScan(tabId);
            }
        });

        chrome.tabs.onRemoved.addListener((tabId) => {
            this.cleanupTabData(tabId);
        });
    }

    setupActionListener() {
        chrome.action.onClicked.addListener((tab) => {
            // Optional: Log analytics on icon click
        });
    }

    showWelcomeNotification() {
        try {
            chrome.notifications.create('welcome', {
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'CognitoTable Installed!',
                message: 'Click the extension icon to start extracting tables from any webpage.'
            });
        } catch (error) {
            console.log('Welcome notification suppressed.');
        }
    }

    initializeBadge() {
        chrome.action.setBadgeBackgroundColor({ color: '#667eea' });
        chrome.action.setBadgeText({ text: '' });
    }

    updateBadgeCount(tabId, count) {
        if (count > 0) {
            chrome.action.setBadgeText({ tabId, text: count.toString() });
            chrome.action.setTitle({ tabId, title: `CognitoTable - ${count} table(s) detected` });
        } else {
            chrome.action.setBadgeText({ tabId, text: '' });
            chrome.action.setTitle({ tabId, title: 'CognitoTable - No tables detected' });
        }
    }

    async cacheTableData(tabId, tables) {
        try {
            const cacheKey = `tables_${tabId}`;
            const cacheData = {
                tables,
                timestamp: Date.now()
            };
            await chrome.storage.session.set({ [cacheKey]: cacheData });
        } catch (error) {
            console.error('Error caching table data:', error);
        }
    }

    async getCachedTableData(tabId) {
        try {
            const cacheKey = `tables_${tabId}`;
            const result = await chrome.storage.session.get([cacheKey]);
            const cached = result[cacheKey];

            // **THE FIX IS HERE:**
            // The strict URL comparison has been removed. We now only check if
            // a recent cache exists. The `onUpdated` listener is responsible
            // for clearing the cache when the user navigates to a new page.
            if (cached && (Date.now() - cached.timestamp < 300000)) { // 5-minute cache
                return cached.tables;
            }

            return null; // Cache is invalid, stale, or doesn't exist
        } catch (error) {
            console.error('Error getting cached table data:', error);
            return null;
        }
    }

    async triggerBadgeScan(tabId) {
        try {
            const [results] = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => window.cognitoTable.scanForBadgeUpdate(),
            });
            if (results && results.result) {
                this.updateBadgeCount(tabId, results.result.length);
            }
        } catch (error) {
            // Error is expected on pages where content script can't run (e.g., chrome web store)
        }
    }

    cleanupTabData(tabId) {
        const cacheKey = `tables_${tabId}`;
        chrome.storage.session.remove([cacheKey]);
        console.log(`Cache cleared for tab ${tabId}`);
    }
}

const cognitoTableBackground = new CognitoTableBackground();