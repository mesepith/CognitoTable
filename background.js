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
            } else if (details.reason === 'update') {
                this.handleExtensionUpdate(details.previousVersion);
            }
            
            this.initializeBadge();
        });
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.action) {
                case 'updateBadge':
                    this.updateBadgeCount(sender.tab.id, request.count);
                    break;
                
                case 'getTabInfo':
                    this.getTabInfo(sender.tab.id).then(info => {
                        sendResponse(info);
                    });
                    return true;
                
                case 'logAnalytics':
                    this.logAnalyticsEvent(request.event, request.data);
                    break;
                
                case 'cacheTableData':
                    this.cacheTableData(sender.tab.id, request.tables);
                    break;
                
                case 'getCachedTableData':
                    this.getCachedTableData(sender.tab.id).then(data => {
                        sendResponse(data);
                    });
                    return true;
                
                default:
                    console.warn('Unknown message action:', request.action);
            }
        });
    }

    setupTabUpdateListener() {
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.url) {
                this.handleTabComplete(tabId, tab);
            }
        });

        chrome.tabs.onRemoved.addListener((tabId) => {
            this.cleanupTabData(tabId);
        });
    }

    setupActionListener() {
        chrome.action.onClicked.addListener((tab) => {
            this.handleActionClick(tab);
        });
    }

    showWelcomeNotification() {
        try {
            chrome.notifications.create('welcome', {
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'CognitoTable Installed!',
                message: 'Click the extension icon on any webpage to start extracting tabular data with AI-powered precision.'
            });
        } catch (error) {
            console.log('CognitoTable installed successfully');
        }
    }

    handleExtensionUpdate(previousVersion) {
        console.log(`CognitoTable updated from ${previousVersion}`);
        
        this.migrateUserData(previousVersion);
    }

    async migrateUserData(previousVersion) {
        try {
            if (this.compareVersions(previousVersion, '1.0.0') < 0) {
                console.log('Migrating data from pre-1.0.0');
                // Add migration logic here if needed
            }
            
        } catch (error) {
            console.error('Error migrating user data:', error);
        }
    }

    compareVersions(a, b) {
        const aParts = a.split('.').map(Number);
        const bParts = b.split('.').map(Number);
        
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const aPart = aParts[i] || 0;
            const bPart = bParts[i] || 0;
            
            if (aPart < bPart) return -1;
            if (aPart > bPart) return 1;
        }
        
        return 0;
    }

    initializeBadge() {
        chrome.action.setBadgeBackgroundColor({ color: '#667eea' });
        chrome.action.setBadgeText({ text: '' });
    }

    updateBadgeCount(tabId, count) {
        if (count > 0) {
            chrome.action.setBadgeText({ 
                tabId: tabId, 
                text: count.toString() 
            });
            chrome.action.setTitle({ 
                tabId: tabId, 
                title: `CognitoTable - ${count} table${count === 1 ? '' : 's'} detected` 
            });
        } else {
            chrome.action.setBadgeText({ tabId: tabId, text: '' });
            chrome.action.setTitle({ 
                tabId: tabId, 
                title: 'CognitoTable - No tables detected' 
            });
        }
    }

    async getTabInfo(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            return {
                url: tab.url,
                title: tab.title,
                favIconUrl: tab.favIconUrl
            };
        } catch (error) {
            console.error('Error getting tab info:', error);
            return null;
        }
    }

    logAnalyticsEvent(event, data) {
        const analyticsData = {
            event: event,
            timestamp: Date.now(),
            data: data
        };
        
        console.log('Analytics:', analyticsData);
        
        chrome.storage.local.get(['analytics'], (result) => {
            const analytics = result.analytics || [];
            analytics.push(analyticsData);
            
            if (analytics.length > 1000) {
                analytics.splice(0, analytics.length - 1000);
            }
            
            chrome.storage.local.set({ analytics });
        });
    }

    async cacheTableData(tabId, tables) {
        try {
            const cacheKey = `tables_${tabId}`;
            const cacheData = {
                tables: tables,
                timestamp: Date.now(),
                url: (await chrome.tabs.get(tabId)).url
            };
            
            chrome.storage.session.set({ [cacheKey]: cacheData });
            
            this.logAnalyticsEvent('tables_cached', {
                tabId: tabId,
                tableCount: tables.length
            });
            
        } catch (error) {
            console.error('Error caching table data:', error);
        }
    }

    async getCachedTableData(tabId) {
        try {
            const cacheKey = `tables_${tabId}`;
            const result = await chrome.storage.session.get([cacheKey]);
            const cached = result[cacheKey];
            
            if (cached && (Date.now() - cached.timestamp < 300000)) {
                return cached.tables;
            }
            
            return null;
        } catch (error) {
            console.error('Error getting cached table data:', error);
            return null;
        }
    }

    handleTabComplete(tabId, tab) {
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            return;
        }

        this.updateBadgeCount(tabId, 0);
        
        setTimeout(() => {
            this.triggerTableScan(tabId);
        }, 1000);
    }

    async triggerTableScan(tabId) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    if (window.cognitoTable && typeof window.cognitoTable.performInitialScan === 'function') {
                        window.cognitoTable.performInitialScan();
                    }
                }
            });
        } catch (error) {
            console.error('Error triggering table scan:', error);
        }
    }

    cleanupTabData(tabId) {
        const cacheKey = `tables_${tabId}`;
        chrome.storage.session.remove([cacheKey]);
    }

    handleActionClick(tab) {
        this.logAnalyticsEvent('action_clicked', {
            tabId: tab.id,
            url: tab.url
        });
    }
}

const cognitoTableBackground = new CognitoTableBackground();