/**
 * @author : Zahir
 * Desc : Content script for Cognito Table Chrome Extension - Main Controller
 */
class CognitoTableContentScript {
    constructor() {
        console.log('CognitoTableContentScript constructor called');
        this.mutationObserver = null;
        this.debounceTimer = null;
        this.isAnalyzing = false;

        // Initialize helper modules
        this.domUtils = new DomUtils();
        this.tableAnalyzer = new TableAnalyzer(this.domUtils);
        this.virtualizedHandler = new VirtualizedTableHandler(this.tableAnalyzer, this.domUtils);
        this.tableScanner = new TableScanner(this.domUtils, this.tableAnalyzer);

        this.init();
    }

    init() {
        console.log('CognitoTableContentScript initializing...');
        this.setupMutationObserver();
        this.setupMessageListener();
        // The initial scan is now triggered by the background script for the badge count
        console.log('CognitoTableContentScript initialization complete');
    }

    setupMutationObserver() {
        this.mutationObserver = new MutationObserver(() => this.debouncedAnalysis());
        this.mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: false });
    }
    
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.action) {
                case 'getTables':
                    this.scanWithRetry()
                        .then(tables => sendResponse({ tables: tables }))
                        .catch(error => sendResponse({ error: error.message }));
                    return true; // Indicates an async response
                case 'highlightTable':
                    this.domUtils.highlightElement(request.selector);
                    sendResponse({ success: true });
                    break;
                case 'unhighlightTable':
                    this.domUtils.unhighlightElement(request.selector);
                    sendResponse({ success: true });
                    break;
                case 'extractTable':
                    this.extractTableData(request.selector)
                        .then(data => sendResponse({ data }))
                        .catch(error => sendResponse({ data: null, error: error.message }));
                    return true; // Indicates an async response
            }
        });
    }

    debouncedAnalysis() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.performIncrementalScan(), 500);
    }

    async performInitialScan() {
        // This is kept for potential future use or manual triggering.
        if (this.isAnalyzing) return;
        this.isAnalyzing = true;
        try {
            const tables = await this.scanForBadgeUpdate();
            this.updateBadgeCount(tables.length);
        } catch (error) {
            console.error('CognitoTable: Error during initial scan:', error);
        } finally {
            this.isAnalyzing = false;
        }
    }

    async performIncrementalScan() {
        if (this.isAnalyzing) return;
        this.isAnalyzing = true;
        try {
            const tables = await this.scanForBadgeUpdate();
            // Clear the session cache as the page has changed
            chrome.runtime.sendMessage({ action: 'clearCache' }).catch(() => {});
            this.updateBadgeCount(tables.length);
        } catch (error) {
            console.error('CognitoTable: Error during incremental scan:', error);
        } finally {
            this.isAnalyzing = false;
        }
    }
    
    async scanForBadgeUpdate() {
        const explicit = this.tableScanner.findExplicitTables();
        const implicit = await this.tableScanner.findImplicitTables();
        return [...explicit, ...implicit.map(c => c.element)];
    }

    async scanWithRetry(maxRetries = 3, delay = 1000) {
        let allFoundTables = [];
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            allFoundTables = await this.scanAndProcessTables();
            if (allFoundTables.length > 0) break;
            if (attempt < maxRetries) await Utils.sleep(delay);
        }
        
        // Cache the final results in the background script
        chrome.runtime.sendMessage({ action: 'cacheTableData', tables: allFoundTables });

        // Final completion message
        const iframes = Array.from(document.querySelectorAll('iframe')).map(iframe => ({
            src: iframe.src,
            title: iframe.title,
            sameOrigin: this.isSameOrigin(iframe.src)
        }));
        chrome.runtime.sendMessage({ action: 'scanComplete', iframes });
        
        return allFoundTables;
    }

    isSameOrigin(url) {
        try {
            return new URL(url).origin === window.location.origin;
        } catch (e) {
            return false;
        }
    }

    /**
     * Prefer explicit table extraction unless the virtualized/implicit pass yields
     * *more unique* rows (after header-normalization).
     */
    async scanAndProcessTables() {
        const seenContent = new Map();
        let tableId = 0;
        const allFoundTables = [];

        const uniqueCount = (rows) => {
            const s = new Set(rows.map(r => (r || []).join('|')));
            return s.size;
        };

        // --- EXPLICIT TABLES ---
        const explicitTables = this.tableScanner.findExplicitTables();
        for (const tableElement of explicitTables) {
            let tableData = await this.tableAnalyzer.analyzeExplicitTable(tableElement);
            if (!tableData || tableData.rows.length === 0) continue;

            // Consider the "virtualized" enhancement only if it provides *more unique rows*
            if (this.virtualizedHandler.detectVirtualizedTable(tableElement)) {
                const enhancedData = await this.virtualizedHandler.extractVirtualizedTableData(tableElement);
                if (enhancedData) {
                    const baseUnique = uniqueCount(tableData.rows);
                    const enhUnique  = uniqueCount(enhancedData.rows);
                    if (enhUnique > baseUnique) {
                        tableData = enhancedData;
                    }
                }
            }
            
            const signature = Utils.createTableContentSignature(tableData);
            if (seenContent.has(signature)) continue;
            seenContent.set(signature, true);
            tableId++;

            const tableObject = {
                id: tableId,
                type: 'explicit',
                confidence: 0.95,
                element: this.domUtils.getElementSelector(tableElement),
                data: tableData,
                preview: Utils.generatePreview(tableData)
            };
            
            chrome.runtime.sendMessage({ action: 'tableFound', table: tableObject });
            allFoundTables.push(tableObject);
        }

        // --- IMPLICIT TABLES ---
        const implicitCandidates = await this.tableScanner.findImplicitTables();
        for (const candidate of implicitCandidates) {
            let tableData = await this.tableAnalyzer.analyzeImplicitTable(candidate.element);
            if (!tableData || tableData.rows.length <= 1) continue;

            if (this.virtualizedHandler.detectVirtualizedTable(candidate.element)) {
                const enhancedData = await this.virtualizedHandler.extractVirtualizedTableData(candidate.element);
                if (enhancedData) {
                    const baseUnique = uniqueCount(tableData.rows);
                    const enhUnique  = uniqueCount(enhancedData.rows);
                    if (enhUnique > baseUnique) {
                        tableData = enhancedData;
                    }
                }
            }

            const signature = Utils.createTableContentSignature(tableData);
            if (seenContent.has(signature)) continue;
            seenContent.set(signature, true);
            tableId++;

            const tableObject = {
                id: tableId,
                type: 'implicit',
                confidence: candidate.confidence,
                element: this.domUtils.getElementSelector(candidate.element),
                data: tableData,
                preview: Utils.generatePreview(tableData)
            };

            chrome.runtime.sendMessage({ action: 'tableFound', table: tableObject });
            allFoundTables.push(tableObject);
        }
        
        this.updateBadgeCount(allFoundTables.length);
        return allFoundTables;
    }

    async extractTableData(selector) {
        const element = document.querySelector(selector);
        if (!element) return null;

        if (element.tagName.toLowerCase() === 'table') {
            return await this.tableAnalyzer.analyzeExplicitTable(element);
        } else {
            return await this.tableAnalyzer.analyzeImplicitTable(element);
        }
    }

    updateBadgeCount(count) {
        chrome.runtime.sendMessage({ action: 'updateBadge', count: count }).catch(() => {});
    }
    
    destroy() {
        if (this.mutationObserver) this.mutationObserver.disconnect();
        clearTimeout(this.debounceTimer);
    }
}


// --- Global Initialization ---
if (typeof window.cognitoTable === 'undefined') {
    window.cognitoTable = new CognitoTableContentScript();
}
