/**
 * @author : Zahir
 * Desc : Analyzes a given DOM element to extract tabular data.
 */
class TableAnalyzer {
    constructor(domUtils) {
        this.domUtils = domUtils;
    }

    async analyzeExplicitTable(table) {
        const data = { headers: [], rows: [], columnTypes: [] };
        const allRows = Array.from(table.querySelectorAll('tr'));
        
        if (allRows.length === 0) return data;

        const headerRowsEnd = this.detectHeaderRowsEnd(allRows);
        const headerRows = allRows.slice(0, headerRowsEnd);
        const dataRows = allRows.slice(headerRowsEnd);

        if (headerRows.length > 0) {
            data.headers = this.processMultiLevelHeaders(headerRows);
        }

        dataRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td, th')).map(cell => this.extractCellText(cell));
            if (cells.some(cell => cell.trim().length > 0)) {
                data.rows.push(cells);
            }
        });

        data.columnTypes = this.inferColumnTypes(data.rows);
        return data;
    }

    detectHeaderRowsEnd(rows) {
        let headerRowsCount = 0;
        for (let i = 0; i < Math.min(rows.length, 6); i++) {
            const row = rows[i];
            const cells = Array.from(row.querySelectorAll('td, th'));
            if (cells.length === 0) continue;
            
            const hasThCells = cells.some(cell => cell.tagName.toLowerCase() === 'th');
            const hasSpans = cells.some(cell => parseInt(cell.getAttribute('colspan') || '1') > 1 || parseInt(cell.getAttribute('rowspan') || '1') > 1);
            const nonNumericCells = cells.filter(cell => !/^-?[\d,]+(\.\d+)?$/.test(this.extractCellText(cell).trim().replace(/[,\s]/g, '')));
            const isHeaderLike = hasThCells || hasSpans || (nonNumericCells.length > cells.length * 0.7);
            
            if (isHeaderLike) {
                headerRowsCount = i + 1;
            } else if (headerRowsCount > 0) {
                break;
            }
        }
        
        if (headerRowsCount === 0) {
            const firstRow = rows[0];
            return firstRow && firstRow.querySelectorAll('th').length > 0 ? 1 : 0;
        }
        
        return headerRowsCount;
    }

    processMultiLevelHeaders(headerRows) {
        if (headerRows.length === 0) return [];
        const grid = this.buildHeaderGrid(headerRows);
        return this.generateFinalHeaders(grid);
    }

    buildHeaderGrid(headerRows) {
        const grid = [];
        let maxCols = 0;
        
        headerRows.forEach(row => {
            let colCount = 0;
            Array.from(row.querySelectorAll('td, th')).forEach(cell => {
                colCount += parseInt(cell.getAttribute('colspan') || '1');
            });
            maxCols = Math.max(maxCols, colCount);
        });
        
        for (let r = 0; r < headerRows.length; r++) {
            grid[r] = new Array(maxCols).fill(null);
        }
        
        headerRows.forEach((row, rowIndex) => {
            let colIndex = 0;
            Array.from(row.querySelectorAll('td, th')).forEach(cell => {
                while (colIndex < maxCols && grid[rowIndex][colIndex] !== null) {
                    colIndex++;
                }
                if (colIndex >= maxCols) return;
                
                const colspan = parseInt(cell.getAttribute('colspan') || '1');
                const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
                const text = this.extractCellText(cell).trim();
                
                for (let r = 0; r < rowspan && rowIndex + r < grid.length; r++) {
                    for (let c = 0; c < colspan && colIndex + c < maxCols; c++) {
                        grid[rowIndex + r][colIndex + c] = { text, isSpanOrigin: r === 0 && c === 0 };
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
            for (let row = 0; row < grid.length; row++) {
                const cell = grid[row][col];
                if (cell && cell.text && (!headerParts.includes(cell.text))) {
                    headerParts.push(cell.text);
                }
            }
            
            let finalHeader = headerParts.join(' - ');
            if (!finalHeader) {
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
        const sortedChildren = children.sort((a, b) => this.domUtils.calculateDOMPosition(a, container) - this.domUtils.calculateDOMPosition(b, container));

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
        const directTextCells = this.extractDirectTextNodes(element);
        if (directTextCells.length > 0) return directTextCells;

        const structuredCells = this.extractStructuredCells(element);
        if (structuredCells.length > 0) return structuredCells;

        const fallbackText = this.extractCellText(element);
        return fallbackText.trim() ? [fallbackText] : [];
    }

    extractDirectTextNodes(element) {
        const cells = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                const parent = node.parentElement;
                if (parent && (parent.tagName.toLowerCase() === 'script' || parent.tagName.toLowerCase() === 'style')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });
        while (walker.nextNode()) {
            cells.push(walker.currentNode.textContent.trim());
        }
        return cells;
    }

    extractStructuredCells(element) {
        const cells = [];
        const selectors = ['span', 'div', 'p', 'td', 'th', 'li', '.cell', '.item', '.field', '.value', '.data'];
        selectors.forEach(selector => {
            element.querySelectorAll(selector).forEach(candidate => {
                if (candidate.children.length === 0) {
                    const text = this.extractCellText(candidate);
                    if (text.trim()) cells.push(text);
                }
            });
        });
        return cells;
    }
    
    extractCellText(element) {
        if (!element) return '';
        let text = (element.textContent || '').replace(/\s+/g, ' ').trim();
        element.querySelectorAll('a').forEach(link => {
            if (link.href && !text.includes(link.href)) text += ` [${link.href}]`;
        });
        element.querySelectorAll('img').forEach(img => {
            if (img.alt && !text.includes(img.alt)) text += ` [IMG: ${img.alt}]`;
            else if (img.src && !text.includes(img.src)) text += ` [IMG: ${img.src.split('/').pop()}]`;
        });
        return text;
    }

    looksLikeHeader(element) {
        const style = window.getComputedStyle(element);
        const tagName = (element.tagName || '').toLowerCase();
        const className = (typeof element.className === 'string' ? element.className : '').toLowerCase();
        
        return /^h[1-6]$/.test(tagName) ||
               /header|title|head/.test(className) ||
               element.getAttribute('role') === 'columnheader' ||
               (parseInt(style.fontWeight) || 400) >= 600 ||
               (parseFloat(style.fontSize) || 14) > 16 ||
               (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent');
    }

    inferColumnTypes(rows) {
        if (rows.length === 0) return [];
        const maxColumns = Math.max(...rows.map(row => row.length));
        const types = [];
        for (let col = 0; col < maxColumns; col++) {
            const values = rows.map(row => row[col] || '').filter(val => val.trim().length > 0);
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
}