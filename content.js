class CognitoTableContentScript {
    constructor() {
        console.log('CognitoTableContentScript constructor called');
        this.observedTables = new Map();
        this.mutationObserver = null;
        this.debounceTimer = null;
        this.isAnalyzing = false;
        this.init();
    }

    init() {
        console.log('CognitoTableContentScript initializing...');
        this.setupMutationObserver();
        this.setupMessageListener();
        this.performInitialScan();
        console.log('CognitoTableContentScript initialization complete');
    }

    setupMutationObserver() {
        this.mutationObserver = new MutationObserver((mutations) => {
            this.debouncedAnalysis();
        });

        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false
        });
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            console.log('Content script received message:', request);
            switch (request.action) {
                case 'getTables':
                    console.log('Processing getTables request...');
                    // For dynamic content, wait a bit and scan multiple times
                    this.scanWithRetry().then(tables => {
                        console.log('scanWithRetry completed, found:', tables.length, 'tables');
                        
                        // Include iframe information if no tables found
                        const response = { tables: tables };
                        if (tables.length === 0 && this.detectedIframes && this.detectedIframes.length > 0) {
                            response.iframes = Array.from(this.detectedIframes).map(iframe => ({
                                src: iframe.src,
                                title: iframe.title,
                                sameOrigin: this.isSameOrigin(iframe.src)
                            }));
                        }
                        
                        sendResponse(response);
                    }).catch(error => {
                        console.error('Error getting tables:', error);
                        sendResponse({ tables: [], error: error.message });
                    });
                    return true;
                
                case 'highlightTable':
                    this.highlightElement(request.selector);
                    sendResponse({ success: true });
                    break;
                
                case 'unhighlightTable':
                    this.unhighlightElement(request.selector);
                    sendResponse({ success: true });
                    break;
                
                case 'extractTable':
                    this.extractTableData(request.selector).then(data => {
                        sendResponse({ data });
                    }).catch(error => {
                        console.error('Error extracting table data:', error);
                        sendResponse({ data: null, error: error.message });
                    });
                    return true;
                
                default:
                    sendResponse({ error: 'Unknown action: ' + request.action });
                    break;
            }
        });
    }

    debouncedAnalysis() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        this.debounceTimer = setTimeout(() => {
            this.performIncrementalScan();
        }, 500);
    }

    async performInitialScan() {
        if (this.isAnalyzing) return;
        this.isAnalyzing = true;

        try {
            const tables = await this.scanForTables();
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
            const tables = await this.scanForTables();
            this.updateBadgeCount(tables.length);
        } catch (error) {
            console.error('CognitoTable: Error during incremental scan:', error);
        } finally {
            this.isAnalyzing = false;
        }
    }

    async scanWithRetry(maxRetries = 3, delay = 1000) {
        console.log('Starting scanWithRetry...');
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            console.log(`Scan attempt ${attempt}/${maxRetries}`);
            
            // Wait for any pending DOM updates
            await this.waitForDOMStability();
            
            const tables = await this.scanForTables();
            console.log(`Attempt ${attempt} found ${tables.length} tables`);
            
            // If we found tables, return them
            if (tables.length > 0) {
                return tables;
            }
            
            // If no tables found and this isn't the last attempt, wait and try again
            if (attempt < maxRetries) {
                console.log(`No tables found, waiting ${delay}ms before retry...`);
                await this.sleep(delay);
                
                // Increase delay for next attempt (exponential backoff)
                delay = Math.min(delay * 1.5, 3000);
            }
        }
        
        console.log('All scan attempts completed, no tables found');
        return [];
    }

    async waitForDOMStability(timeout = 500) {
        return new Promise((resolve) => {
            let timer;
            const resetTimer = () => {
                clearTimeout(timer);
                timer = setTimeout(resolve, timeout);
            };
            
            // Watch for DOM changes
            const observer = new MutationObserver(resetTimer);
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true
            });
            
            // Initial timer
            resetTimer();
            
            // Clean up observer after timeout
            setTimeout(() => {
                observer.disconnect();
                clearTimeout(timer);
                resolve();
            }, timeout * 3); // Max wait time
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async scanForTables() {
        const tables = [];
        let tableId = 0;

        // Debug: Show what elements are on the page
        console.log('Page body children count:', document.body.children.length);
        console.log('Total divs on page:', document.querySelectorAll('div').length);
        console.log('Elements with "table" in class:', document.querySelectorAll('[class*="table"]').length);
        console.log('Elements with "grid" in class:', document.querySelectorAll('[class*="grid"]').length);
        console.log('Elements with "row" in class:', document.querySelectorAll('[class*="row"]').length);
        
        // Debug: Sample some elements to understand the structure
        this.debugPageStructure();
        this.checkForIframes();

        const explicitTables = this.findExplicitTables();
        for (const table of explicitTables) {
            const tableData = await this.analyzeExplicitTable(table);
            if (tableData && tableData.rows.length > 0) {
                tables.push({
                    id: ++tableId,
                    type: 'explicit',
                    confidence: 0.95,
                    element: this.getElementSelector(table),
                    boundingRect: table.getBoundingClientRect(),
                    data: tableData,
                    preview: this.generatePreview(tableData)
                });
            }
        }

        const implicitTables = await this.findImplicitTables();
        for (const candidate of implicitTables) {
            const tableData = await this.analyzeImplicitTable(candidate.element);
            if (tableData && tableData.rows.length > 1) {
                tables.push({
                    id: ++tableId,
                    type: 'implicit',
                    confidence: candidate.confidence,
                    element: this.getElementSelector(candidate.element),
                    boundingRect: candidate.element.getBoundingClientRect(),
                    data: tableData,
                    preview: this.generatePreview(tableData)
                });
            }
        }

        return tables.sort((a, b) => b.confidence - a.confidence);
    }

    findExplicitTables() {
        const tables = document.querySelectorAll('table');
        console.log('Found', tables.length, 'total table elements');
        
        const visibleTables = Array.from(tables).filter(table => this.isVisibleElement(table));
        console.log('Found', visibleTables.length, 'visible tables');
        
        return visibleTables;
    }

    async findImplicitTables() {
        const candidates = [];
        // Look for common React/modern web patterns
        const containers = document.querySelectorAll('div, ul, ol, section, article, main, [class*="table"], [class*="grid"], [class*="list"], [class*="row"], [role="table"], [role="grid"]');
        console.log('Checking', containers.length, 'potential table containers for implicit tables');
        
        let checkedContainers = 0;
        for (const container of containers) {
            if (!this.isVisibleElement(container)) continue;
            checkedContainers++;
            
            const children = Array.from(container.children);
            if (children.length < 2) continue;

            const analysis = await this.analyzeContainerForTablePattern(container, children);
            
            // Debug: Log containers with some potential
            if (analysis.confidence > 0.3) {
                console.log('Potential table container:', {
                    selector: this.getElementSelector(container),
                    children: children.length,
                    confidence: analysis.confidence,
                    analysis: analysis
                });
            }
            
            if (analysis.confidence > 0.6) {
                candidates.push({
                    element: container,
                    confidence: analysis.confidence,
                    children: children,
                    analysis: analysis
                });
            }
        }

        console.log('Checked', checkedContainers, 'visible containers, found', candidates.length, 'candidates');
        const sortedCandidates = candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
        
        // If no tables found, check for iframes
        if (sortedCandidates.length === 0) {
            const iframes = this.checkForIframes();
            // Store iframe information for popup to access
            this.detectedIframes = iframes;
        }
        
        return sortedCandidates;
    }

    async analyzeContainerForTablePattern(container, children) {
        const analysis = {
            structuralSimilarity: 0,
            visualAlignment: 0,
            contentHomogeneity: 0,
            semanticClues: 0,
            confidence: 0
        };

        analysis.structuralSimilarity = this.calculateStructuralSimilarity(children);
        analysis.visualAlignment = this.assessVisualAlignment(children);
        analysis.contentHomogeneity = this.assessContentHomogeneity(children);
        analysis.semanticClues = this.findSemanticTableClues(container, children);

        const weights = {
            structuralSimilarity: 0.3,
            visualAlignment: 0.3,
            contentHomogeneity: 0.2,
            semanticClues: 0.2
        };

        analysis.confidence = Object.keys(weights).reduce((sum, key) => 
            sum + analysis[key] * weights[key], 0
        );

        return analysis;
    }

    calculateStructuralSimilarity(elements) {
        if (elements.length < 2) return 0;

        const signatures = elements.map(el => this.getStructuralSignature(el));
        const signatureGroups = {};
        
        signatures.forEach(sig => {
            signatureGroups[sig] = (signatureGroups[sig] || 0) + 1;
        });

        const largestGroup = Math.max(...Object.values(signatureGroups));
        return largestGroup / signatures.length;
    }

    getStructuralSignature(element) {
        const tagName = element.tagName.toLowerCase();
        const childTags = Array.from(element.children).map(child => child.tagName.toLowerCase()).sort();
        const textLength = element.textContent.trim().length;
        const hasImages = element.querySelectorAll('img').length > 0;
        const hasLinks = element.querySelectorAll('a').length > 0;
        const hasInputs = element.querySelectorAll('input, button, select').length > 0;
        
        return JSON.stringify({
            tag: tagName,
            children: childTags,
            textLength: textLength > 100 ? 'long' : textLength > 20 ? 'medium' : 'short',
            hasImages,
            hasLinks,
            hasInputs
        });
    }

    assessVisualAlignment(elements) {
        if (elements.length < 2) return 0;

        const rects = elements.map(el => el.getBoundingClientRect());
        const scores = [];

        const leftAlignment = this.calculateAlignment(rects.map(r => r.left));
        const rightAlignment = this.calculateAlignment(rects.map(r => r.right));
        const topSpacing = this.calculateSpacing(rects.map(r => r.top));
        const heightConsistency = this.calculateAlignment(rects.map(r => r.height));
        const widthConsistency = this.calculateAlignment(rects.map(r => r.width));

        scores.push(leftAlignment, rightAlignment, topSpacing, heightConsistency, widthConsistency);
        
        return scores.reduce((sum, score) => sum + score, 0) / scores.length;
    }

    calculateAlignment(values) {
        if (values.length < 2) return 1;
        
        const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
        const maxDeviation = Math.max(...values.map(val => Math.abs(val - avg)));
        
        if (avg === 0) return maxDeviation === 0 ? 1 : 0;
        
        const normalizedDeviation = maxDeviation / Math.abs(avg);
        return Math.max(0, 1 - normalizedDeviation);
    }

    calculateSpacing(values) {
        if (values.length < 3) return 1;
        
        const spacings = [];
        for (let i = 1; i < values.length; i++) {
            spacings.push(values[i] - values[i - 1]);
        }
        
        return this.calculateAlignment(spacings);
    }

    assessContentHomogeneity(elements) {
        if (elements.length < 2) return 0;

        const contentPatterns = elements.map(el => this.analyzeContentPattern(el));
        const scores = [];

        const textLengthScore = this.calculatePatternSimilarity(
            contentPatterns.map(p => p.textLength)
        );
        
        const linkCountScore = this.calculatePatternSimilarity(
            contentPatterns.map(p => p.linkCount)
        );
        
        const imageCountScore = this.calculatePatternSimilarity(
            contentPatterns.map(p => p.imageCount)
        );

        const dataTypeScore = this.calculateDataTypeConsistency(elements);

        scores.push(textLengthScore, linkCountScore, imageCountScore, dataTypeScore);
        
        return scores.reduce((sum, score) => sum + score, 0) / scores.length;
    }

    analyzeContentPattern(element) {
        return {
            textLength: element.textContent.trim().length,
            linkCount: element.querySelectorAll('a').length,
            imageCount: element.querySelectorAll('img').length,
            hasNumbers: /\d/.test(element.textContent),
            hasDates: /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(element.textContent),
            hasCurrency: /[\$\€\£\¥]/.test(element.textContent)
        };
    }

    calculatePatternSimilarity(values) {
        if (values.length < 2) return 1;
        
        const uniqueValues = new Set(values);
        if (uniqueValues.size === 1) return 1;
        
        const histogram = {};
        values.forEach(val => {
            histogram[val] = (histogram[val] || 0) + 1;
        });
        
        const maxCount = Math.max(...Object.values(histogram));
        return maxCount / values.length;
    }

    calculateDataTypeConsistency(elements) {
        const cellPatterns = elements.map(el => {
            const cells = this.extractCellsFromElement(el);
            return cells.map(cell => this.classifyDataType(cell));
        });

        if (cellPatterns.length < 2) return 0;
        
        const maxColumns = Math.max(...cellPatterns.map(row => row.length));
        let totalConsistency = 0;

        for (let col = 0; col < maxColumns; col++) {
            const columnTypes = cellPatterns.map(row => row[col] || 'empty');
            const typeGroups = {};
            
            columnTypes.forEach(type => {
                typeGroups[type] = (typeGroups[type] || 0) + 1;
            });
            
            const dominantTypeCount = Math.max(...Object.values(typeGroups));
            totalConsistency += dominantTypeCount / columnTypes.length;
        }

        return totalConsistency / maxColumns;
    }

    classifyDataType(text) {
        if (!text || text.trim().length === 0) return 'empty';
        
        const trimmed = text.trim();
        
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) return 'number';
        if (/^[\$\€\£\¥]?\s?\d+([,\.]?\d+)*(\.\d{2})?$/.test(trimmed)) return 'currency';
        if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(trimmed)) return 'date';
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'email';
        if (/^https?:\/\/.+/.test(trimmed)) return 'url';
        if (/^[\+]?[\d\s\-\(\)]+$/.test(trimmed) && trimmed.replace(/\D/g, '').length >= 10) return 'phone';
        
        return 'text';
    }

    findSemanticTableClues(container, children) {
        let score = 0;
        
        const tableKeywords = [
            'table', 'grid', 'list', 'row', 'cell', 'column',
            'header', 'data', 'item', 'entry', 'record'
        ];
        
        const containerClass = (container.className || '').toLowerCase();
        const containerId = (container.id || '').toLowerCase();
        
        tableKeywords.forEach(keyword => {
            if (containerClass.includes(keyword) || containerId.includes(keyword)) {
                score += 0.1;
            }
        });

        const headerElements = container.querySelectorAll('h1, h2, h3, h4, h5, h6, th, .header, .title');
        if (headerElements.length > 0) {
            score += Math.min(0.2, headerElements.length * 0.05);
        }

        const repeatingClasses = this.findRepeatingClasses(children);
        if (repeatingClasses.length > 0) {
            score += 0.2;
        }

        return Math.min(1, score);
    }

    findRepeatingClasses(elements) {
        const classGroups = {};
        
        elements.forEach(el => {
            const classes = Array.from(el.classList);
            classes.forEach(className => {
                classGroups[className] = (classGroups[className] || 0) + 1;
            });
        });

        return Object.entries(classGroups)
            .filter(([className, count]) => count >= Math.ceil(elements.length / 2))
            .map(([className]) => className);
    }

    async analyzeExplicitTable(table) {
        const data = { headers: [], rows: [], columnTypes: [] };
        
        let headerRow = table.querySelector('thead tr');
        if (!headerRow) {
            const firstRow = table.querySelector('tr');
            const hasThCells = firstRow && firstRow.querySelectorAll('th').length > 0;
            if (hasThCells) {
                headerRow = firstRow;
            }
        }

        if (headerRow) {
            const headers = Array.from(headerRow.querySelectorAll('th, td')).map(cell => 
                this.extractCellText(cell)
            );
            data.headers = headers;
        }

        const bodyRows = headerRow ? 
            Array.from(table.querySelectorAll('tr')).slice(1) :
            Array.from(table.querySelectorAll('tr'));

        bodyRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td, th')).map(cell => 
                this.extractCellText(cell)
            );
            if (cells.some(cell => cell.trim().length > 0)) {
                data.rows.push(cells);
            }
        });

        data.columnTypes = this.inferColumnTypes(data.rows);
        return data;
    }

    async analyzeImplicitTable(container) {
        const data = { headers: [], rows: [], columnTypes: [] };
        const children = Array.from(container.children);

        if (children.length === 0) return null;

        let headerDetected = false;
        children.forEach((child, index) => {
            const cells = this.extractCellsFromElement(child);
            if (cells.length === 0) return;

            if (index === 0 && this.looksLikeHeader(child)) {
                data.headers = cells;
                headerDetected = true;
            } else {
                data.rows.push(cells);
            }
        });

        if (!headerDetected && data.rows.length > 0) {
            const columnCount = Math.max(...data.rows.map(row => row.length));
            data.headers = Array.from({ length: columnCount }, (_, i) => `Column ${i + 1}`);
        }

        data.columnTypes = this.inferColumnTypes(data.rows);
        return data;
    }

    extractCellsFromElement(element) {
        const cells = [];
        
        const directTextCells = this.extractDirectTextNodes(element);
        if (directTextCells.length > 0) {
            return directTextCells;
        }

        const structuredCells = this.extractStructuredCells(element);
        if (structuredCells.length > 0) {
            return structuredCells;
        }

        const fallbackText = this.extractCellText(element);
        if (fallbackText.trim()) {
            cells.push(fallbackText);
        }

        return cells;
    }

    extractDirectTextNodes(element) {
        const cells = [];
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    const parent = node.parentElement;
                    if (parent.tagName.toLowerCase() === 'script' || 
                        parent.tagName.toLowerCase() === 'style') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return node.textContent.trim() ? 
                        NodeFilter.FILTER_ACCEPT : 
                        NodeFilter.FILTER_REJECT;
                }
            }
        );

        let node;
        while (node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (text && text.length > 0) {
                cells.push(text);
            }
        }

        return cells;
    }

    extractStructuredCells(element) {
        const cells = [];
        const cellSelectors = [
            'span', 'div', 'p', 'td', 'th', 'li',
            '.cell', '.item', '.field', '.value', '.data'
        ];

        cellSelectors.forEach(selector => {
            const candidates = element.querySelectorAll(selector);
            candidates.forEach(candidate => {
                if (candidate.children.length === 0) {
                    const text = this.extractCellText(candidate);
                    if (text.trim()) {
                        cells.push(text);
                    }
                }
            });
        });

        return cells;
    }

    extractCellText(element) {
        if (!element) return '';
        
        let text = element.textContent || '';
        text = text.replace(/\s+/g, ' ').trim();
        
        const links = element.querySelectorAll('a');
        links.forEach(link => {
            if (link.href && !text.includes(link.href)) {
                text += ` [${link.href}]`;
            }
        });

        const images = element.querySelectorAll('img');
        images.forEach(img => {
            if (img.alt && !text.includes(img.alt)) {
                text += ` [IMG: ${img.alt}]`;
            } else if (img.src && !text.includes(img.src)) {
                text += ` [IMG: ${img.src.split('/').pop()}]`;
            }
        });

        return text;
    }

    looksLikeHeader(element) {
        const style = window.getComputedStyle(element);
        const tagName = element.tagName.toLowerCase();
        
        const fontWeight = parseInt(style.fontWeight) || 400;
        const fontSize = parseFloat(style.fontSize) || 14;
        const backgroundColor = style.backgroundColor;
        
        const isHeaderTag = /^h[1-6]$/.test(tagName);
        const hasHeaderClass = /header|title|head/.test((element.className || '').toLowerCase());
        const hasHeaderRole = element.getAttribute('role') === 'columnheader';
        const isBold = fontWeight >= 600;
        const isLargerText = fontSize > 16;
        const hasBackground = backgroundColor !== 'rgba(0, 0, 0, 0)' && 
                             backgroundColor !== 'transparent';

        return isHeaderTag || hasHeaderClass || hasHeaderRole || 
               isBold || isLargerText || hasBackground;
    }

    inferColumnTypes(rows) {
        if (rows.length === 0) return [];
        
        const maxColumns = Math.max(...rows.map(row => row.length));
        const types = [];

        for (let col = 0; col < maxColumns; col++) {
            const values = rows
                .map(row => row[col] || '')
                .filter(val => val.trim().length > 0);
            
            types.push(this.inferSingleColumnType(values));
        }

        return types;
    }

    inferSingleColumnType(values) {
        if (values.length === 0) return { type: 'empty', confidence: 0 };

        const typeTests = [
            { type: 'number', test: /^-?\d+(\.\d+)?$/, weight: 1 },
            { type: 'currency', test: /^[\$\€\£\¥]?\s?\d+([,\.]?\d+)*(\.\d{2})?$/, weight: 0.9 },
            { type: 'percentage', test: /^\d+(\.\d+)?%$/, weight: 0.9 },
            { type: 'date', test: /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$|^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/, weight: 0.9 },
            { type: 'time', test: /^\d{1,2}:\d{2}(:\d{2})?(\s?(AM|PM))?$/i, weight: 0.8 },
            { type: 'email', test: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, weight: 0.8 },
            { type: 'url', test: /^https?:\/\/.+/, weight: 0.8 },
            { type: 'phone', test: /^[\+]?[\d\s\-\(\)]+$/, weight: 0.7 },
            { type: 'boolean', test: /^(true|false|yes|no|y|n|1|0)$/i, weight: 0.6 }
        ];

        let bestType = { type: 'text', confidence: 0 };

        typeTests.forEach(({ type, test, weight }) => {
            const matches = values.filter(val => test.test(val.trim())).length;
            const confidence = (matches / values.length) * weight;
            
            if (confidence > bestType.confidence && confidence > 0.7) {
                bestType = { type, confidence };
            }
        });

        return bestType;
    }

    generatePreview(tableData, maxRows = 3, maxCols = 4) {
        let preview = '';
        
        if (tableData.headers && tableData.headers.length > 0) {
            const headerLine = tableData.headers
                .slice(0, maxCols)
                .map(h => h.length > 15 ? h.substring(0, 12) + '...' : h)
                .join(' | ');
            preview += headerLine + '\n';
            preview += '─'.repeat(Math.min(60, headerLine.length)) + '\n';
        }
        
        tableData.rows.slice(0, maxRows).forEach(row => {
            const rowLine = row
                .slice(0, maxCols)
                .map(cell => cell.length > 15 ? cell.substring(0, 12) + '...' : cell)
                .join(' | ');
            preview += rowLine + '\n';
        });

        if (tableData.rows.length > maxRows) {
            preview += `... and ${tableData.rows.length - maxRows} more rows\n`;
        }

        if (tableData.headers && tableData.headers.length > maxCols) {
            preview += `... and ${tableData.headers.length - maxCols} more columns\n`;
        }

        return preview.trim();
    }

    isVisibleElement(element) {
        if (!element) return false;
        
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        
        return rect.width > 0 && 
               rect.height > 0 && 
               style.display !== 'none' && 
               style.visibility !== 'hidden' &&
               style.opacity !== '0';
    }

    getElementSelector(element) {
        if (!element) return '';
        
        if (element.id) {
            return `#${element.id}`;
        }
        
        const path = [];
        let current = element;
        
        while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 6) {
            let selector = current.nodeName.toLowerCase();
            
            if (current.className) {
                const classes = Array.from(current.classList)
                    .filter(cls => cls && !/\s/.test(cls))
                    .slice(0, 3);
                if (classes.length > 0) {
                    selector += '.' + classes.join('.');
                }
            }
            
            const siblings = Array.from(current.parentNode?.children || [])
                .filter(sibling => sibling.nodeName === current.nodeName);
            
            if (siblings.length > 1) {
                const index = siblings.indexOf(current);
                selector += `:nth-of-type(${index + 1})`;
            }
            
            path.unshift(selector);
            current = current.parentNode;
        }
        
        return path.join(' > ');
    }

    highlightElement(selector) {
        try {
            const element = document.querySelector(selector);
            if (element) {
                element.style.outline = '3px solid #667eea';
                element.style.backgroundColor = 'rgba(102, 126, 234, 0.1)';
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        } catch (error) {
            console.warn('CognitoTable: Could not highlight element:', selector, error);
        }
    }

    unhighlightElement(selector) {
        try {
            const element = document.querySelector(selector);
            if (element) {
                element.style.outline = '';
                element.style.backgroundColor = '';
            }
        } catch (error) {
            console.warn('CognitoTable: Could not unhighlight element:', selector, error);
        }
    }

    async extractTableData(selector) {
        try {
            const element = document.querySelector(selector);
            if (!element) return null;

            if (element.tagName.toLowerCase() === 'table') {
                return await this.analyzeExplicitTable(element);
            } else {
                return await this.analyzeImplicitTable(element);
            }
        } catch (error) {
            console.error('CognitoTable: Error extracting table data:', error);
            return null;
        }
    }

    updateBadgeCount(count) {
        chrome.runtime.sendMessage({
            action: 'updateBadge',
            count: count
        }).catch(() => {
            // Ignore errors if popup is not open
        });
    }

    destroy() {
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }
        
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        this.observedTables.clear();
    }

    debugPageStructure() {
        console.log('=== PAGE STRUCTURE DEBUG ===');
        
        // Find elements that might contain tabular data
        const potentialContainers = [
            ...document.querySelectorAll('[class*="table"]'),
            ...document.querySelectorAll('[class*="grid"]'),
            ...document.querySelectorAll('[class*="list"]'),
            ...document.querySelectorAll('[class*="row"]'),
            ...document.querySelectorAll('[class*="data"]'),
            ...document.querySelectorAll('[class*="item"]')
        ];
        
        console.log('Found', potentialContainers.length, 'potential containers');
        
        // Sample first few and show their structure
        potentialContainers.slice(0, 5).forEach((el, index) => {
            console.log(`Container ${index + 1}:`, {
                tagName: el.tagName,
                className: el.className,
                childrenCount: el.children.length,
                textContent: el.textContent.substring(0, 100),
                selector: this.getElementSelector(el)
            });
        });
        
        // Look for repeating patterns
        const bodyChildren = Array.from(document.body.children);
        console.log('Body children:', bodyChildren.map(el => ({
            tag: el.tagName,
            class: el.className,
            children: el.children.length
        })));
    }

    checkForIframes() {
        console.log('=== IFRAME DETECTION ===');
        const iframes = document.querySelectorAll('iframe');
        console.log('Found', iframes.length, 'iframes');
        
        iframes.forEach((iframe, index) => {
            console.log(`Iframe ${index + 1}:`, {
                src: iframe.src,
                title: iframe.title,
                width: iframe.width || iframe.style.width,
                height: iframe.height || iframe.style.height,
                sameOrigin: this.isSameOrigin(iframe.src)
            });
        });

        return iframes;
    }

    isSameOrigin(url) {
        try {
            const currentOrigin = window.location.origin;
            const iframeUrl = new URL(url, window.location.href);
            return iframeUrl.origin === currentOrigin;
        } catch (e) {
            return false;
        }
    }
}

let cognitoTable = null;

console.log('CognitoTable content script loading... Document ready state:', document.readyState);

if (document.readyState === 'loading') {
    console.log('Document still loading, waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOMContentLoaded event fired, initializing CognitoTable...');
        cognitoTable = new CognitoTableContentScript();
    });
} else {
    console.log('Document already loaded, initializing CognitoTable immediately...');
    cognitoTable = new CognitoTableContentScript();
}

window.addEventListener('beforeunload', () => {
    if (cognitoTable) {
        cognitoTable.destroy();
    }
});