/**
 * @author : Zahir
 * Desc : Handles extraction from virtualized (infinite scroll) tables.
 */
class VirtualizedTableHandler {
    constructor(tableAnalyzer, domUtils) {
        this.tableAnalyzer = tableAnalyzer;
        this.domUtils = domUtils;
    }

    detectVirtualizedTable(container) {
        const indicators = [
            () => !!container.querySelector('[class*="react"], [data-react], [class*="virtual"], [class*="infinite"]'),
            () => {
                const scrollableParent = this.findScrollableParent(container);
                return scrollableParent && container.querySelectorAll('*').length > 20 && container.children.length < 50;
            },
            () => {
                const rowElements = Array.from(container.querySelectorAll('[class*="row"], [class*="item"], tr, li'));
                if (rowElements.length > 3) {
                    const estimatedRowHeight = container.offsetHeight / rowElements.length;
                    const estimatedMaxVisibleRows = Math.ceil(window.innerHeight / estimatedRowHeight);
                    return rowElements.length <= estimatedMaxVisibleRows * 3;
                }
                return false;
            },
            () => Array.from(container.querySelectorAll('*')).some(el => {
                const style = window.getComputedStyle(el);
                return style.transform && style.transform !== 'none' && (style.transform.includes('translateY') || style.transform.includes('translate3d'));
            }),
            () => container.querySelectorAll('[class*="lazy"], [class*="load"], [class*="page"], [class*="more"]').length > 0,
            () => ['react-table', 'react-grid', 'ag-grid', 'data-table'].some(className => container.querySelector(`[class*="${className}"]`)),
            () => container.querySelectorAll('tr, [class*="row"], [class*="item"], li').length >= 5
        ];

        return indicators.some(check => check());
    }

    async extractVirtualizedTableData(container) {
        const scrollTargets = this.findAllScrollableElements(container);
        let bestResult = null;

        for (const scrollableElement of scrollTargets) {
            const originalScrollTop = scrollableElement.scrollTop;
            try {
                const result = await this.performScrollExtraction(container, scrollableElement);
                if (result && (!bestResult || result.rows.length > bestResult.rows.length)) {
                    bestResult = result;
                }
            } catch (error) {
                console.warn(`Error with scrollable element:`, error);
            } finally {
                if (scrollableElement !== window) scrollableElement.scrollTop = originalScrollTop;
            }
        }

        if (!bestResult || bestResult.rows.length < 15) {
            const zoomResult = await this.simulateZoomExtraction(container);
            if (zoomResult && (!bestResult || zoomResult.rows.length > bestResult.rows.length)) {
                bestResult = zoomResult;
            }
            const deepScanResult = await this.performDeepTableScan(container);
            if (deepScanResult && (!bestResult || deepScanResult.rows.length > bestResult.rows.length)) {
                bestResult = deepScanResult;
            }
        }

        return bestResult || await this.tableAnalyzer.analyzeImplicitTable(container);
    }
    
    findScrollableParent(element) {
        let current = element;
        let depth = 0;
        while (current && depth++ < 10) {
            const style = window.getComputedStyle(current);
            const isScrollable = /auto|scroll/.test(style.overflow + style.overflowY);
            if (isScrollable && current.scrollHeight > current.clientHeight) {
                return current;
            }
            current = current.parentElement;
        }
        return document.body.scrollHeight > window.innerHeight ? document.body : null;
    }

    findAllScrollableElements(container) {
        const scrollableElements = new Set();
        if (document.body.scrollHeight > window.innerHeight) {
            scrollableElements.add(window);
        }
        let current = container;
        while (current) {
            const style = window.getComputedStyle(current);
            if (/auto|scroll/.test(style.overflow + style.overflowY) && current.scrollHeight > current.clientHeight) {
                scrollableElements.add(current);
            }
            current = current.parentElement;
        }
        return Array.from(scrollableElements);
    }

