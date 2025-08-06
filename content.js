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
            
            // If we found tables, check if they might be virtualized and try to get more data
            if (tables.length > 0) {
                const enhancedTables = await this.enhanceVirtualizedTables(tables);
                return enhancedTables;
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

    async enhanceVirtualizedTables(tables) {
        const enhancedTables = [];
        
        for (const table of tables) {
            const element = document.querySelector(table.element);
            if (!element) {
                enhancedTables.push(table);
                continue;
            }
            
            // Check if this appears to be a virtualized table
            const isVirtualized = this.detectVirtualizedTable(element);
            
            if (isVirtualized) {
                console.log('Detected virtualized table, attempting to extract complete data...');
                try {
                    const completeData = await this.extractVirtualizedTableData(element);
                    if (completeData && completeData.rows.length > table.data.rows.length) {
                        console.log(`Enhanced virtualized table: ${table.data.rows.length} -> ${completeData.rows.length} rows`);
                        enhancedTables.push({
                            ...table,
                            data: completeData,
                            preview: this.generatePreview(completeData)
                        });
                    } else {
                        enhancedTables.push(table);
                    }
                } catch (error) {
                    console.warn('Failed to enhance virtualized table:', error);
                    enhancedTables.push(table);
                }
            } else {
                enhancedTables.push(table);
            }
        }
        
        return enhancedTables;
    }

    detectVirtualizedTable(container) {
        console.log('Detecting virtualization patterns for container:', container);
        
        // Check for common virtualization patterns - made more aggressive
        const indicators = [
            // Always assume React tables might be virtualized
            () => {
                const hasReactLikeStructure = container.querySelector('[class*="react"], [data-react], [class*="virtual"], [class*="infinite"]');
                return !!hasReactLikeStructure;
            },
            
            // Look for scrollable containers with limited visible rows
            () => {
                const scrollableParent = this.findScrollableParent(container);
                if (scrollableParent) {
                    const directChildren = container.children.length;
                    const allDescendants = container.querySelectorAll('*').length;
                    // Lowered thresholds to be more aggressive
                    return allDescendants > 20 && directChildren < 50;
                }
                return false;
            },
            
            // Look for viewport-based rendering patterns - more aggressive
            () => {
                const viewportHeight = window.innerHeight;
                const containerHeight = container.offsetHeight;
                const rowElements = Array.from(container.querySelectorAll('[class*="row"], [class*="item"], [class*="entry"], tr, li'));
                
                if (rowElements.length > 3) {
                    const estimatedRowHeight = containerHeight / rowElements.length;
                    const estimatedMaxVisibleRows = Math.ceil(viewportHeight / estimatedRowHeight);
                    
                    // More aggressive detection - assume most tables with limited visible rows are virtualized
                    return rowElements.length <= estimatedMaxVisibleRows * 3;
                }
                return false;
            },
            
            // Look for transform-based positioning (common in virtualization)
            () => {
                const positioned = Array.from(container.querySelectorAll('*')).filter(el => {
                    const style = window.getComputedStyle(el);
                    return style.transform && style.transform !== 'none' && 
                           (style.transform.includes('translateY') || style.transform.includes('translate3d'));
                });
                return positioned.length > 0;
            },
            
            // Check if there are indicators of lazy loading or pagination
            () => {
                const lazyIndicators = container.querySelectorAll('[class*="lazy"], [class*="load"], [class*="page"], [class*="more"]');
                return lazyIndicators.length > 0;
            },
            
            // Check for common table library classes
            () => {
                const tableLibClasses = [
                    'react-table', 'react-grid', 'ag-grid', 'data-table',
                    'material-table', 'ant-table', 'table-virtualized'
                ];
                return tableLibClasses.some(className => 
                    container.querySelector(`[class*="${className}"]`)
                );
            },
            
            // If table has more than 5 rows, assume it might benefit from virtualization enhancement
            () => {
                const rowCount = container.querySelectorAll('tr, [class*="row"], [class*="item"], li').length;
                return rowCount >= 5;
            }
        ];
        
        const results = indicators.map((check, index) => {
            try {
                const result = check();
                console.log(`Virtualization indicator ${index + 1}:`, result);
                return result;
            } catch (error) {
                console.warn(`Virtualization check ${index + 1} failed:`, error);
                return false;
            }
        });
        
        const isVirtualized = results.some(result => result);
        console.log('Final virtualization detection result:', isVirtualized);
        
        return isVirtualized;
    }

    async extractVirtualizedTableData(container) {
        console.log('=== VIRTUALIZED TABLE EXTRACTION ===');
        console.log('Container:', container);
        
        // Try multiple scrollable elements and approaches
        const scrollTargets = this.findAllScrollableElements(container);
        console.log('Found scrollable elements:', scrollTargets.length);
        
        const allData = { headers: [], rows: [], columnTypes: [] };
        const seenRows = new Set();
        let bestResult = null;
        
        // Try each scrollable element
        for (let i = 0; i < scrollTargets.length; i++) {
            const scrollableElement = scrollTargets[i];
            const originalScrollTop = scrollableElement.scrollTop;
            console.log(`Trying scrollable element ${i + 1}:`, scrollableElement.tagName, scrollableElement.className);
            
            try {
                const result = await this.performScrollExtraction(container, scrollableElement);
                
                if (result && result.rows.length > 0) {
                    console.log(`Scrollable element ${i + 1} yielded ${result.rows.length} rows`);
                    if (!bestResult || result.rows.length > bestResult.rows.length) {
                        bestResult = result;
                    }
                }
            } catch (error) {
                console.warn(`Error with scrollable element ${i + 1}:`, error);
            } finally {
                scrollableElement.scrollTop = originalScrollTop;
            }
        }
        
        // If scrolling didn't help much, try alternative approaches
        if (!bestResult || bestResult.rows.length < 15) {
            console.log('Trying alternative extraction methods...');
            
            // Try simulating zoom out effect
            const zoomResult = await this.simulateZoomExtraction(container);
            if (zoomResult && zoomResult.rows.length > (bestResult?.rows.length || 0)) {
                console.log('Zoom simulation yielded better results:', zoomResult.rows.length);
                bestResult = zoomResult;
            }
            
            // Try finding all table-like structures in DOM
            const deepScanResult = await this.performDeepTableScan(container);
            if (deepScanResult && deepScanResult.rows.length > (bestResult?.rows.length || 0)) {
                console.log('Deep scan yielded better results:', deepScanResult.rows.length);
                bestResult = deepScanResult;
            }
        }
        
        if (bestResult) {
            console.log(`Final virtualized extraction result: ${bestResult.rows.length} rows`);
            return bestResult;
        }
        
        console.log('No enhanced results found, returning basic extraction');
        return await this.analyzeImplicitTable(container);
    }

    findAllScrollableElements(container) {
        const scrollableElements = [];
        
        // Add window/body scroll
        if (document.body.scrollHeight > window.innerHeight) {
            scrollableElements.push(window);
        }
        
        // Find scrollable parents
        let current = container;
        let depth = 0;
        
        while (current && depth < 15) {
            const style = window.getComputedStyle(current);
            const isScrollable = style.overflow === 'auto' || style.overflow === 'scroll' ||
                               style.overflowY === 'auto' || style.overflowY === 'scroll';
            
            if (isScrollable && current.scrollHeight > current.clientHeight) {
                scrollableElements.push(current);
            }
            
            current = current.parentElement;
            depth++;
        }
        
        // Also look for scrollable siblings and containers
        const allScrollable = Array.from(document.querySelectorAll('*')).filter(el => {
            if (scrollableElements.includes(el)) return false;
            
            const style = window.getComputedStyle(el);
            const isScrollable = style.overflow === 'auto' || style.overflow === 'scroll' ||
                               style.overflowY === 'auto' || style.overflowY === 'scroll';
            
            return isScrollable && el.scrollHeight > el.clientHeight && 
                   (el.contains(container) || container.contains(el));
        });
        
        scrollableElements.push(...allScrollable.slice(0, 5)); // Limit to 5 additional
        
        return scrollableElements;
    }

    async performScrollExtraction(container, scrollableElement) {
        const allData = { headers: [], rows: [], columnTypes: [] };
        const allRowsWithPositions = [];
        const seenRows = new Set();
        
        // Get initial data
        const initialData = await this.analyzeImplicitTable(container);
        if (initialData) {
            if (initialData.headers && initialData.headers.length > 0) {
                allData.headers = initialData.headers;
            }
            
            if (initialData.rows) {
                // Add initial rows with their current positions
                initialData.rows.forEach((row, index) => {
                    const rowKey = row.join('|');
                    if (!seenRows.has(rowKey)) {
                        seenRows.add(rowKey);
                        allRowsWithPositions.push({
                            data: row,
                            scrollPosition: 0,
                            discoveryOrder: index,
                            domPosition: this.getRowDOMPosition(row, container)
                        });
                    }
                });
            }
        }
        
        const isWindow = scrollableElement === window;
        const maxScroll = isWindow ? 
            document.body.scrollHeight - window.innerHeight :
            scrollableElement.scrollHeight - scrollableElement.clientHeight;
        
        if (maxScroll <= 0) {
            allData.rows = allRowsWithPositions.map(r => r.data);
            allData.columnTypes = this.inferColumnTypes(allData.rows);
            return allData;
        }
        
        // More aggressive scrolling - smaller steps, more attempts
        const scrollSteps = Math.min(25, Math.ceil(maxScroll / 200)); // Smaller scroll increments
        
        console.log(`Performing ${scrollSteps} scroll steps, maxScroll: ${maxScroll}`);
        
        for (let step = 1; step <= scrollSteps; step++) {
            const scrollPosition = (maxScroll / scrollSteps) * step;
            
            if (isWindow) {
                window.scrollTo(0, scrollPosition);
            } else {
                scrollableElement.scrollTop = scrollPosition;
            }
            
            // Wait for new content to render with longer delay
            await this.sleep(300);
            
            // Force layout recalculation
            container.offsetHeight;
            
            // Extract data at this scroll position
            const stepData = await this.analyzeImplicitTable(container);
            if (stepData && stepData.rows) {
                let newRowsFound = 0;
                stepData.rows.forEach((row, index) => {
                    const rowKey = row.join('|');
                    if (!seenRows.has(rowKey)) {
                        seenRows.add(rowKey);
                        allRowsWithPositions.push({
                            data: row,
                            scrollPosition: scrollPosition,
                            discoveryOrder: allRowsWithPositions.length,
                            domPosition: this.getRowDOMPosition(row, container)
                        });
                        newRowsFound++;
                    }
                });
                
                console.log(`Step ${step}: Found ${newRowsFound} new rows (total: ${allRowsWithPositions.length})`);
            }
            
            // Continue even if no new rows found - some virtualization patterns have gaps
        }
        
        // Sort rows to preserve visual order - prioritize DOM position over scroll discovery
        const sortedRowsWithPos = allRowsWithPositions.sort((a, b) => {
            // Primary sort: DOM position (if available)
            if (a.domPosition !== null && b.domPosition !== null) {
                return a.domPosition - b.domPosition;
            }
            
            // Secondary sort: scroll position where discovered
            if (a.scrollPosition !== b.scrollPosition) {
                return a.scrollPosition - b.scrollPosition;
            }
            
            // Tertiary sort: discovery order
            return a.discoveryOrder - b.discoveryOrder;
        });
        
        allData.rows = sortedRowsWithPos.map(r => r.data);
        allData.columnTypes = this.inferColumnTypes(allData.rows);
        
        console.log('Scroll extraction completed with proper ordering');
        return allData;
    }

    getRowDOMPosition(rowData, container) {
        // Try to find the DOM element that contains this row data
        // This is a heuristic approach since we only have the data, not the original element
        try {
            const firstCellText = rowData[0] ? rowData[0].toString().trim().substring(0, 20) : '';
            if (!firstCellText) return null;
            
            // Search for elements containing the first cell's text
            const candidates = Array.from(container.querySelectorAll('*')).filter(el => {
                const text = el.textContent.trim();
                return text.includes(firstCellText) && text.length < firstCellText.length * 3;
            });
            
            if (candidates.length > 0) {
                // Return DOM position of the best matching candidate
                return this.calculateDOMPosition(candidates[0], container);
            }
        } catch (error) {
            console.warn('Error calculating row DOM position:', error);
        }
        
        return null;
    }

    async simulateZoomExtraction(container) {
        console.log('Attempting zoom simulation...');
        
        // Temporarily modify viewport and container styles to simulate zoom out
        const originalTransform = document.body.style.transform;
        const originalZoom = document.body.style.zoom;
        const originalWidth = document.body.style.width;
        const originalHeight = document.body.style.height;
        
        try {
            // Simulate zoom out effect
            document.body.style.transform = 'scale(0.5)';
            document.body.style.transformOrigin = '0 0';
            document.body.style.width = '200%';
            document.body.style.height = '200%';
            
            // Force layout recalculation
            await this.sleep(500);
            container.offsetHeight;
            
            const zoomedData = await this.analyzeImplicitTable(container);
            
            return zoomedData;
            
        } finally {
            // Restore original styles
            document.body.style.transform = originalTransform;
            document.body.style.zoom = originalZoom;
            document.body.style.width = originalWidth;
            document.body.style.height = originalHeight;
            
            // Allow time for styles to restore
            await this.sleep(200);
        }
    }

    async performDeepTableScan(container) {
        console.log('Performing deep table scan...');
        
        // Look for all possible row elements in the entire DOM near the table
        const rowCandidates = [];
        
        // Common row selectors for React tables
        const rowSelectors = [
            '[class*="row"]',
            '[class*="item"]', 
            '[class*="entry"]',
            '[class*="record"]',
            '[role="row"]',
            'tr',
            'li'
        ];
        
        // Search in wider context
        const searchRoot = container.closest('[class*="table"]') || 
                          container.closest('[class*="grid"]') || 
                          container.closest('[class*="list"]') || 
                          container;
        
        for (const selector of rowSelectors) {
            const elements = Array.from(searchRoot.querySelectorAll(selector));
            rowCandidates.push(...elements);
        }
        
        console.log(`Found ${rowCandidates.length} potential row elements`);
        
        // Extract data from all potential rows WITH DOM position tracking
        const rowsWithPositions = [];
        const seenRowKeys = new Set();
        let headers = [];
        
        for (const rowElement of rowCandidates) {
            if (!this.isVisibleElement(rowElement)) continue;
            
            const rowData = this.extractCellsFromElement(rowElement);
            if (rowData.length > 0) {
                const rowKey = rowData.join('|');
                if (!seenRowKeys.has(rowKey)) {
                    seenRowKeys.add(rowKey);
                    
                    // Calculate DOM position
                    const domPosition = this.calculateDOMPosition(rowElement, searchRoot);
                    
                    rowsWithPositions.push({
                        data: rowData,
                        element: rowElement,
                        domPosition: domPosition,
                        rowKey: rowKey
                    });
                    
                    // Use longest row as potential headers if we don't have headers
                    if (rowData.length > headers.length && this.looksLikeHeader(rowElement)) {
                        headers = rowData;
                    }
                }
            }
        }
        
        if (rowsWithPositions.length > 0) {
            // Sort rows by their DOM position to preserve visual order
            const sortedRowsWithPos = rowsWithPositions.sort((a, b) => {
                return a.domPosition - b.domPosition;
            });
            
            const sortedRows = sortedRowsWithPos.map(row => row.data);
            
            console.log('Deep scan rows sorted by DOM position:', sortedRows.length);
            
            return {
                headers: headers.length > 0 ? headers : Array.from({ length: Math.max(...sortedRows.map(r => r.length)) }, (_, i) => `Column ${i + 1}`),
                rows: sortedRows,
                columnTypes: this.inferColumnTypes(sortedRows)
            };
        }
        
        return null;
    }

    calculateDOMPosition(element, root = document) {
        // Calculate a numeric position based on element's position in DOM tree
        let position = 0;
        let current = element;
        let depth = 0;
        
        while (current && current !== root && depth < 20) {
            const parent = current.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children);
                const index = siblings.indexOf(current);
                // Weight deeper elements less to preserve overall order
                position += index * Math.pow(0.1, depth);
            }
            current = parent;
            depth++;
        }
        
        return position;
    }

    findScrollableParent(element) {
        let current = element;
        let depth = 0;
        
        while (current && depth < 10) {
            const style = window.getComputedStyle(current);
            const isScrollable = style.overflow === 'auto' || style.overflow === 'scroll' ||
                               style.overflowY === 'auto' || style.overflowY === 'scroll';
            
            if (isScrollable && current.scrollHeight > current.clientHeight) {
                return current;
            }
            
            current = current.parentElement;
            depth++;
        }
        
        // Check if document body/html is scrollable
        if (document.body.scrollHeight > window.innerHeight) {
            return document.body;
        }
        
        return null;
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
                    preview: this.generatePreview(tableData),
                    domPosition: this.calculateDOMPosition(candidate.element) // Add DOM position for sorting
                });
            }
        }

        // Sort by DOM position first (visual order), then by confidence
        return tables.sort((a, b) => {
            // If both tables have DOM positions, sort by position
            if (a.domPosition !== undefined && b.domPosition !== undefined) {
                return a.domPosition - b.domPosition;
            }
            // Otherwise, sort by confidence
            return b.confidence - a.confidence;
        });
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
        const allRows = Array.from(table.querySelectorAll('tr'));
        
        if (allRows.length === 0) return data;

        // Detect multi-level headers by checking for rowspan/colspan in first few rows
        const headerRowsEnd = this.detectHeaderRowsEnd(allRows);
        const headerRows = allRows.slice(0, headerRowsEnd);
        const dataRows = allRows.slice(headerRowsEnd);

        if (headerRows.length > 0) {
            data.headers = this.processMultiLevelHeaders(headerRows);
        }

        dataRows.forEach(row => {
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

    detectHeaderRowsEnd(rows) {
        let headerRowsCount = 0;
        
        // Look for consecutive rows that have characteristics of headers
        for (let i = 0; i < Math.min(rows.length, 6); i++) {
            const row = rows[i];
            const cells = Array.from(row.querySelectorAll('td, th'));
            
            if (cells.length === 0) continue;
            
            const hasThCells = cells.some(cell => cell.tagName.toLowerCase() === 'th');
            const hasSpans = cells.some(cell => 
                parseInt(cell.getAttribute('colspan') || '1') > 1 || 
                parseInt(cell.getAttribute('rowspan') || '1') > 1
            );
            
            // Check if cells contain mostly non-numeric content (header characteristic)
            const nonNumericCells = cells.filter(cell => {
                const text = this.extractCellText(cell).trim();
                // Consider a cell non-numeric if it doesn't look like a pure number
                return text && !(/^-?[\d,]+(\.\d+)?$/.test(text.replace(/[,\s]/g, '')));
            });
            
            const isHeaderLike = hasThCells || hasSpans || 
                (nonNumericCells.length > cells.length * 0.7); // 70% non-numeric
            
            if (isHeaderLike) {
                headerRowsCount = i + 1;
            } else if (headerRowsCount > 0) {
                // We found header rows followed by a non-header row
                break;
            }
        }
        
        // If no clear header detection, fall back to simpler logic
        if (headerRowsCount === 0) {
            const firstRow = rows[0];
            const hasThCells = firstRow && firstRow.querySelectorAll('th').length > 0;
            return hasThCells ? 1 : 0;
        }
        
        return headerRowsCount;
    }

    processMultiLevelHeaders(headerRows) {
        if (headerRows.length === 0) return [];
        
        // Build a grid representing the header structure
        const grid = this.buildHeaderGrid(headerRows);
        
        // Generate final column headers by combining hierarchical levels
        return this.generateFinalHeaders(grid);
    }

    buildHeaderGrid(headerRows) {
        const grid = [];
        let maxCols = 0;
        
        // First pass: determine maximum columns needed
        headerRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            let colCount = 0;
            cells.forEach(cell => {
                const colspan = parseInt(cell.getAttribute('colspan') || '1');
                colCount += colspan;
            });
            maxCols = Math.max(maxCols, colCount);
        });
        
        // Initialize grid
        for (let r = 0; r < headerRows.length; r++) {
            grid[r] = new Array(maxCols).fill(null);
        }
        
        // Fill grid with cell data
        headerRows.forEach((row, rowIndex) => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            let colIndex = 0;
            
            cells.forEach(cell => {
                // Find next available column
                while (colIndex < maxCols && grid[rowIndex][colIndex] !== null) {
                    colIndex++;
                }
                
                if (colIndex >= maxCols) return;
                
                const colspan = parseInt(cell.getAttribute('colspan') || '1');
                const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
                const text = this.extractCellText(cell).trim();
                
                // Fill all cells covered by this span
                for (let r = 0; r < rowspan && rowIndex + r < grid.length; r++) {
                    for (let c = 0; c < colspan && colIndex + c < maxCols; c++) {
                        grid[rowIndex + r][colIndex + c] = {
                            text: text,
                            isSpanOrigin: r === 0 && c === 0,
                            colspan: colspan,
                            rowspan: rowspan,
                            level: rowIndex
                        };
                    }
                }
                
                colIndex += colspan;
            });
        });
        
        return grid;
    }

    generateFinalHeaders(grid) {
        if (grid.length === 0) return [];
        
        const finalHeaders = [];
        const numCols = grid[0].length;
        
        for (let col = 0; col < numCols; col++) {
            const headerParts = [];
            
            // Collect header text from each level for this column
            for (let row = 0; row < grid.length; row++) {
                const cell = grid[row][col];
                if (cell && cell.text && cell.text.trim()) {
                    // Only add if it's not a repetition from previous level
                    const lastPart = headerParts[headerParts.length - 1];
                    if (!lastPart || lastPart !== cell.text) {
                        headerParts.push(cell.text);
                    }
                }
            }
            
            // Combine parts with delimiter, prioritizing the most specific (deepest level)
            let finalHeader = '';
            if (headerParts.length > 0) {
                // Use the most specific (last) non-empty header part
                const specificHeader = headerParts[headerParts.length - 1];
                
                // If we have multiple levels, combine them intelligently
                if (headerParts.length > 1) {
                    // For cases like "Debt" > "Debt VRR", combine as "Debt - Debt VRR"
                    // But avoid repetition like "Debt" > "Debt" becoming "Debt - Debt"
                    const parentParts = headerParts.slice(0, -1).filter(part => 
                        part && !specificHeader.includes(part)
                    );
                    
                    if (parentParts.length > 0) {
                        finalHeader = parentParts.join(' - ') + ' - ' + specificHeader;
                    } else {
                        finalHeader = specificHeader;
                    }
                } else {
                    finalHeader = specificHeader;
                }
            } else {
                finalHeader = `Column ${col + 1}`;
            }
            
            finalHeaders.push(finalHeader);
        }
        
        return finalHeaders;
    }

    async analyzeImplicitTable(container) {
        const data = { headers: [], rows: [], columnTypes: [] };
        const children = Array.from(container.children);

        if (children.length === 0) return null;

        let headerDetected = false;
        
        // Sort children by their DOM order to ensure proper sequence
        const sortedChildren = children.sort((a, b) => {
            const aPosition = this.calculateDOMPosition(a, container);
            const bPosition = this.calculateDOMPosition(b, container);
            return aPosition - bPosition;
        });

        sortedChildren.forEach((child, index) => {
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
        
        // Check if element has dimensions and is not hidden
        const hasVisibleDimensions = rect.width > 0 && rect.height > 0;
        const isNotHidden = style.display !== 'none' && 
                           style.visibility !== 'hidden' &&
                           style.opacity !== '0';
        
        // For virtualized tables, also consider elements that might be outside viewport
        // but still part of the table structure
        const isVirtualizedElement = this.isPartOfVirtualizedTable(element);
        
        return (hasVisibleDimensions && isNotHidden) || isVirtualizedElement;
    }

    isPartOfVirtualizedTable(element) {
        // Check if element is part of a virtualized table structure
        // Common patterns: React Virtualized, react-window, etc.
        const virtualizedIndicators = [
            'react-virtualized',
            'react-window', 
            'virtual',
            'infinite',
            'viewport'
        ];
        
        let current = element;
        let depth = 0;
        
        while (current && depth < 10) {
            const className = (current.className || '').toLowerCase();
            const id = (current.id || '').toLowerCase();
            const dataAttrs = Array.from(current.attributes || [])
                .filter(attr => attr.name.startsWith('data-'))
                .map(attr => attr.value.toLowerCase())
                .join(' ');
            
            const searchText = `${className} ${id} ${dataAttrs}`;
            
            if (virtualizedIndicators.some(indicator => searchText.includes(indicator))) {
                return true;
            }
            
            current = current.parentElement;
            depth++;
        }
        
        return false;
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