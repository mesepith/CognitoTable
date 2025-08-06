class CognitoTablePopup {
    constructor() {
        this.detectedTables = [];
        this.currentTable = null;
        this.init();
    }

    async init() {
        await this.setupEventListeners();
        await this.scanCurrentPage();
    }

    setupEventListeners() {
        document.getElementById('deepScan').addEventListener('click', () => this.performDeepScan());
        document.getElementById('manualSelect').addEventListener('click', () => this.activateManualSelection());
        document.getElementById('multiPage').addEventListener('click', () => this.startMultiPageExtraction());
        document.getElementById('backBtn').addEventListener('click', () => this.showMainView());
        document.getElementById('exportCsv').addEventListener('click', () => this.exportData('csv'));
        document.getElementById('exportJson').addEventListener('click', () => this.exportData('json'));
    }

    async scanCurrentPage() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Check if we can access this tab
            if (this.isRestrictedUrl(tab.url)) {
                this.showError('Cannot scan this page (restricted URL)');
                return;
            }
            
            // Send message to content script to get tables
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'getTables' });
            
            if (!response || !response.tables) {
                this.showError('Could not scan page - no response from content script');
                return;
            }

            this.detectedTables = response.tables;
            this.updateUI();
        } catch (error) {
            console.error('Error scanning page:', error);
            if (error.message.includes('Cannot access') || error.message.includes('Could not establish connection')) {
                this.showError('Cannot access this page type');
            } else {
                this.showError('Failed to scan page for tables');
            }
        }
    }

    isRestrictedUrl(url) {
        if (!url) return true;
        
        const restrictedSchemes = [
            'chrome://',
            'chrome-extension://',
            'moz-extension://',
            'edge-extension://',
            'about:',
            'data:',
            'file:'
        ];
        
        return restrictedSchemes.some(scheme => url.startsWith(scheme));
    }


    updateUI() {
        const statusEl = document.getElementById('status');
        const contentEl = document.getElementById('content');
        const tableCountEl = document.getElementById('tableCount');
        
        if (statusEl) statusEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
        if (tableCountEl) tableCountEl.textContent = this.detectedTables.length;

        const tableList = document.getElementById('tableList');
        if (!tableList) {
            console.error('tableList element not found');
            return;
        }
        
        tableList.innerHTML = '';

        if (this.detectedTables.length === 0) {
            tableList.innerHTML = `
                <div class="no-tables">
                    <h4>No tables detected</h4>
                    <p>Try using "Deep Scan" or "Manual Selection" to find hidden tabular data.</p>
                </div>
            `;
            return;
        }

        this.detectedTables.forEach(table => {
            const item = this.createTableItem(table);
            tableList.appendChild(item);
        });
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
        const statusEl = document.getElementById('status');
        const contentEl = document.getElementById('content');
        const statusSpan = document.querySelector('#status span');
        
        if (statusEl) statusEl.style.display = 'block';
        if (contentEl) contentEl.style.display = 'none';
        if (statusSpan) statusSpan.textContent = 'Performing deep scan...';

        setTimeout(async () => {
            await this.scanCurrentPage();
        }, 1000);
    }

    activateManualSelection() {
        window.close();
    }

    startMultiPageExtraction() {
        alert('Multi-page extraction feature coming soon!');
    }

    showError(message) {
        const statusEl = document.getElementById('status');
        const contentEl = document.getElementById('content');
        
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.innerHTML = `
                <div style="color: #dc3545;">
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