    async performScrollExtraction(container, scrollableElement) {
        const allRowsWithPositions = [];
        const seenRows = new Set();
        let headers = [];

        const isWindow = scrollableElement === window || scrollableElement === document.body;
        const getMaxScroll = () => isWindow ? document.documentElement.scrollHeight - window.innerHeight : scrollableElement.scrollHeight - scrollableElement.clientHeight;

        for (let step = 0; step <= 10; step++) {
            const maxScroll = getMaxScroll();
            if (maxScroll <= 0) break;
            
            const scrollPosition = (maxScroll / 10) * step;
            isWindow ? window.scrollTo(0, scrollPosition) : (scrollableElement.scrollTop = scrollPosition);
            await Utils.sleep(300);

            const stepData = await this.tableAnalyzer.analyzeImplicitTable(container);
            if (stepData) {
                if (stepData.headers.length > headers.length) headers = stepData.headers;
                stepData.rows.forEach(row => {
                    const rowKey = row.join('|');
                    if (!seenRows.has(rowKey)) {
                        seenRows.add(rowKey);
                        allRowsWithPositions.push({ data: row, scroll: scrollPosition, order: allRowsWithPositions.length });
                    }
                });
            }
        }
        
        allRowsWithPositions.sort((a, b) => a.scroll !== b.scroll ? a.scroll - b.scroll : a.order - b.order);
        const rows = allRowsWithPositions.map(r => r.data);
        return { headers, rows, columnTypes: this.tableAnalyzer.inferColumnTypes(rows) };
    }
    
    async simulateZoomExtraction(container) {
        const originalStyles = { transform: document.body.style.transform, origin: document.body.style.transformOrigin, width: document.body.style.width, height: document.body.style.height };
        try {
            document.body.style.transform = 'scale(0.5)';
            document.body.style.transformOrigin = '0 0';
            document.body.style.width = '200%';
            document.body.style.height = '200%';
            await Utils.sleep(500);
            return await this.tableAnalyzer.analyzeImplicitTable(container);
        } finally {
            document.body.style.transform = originalStyles.transform;
            document.body.style.transformOrigin = originalStyles.origin;
            document.body.style.width = originalStyles.width;
            document.body.style.height = originalStyles.height;
            await Utils.sleep(200);
        }
    }

    async performDeepTableScan(container) {
        const rowSelectors = ['[class*="row"]', '[class*="item"]', '[role="row"]', 'tr', 'li'];
        const searchRoot = container.closest('[class*="table"], [class*="grid"], [class*="list"]') || container;
        const rowCandidates = rowSelectors.flatMap(selector => Array.from(searchRoot.querySelectorAll(selector)));
        
        const rowsWithPositions = [];
        const seenRowKeys = new Set();
        let headers = [];

        for (const rowElement of rowCandidates) {
            if (!this.domUtils.isVisibleElement(rowElement)) continue;
            
            const rowData = this.tableAnalyzer.extractCellsFromElement(rowElement);
            const rowKey = rowData.join('|');
            if (rowData.length > 0 && !seenRowKeys.has(rowKey)) {
                seenRowKeys.add(rowKey);
                rowsWithPositions.push({ data: rowData, domPosition: this.domUtils.calculateDOMPosition(rowElement, searchRoot) });
                if (rowData.length > headers.length && this.tableAnalyzer.looksLikeHeader(rowElement)) {
                    headers = rowData;
                }
            }
        }

        if (rowsWithPositions.length > 0) {
            const sortedRows = rowsWithPositions.sort((a, b) => a.domPosition - b.domPosition).map(row => row.data);
            return {
                headers: headers.length > 0 ? headers : Array.from({ length: Math.max(...sortedRows.map(r => r.length)) }, (_, i) => `Column ${i + 1}`),
                rows: sortedRows,
                columnTypes: this.tableAnalyzer.inferColumnTypes(sortedRows)
            };
        }
        return null;
    }
}