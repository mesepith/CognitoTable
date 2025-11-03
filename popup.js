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
        this.scanCurrentPage();
    }

    setupEventListeners() {
        document.getElementById('deepScan').addEventListener('click', () => this.performDeepScan());
        document.getElementById('manualSelect').addEventListener('click', () => this.activateManualSelection());
        document.getElementById('multiPage').addEventListener('click', () => this.startMultiPageExtraction());
        document.getElementById('backBtn').addEventListener('click', () => this.showMainView());
        document.getElementById('exportCsv').addEventListener('click', () => this.exportData('csv'));
        document.getElementById('exportJson').addEventListener('click', () => this.exportData('json'));
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            // Ensure the message is from the active tab content script
            chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
                if (sender.tab && sender.tab.id === tab.id) {
                    switch (request.action) {
                        case 'tableFound':
                            this.handleTableFound(request.table);
                            break;
                        case 'scanComplete':
                            this.handleScanComplete(request);
                            break;
                    }
                }
            });
        });
    }

    handleTableFound(table) {
        // If this is the first table found, switch from "Scanning" to the content view
        if (this.detectedTables.length === 0) {
            document.getElementById('status').style.display = 'none';
            document.getElementById('content').style.display = 'block';
            document.getElementById('tableList').innerHTML = ''; // Clear status messages
        }

        this.detectedTables.push(table);
        this.addTableToView(table);
        document.getElementById('tableCount').textContent = this.detectedTables.length;
    }

    handleScanComplete(response) {
        this.scanInProgress = false;
        
        // If the scan is finished and we still have no tables, show the 'no tables' message.
        if (this.detectedTables.length === 0) {
            this.showNoTablesMessage(response.iframes || []);
        }
    }

    async scanCurrentPage() {
        try {
            this.scanInProgress = true;
            this.detectedTables = []; // Reset on new scan
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (this.isRestrictedUrl(tab.url)) {
                this.showError('Cannot scan this page (restricted URL)');
                this.scanInProgress = false;
                return;
            }
            
            this.showStatus('Scanning page for tables...');
            
            // Send a message to the content script to start scanning.
            // This is now a "fire and forget" message.
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

    isRestrictedUrl(url) {
        if (!url) return true;
        const restrictedSchemes = ['chrome://', 'chrome-extension://', 'about:', 'data:', 'file:'];
        return restrictedSchemes.some(scheme => url.startsWith(scheme));
    }

    showNoTablesMessage(iframes) {
        const statusEl = document.getElementById('status');
        const contentEl = document.getElementById('content');
        const tableList = document.getElementById('tableList');

        if (statusEl) statusEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
        if (!tableList) return;

        let noTablesHTML = `
            <div class="no-tables">
                <h4>No tables detected</h4>
                <p>Try using "Deep Scan" or "Manual Selection" to find hidden tabular data.</p>
        `;
        
        if (iframes.length > 0) {
            noTablesHTML += `
                <div style="margin-top: 15px; padding: 10px; background: #f0f8ff; border-radius: 5px; border-left: 4px solid #667eea; text-align: left;">
                    <h5 style="margin: 0 0 8px 0; color: #333;">🔍 Tables might be in embedded content:</h5>
            `;
            iframes.forEach((iframe, index) => {
                const domain = iframe.src ? new URL(iframe.src).hostname : 'unknown domain';
                noTablesHTML += `
                    <div style="margin: 5px 0; font-size: 12px;">
                        <strong>Iframe ${index + 1}:</strong><br>
                        <a href="${iframe.src}" target="_blank" style="color: #667eea; text-decoration: none;" title="${iframe.src}">
                            ${domain}
                        </a>
                        <span style="color: ${iframe.sameOrigin ? 'green' : 'orange'}; font-size: 11px;">
                            ${iframe.sameOrigin ? '(Same domain)' : '(Different domain - limited access)'}
                        </span>
                    </div>
                `;
            });
            noTablesHTML += `
                    <p style="margin: 10px 0 0 0; font-size: 11px; color: #666;">
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
        if (!tableList) return;
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
            <div class="table-preview-text">${table.preview}</div>
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
        if (field.includes(',') || field.includes('"') || field.includes('\n')) {
            return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
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
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async performDeepScan() {
        // Reset UI for a new scan
        document.getElementById('tableList').innerHTML = '';
        document.getElementById('tableCount').textContent = '0';
        this.scanCurrentPage(); // Re-trigger the scan process
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
        
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.innerHTML = `
                <div class="spinner"></div>
                <span>${message}</span>
            `;
        }
        
        if (contentEl) {
            contentEl.style.display = 'none';
        }
    }

    showError(message) {
        const statusEl = document.getElementById('status');
        const contentEl = document.getElementById('content');
        
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.innerHTML = `
                <div style="color: #dc3545; padding: 20px;">
                    <strong>Error:</strong> ${message}
                </div>
            `;
        }
        
        if (contentEl) {
            contentEl.style.display = 'none';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new CognitoTablePopup();
});