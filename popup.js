class CognitoTablePopup {
    constructor() {
        this.detectedTables = [];
        this.currentTable = null;
        this.scanInProgress = false;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.setupMessageListener();
        this.loadInitialState();
    }

    setupEventListeners() {
        document.getElementById('rescanPage').addEventListener('click', () => this.rescanPage());
        document.getElementById('manualSelect').addEventListener('click', () => this.activateManualSelection());
        document.getElementById('multiPage').addEventListener('click', () => this.startMultiPageExtraction());
        document.getElementById('backBtn').addEventListener('click', () => this.showMainView());
        document.getElementById('exportCsv').addEventListener('click', () => this.exportData('csv'));
        document.getElementById('exportJson').addEventListener('click', () => this.exportData('json'));
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            // No need to check sender, popup only receives messages intended for it
            switch (request.action) {
                case 'tableFound':
                    this.handleTableFound(request.table);
                    break;
                case 'scanComplete':
                    this.handleScanComplete(request);
                    break;
            }
        });
    }

    async loadInitialState() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (this.isRestrictedUrl(tab.url)) {
                this.showError('Cannot scan this page (restricted URL)');
                return;
            }

            // Ask the background script for cached data for the current tab
            const cachedTables = await chrome.runtime.sendMessage({ 
                action: 'getCachedTableData',
                tabId: tab.id 
            });

            if (cachedTables && Array.isArray(cachedTables)) {
                // If we have cached data, display it immediately
                if (cachedTables.length > 0) {
                    cachedTables.forEach(table => this.handleTableFound(table));
                } else {
                    // Cache exists but is empty, so we know a scan found nothing
                    this.handleScanComplete({ iframes: [] });
                }
            } else {
                // If no valid cache, start a new scan
                this.scanCurrentPage();
            }
        } catch (error) {
            console.error('Error loading initial state:', error);
            this.showError('Could not connect to the page. Please refresh and try again.');
        }
    }


    handleTableFound(table) {
        // Prevent adding duplicates if a table is found live and also loaded from cache
        if (this.detectedTables.some(t => t.id === table.id)) {
            return;
        }

        if (this.detectedTables.length === 0) {
            document.getElementById('status').style.display = 'none';
            document.getElementById('content').style.display = 'block';
            document.getElementById('tableList').innerHTML = '';
        }

        this.detectedTables.push(table);
        this.addTableToView(table);
        document.getElementById('tableCount').textContent = this.detectedTables.length;
    }

    handleScanComplete(response) {
        this.scanInProgress = false;
        
        if (this.detectedTables.length === 0) {
            this.showNoTablesMessage(response.iframes || []);
        }
    }

    async scanCurrentPage() {
        try {
            if (this.scanInProgress) return;
            this.scanInProgress = true;
            
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            this.showStatus('Scanning page for tables...');
            
            // This message now expects a response with the final table list
            chrome.tabs.sendMessage(tab.id, { action: 'getTables' }).catch(error => {
                 console.error('Error initiating scan:', error);
                 this.showError('Could not start scan. Please refresh the page and try again.');
                 this.scanInProgress = false;
            });
            
        } catch (error) {
            console.error('Error in scanCurrentPage:', error);
            this.showError('Failed to scan page: ' + error.message);
            this.scanInProgress = false;
        }
    }
    
    async rescanPage() {
        // Reset UI and internal state for a new scan
        this.detectedTables = [];
        document.getElementById('tableList').innerHTML = '';
        document.getElementById('tableCount').textContent = '0';
        this.scanCurrentPage(); // Re-trigger the scan process
    }

    isRestrictedUrl(url) {
        if (!url) return true;
        const restrictedSchemes = ['chrome://', 'chrome-extension://', 'about:', 'data:', 'file:'];
        return restrictedSchemes.some(scheme => url.startsWith(scheme));
    }

    showNoTablesMessage(iframes) {
        const statusEl = document.getElementById('status');
        const contentEl = document.getElementById('content');
        const tableList = document.getElementById('tableList');

        statusEl.style.display = 'none';
        contentEl.style.display = 'block';

        let noTablesHTML = `
            <div class="no-tables">
                <h4>No tables detected</h4>
                <p>Try using "Rescan Page" or "Manual Selection" to find hidden tabular data.</p>
        `;
        
        if (iframes.length > 0) {
            noTablesHTML += `
                <div class="iframe-notice">
                    <h5 class="iframe-title">🔍 Tables might be in embedded content:</h5>
            `;
            iframes.forEach((iframe, index) => {
                const domain = iframe.src ? new URL(iframe.src).hostname : 'unknown domain';
                noTablesHTML += `
                    <div class="iframe-item">
                        <strong>Iframe ${index + 1}:</strong>
                        <a href="${iframe.src}" target="_blank" title="${iframe.src}">
                            ${domain}
                        </a>
                        <span class="iframe-origin ${iframe.sameOrigin ? 'same' : 'different'}">
                            ${iframe.sameOrigin ? '(Readable)' : '(Cross-domain)'}
                        </span>
                    </div>
                `;
            });
            noTablesHTML += `
                    <p class="iframe-tip">
                        💡 Tip: Try opening the iframe content in a new tab to extract tables.
                    </p>
                </div>
            `;
        }
        
        noTablesHTML += `</div>`;
        tableList.innerHTML = noTablesHTML;
    }
    
    addTableToView(table) {
        const tableList = document.getElementById('tableList');
        const item = this.createTableItem(table);
        tableList.appendChild(item);
    }

    createTableItem(table) {
        const item = document.createElement('div');
        item.className = 'table-item';
        item.dataset.tableId = table.id;

        const confidenceClass = table.confidence >= 0.8 ? 'high' : 
                               table.confidence >= 0.6 ? 'medium' : 'low';

        item.innerHTML = `
            <div class="table-info">
                <span class="table-title">${table.type === 'explicit' ? 'HTML Table' : 'Implicit Table'} #${table.id}</span>
                <span class="confidence-score ${confidenceClass}">${Math.round(table.confidence * 100)}%</span>
            </div>
            <pre class="table-preview-text">${table.preview}</pre>
        `;

        item.addEventListener('click', () => this.viewTable(table));
        item.addEventListener('mouseenter', () => this.highlightTable(table));
        item.addEventListener('mouseleave', () => this.unhighlightTable(table));

        return item;
    }

    async highlightTable(table) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, { 
                action: 'highlightTable', 
                selector: table.element 
            });
        } catch (error) {
            console.error('Error highlighting table:', error);
        }
    }

    async unhighlightTable(table) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, { 
                action: 'unhighlightTable', 
                selector: table.element 
            });
        } catch (error) {
            console.error('Error unhighlighting table:', error);
        }
    }

    viewTable(table) {
        this.currentTable = table;
        this.renderTablePreview(table);
        document.getElementById('content').style.display = 'none';
        document.getElementById('tablePreview').style.display = 'block';
    }

    renderTablePreview(table) {
        const container = document.getElementById('tableContainer');
        const tableElement = document.createElement('table');
        tableElement.className = 'preview-table';

        if (table.data.headers.length > 0) {
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            
            table.data.headers.forEach(header => {
                const th = document.createElement('th');
                th.textContent = header;
                headerRow.appendChild(th);
            });
            
            thead.appendChild(headerRow);
            tableElement.appendChild(thead);
        }

        const tbody = document.createElement('tbody');
        table.data.rows.forEach(row => {
            const tr = document.createElement('tr');
            row.forEach(cell => {
                const td = document.createElement('td');
                td.textContent = cell;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        tableElement.appendChild(tbody);
        container.innerHTML = '';
        container.appendChild(tableElement);
    }

    showMainView() {
        document.getElementById('tablePreview').style.display = 'none';
        document.getElementById('content').style.display = 'block';
    }

    exportData(format) {
        if (!this.currentTable) return;

        const data = this.currentTable.data;
        let content = '';
        let filename = `table_${this.currentTable.id}.${format}`;

        if (format === 'csv') {
            content = this.convertToCSV(data);
        } else if (format === 'json') {
            content = this.convertToJSON(data);
        }

        this.downloadFile(content, filename);
    }

    convertToCSV(data) {
        const rows = [];
        
        if (data.headers.length > 0) {
            rows.push(data.headers.map(header => this.escapeCSV(header)).join(','));
        }
        
        data.rows.forEach(row => {
            rows.push(row.map(cell => this.escapeCSV(cell)).join(','));
        });

        return rows.join('\n');
    }

    escapeCSV(field) {
        // 1. Ensure the field is a string. Handle null/undefined by converting to an empty string.
        const stringField = String(field == null ? '' : field);
    
        // 2. Escape any double quotes inside the field by replacing them with two double quotes.
        const escapedField = stringField.replace(/"/g, '""');
    
        // 3. Enclose the entire result in double quotes to ensure it's treated as a single field,
        //    which protects spaces, commas, and newlines within the content.
        return `"${escapedField}"`;
    }

    convertToJSON(data) {
        const result = [];
        
        data.rows.forEach(row => {
            const obj = {};
            row.forEach((cell, index) => {
                const key = data.headers[index] || `column_${index + 1}`;
                obj[key] = cell;
            });
            result.push(obj);
        });

        return JSON.stringify(result, null, 2);
    }

    downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    activateManualSelection() {
        window.close();
    }

    startMultiPageExtraction() {
        alert('Multi-page extraction feature coming soon!');
    }

    showStatus(message) {
        const statusEl = document.getElementById('status');
        const contentEl = document.getElementById('content');
        
        statusEl.style.display = 'block';
        statusEl.innerHTML = `
            <div class="spinner"></div>
            <span>${message}</span>
        `;
        
        contentEl.style.display = 'none';
    }

    showError(message) {
        const statusEl = document.getElementById('status');
        const contentEl = document.getElementById('content');
        
        statusEl.style.display = 'block';
        statusEl.innerHTML = `
            <div class="error-message">
                <strong>Error:</strong> ${message}
            </div>
        `;
        
        contentEl.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new CognitoTablePopup();
});