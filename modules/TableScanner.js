/**
 * @author : Zahir
 * Desc : Scans the DOM to find explicit and implicit tables.
 */
class TableScanner {
    constructor(domUtils, tableAnalyzer) {
        this.domUtils = domUtils;
        this.tableAnalyzer = tableAnalyzer; // Needed for some analysis
    }

    findExplicitTables() {
        return Array.from(document.querySelectorAll('table')).filter(table => this.domUtils.isVisibleElement(table));
    }

    async findImplicitTables() {
        const candidates = [];
        const containers = document.querySelectorAll('div, ul, section, [class*="table"], [class*="grid"], [role="table"]');
        
        for (const container of containers) {
            if (!this.domUtils.isVisibleElement(container)) continue;
            
            const children = Array.from(container.children);
            if (children.length < 2) continue;

            const analysis = await this.analyzeContainerForTablePattern(container, children);
            if (analysis.confidence > 0.6) {
                candidates.push({ element: container, confidence: analysis.confidence, children });
            }
        }
        
        return this.filterOverlappingTables(candidates).slice(0, 10);
    }
    
    filterOverlappingTables(candidates) {
        if (candidates.length <= 1) return candidates;
        
        const sorted = candidates.sort((a, b) => b.confidence - a.confidence);
        const filtered = [];
        
        for (const candidate of sorted) {
            let isOverlapping = false;
            for (const processed of filtered) {
                if (candidate.element.contains(processed.element) || processed.element.contains(candidate.element)) {
                    isOverlapping = true;
                    break;
                }
            }
            if (!isOverlapping) {
                filtered.push(candidate);
            }
        }
        return filtered;
    }

    async analyzeContainerForTablePattern(container, children) {
        const structuralSimilarity = this.calculateStructuralSimilarity(children);
        const visualAlignment = this.assessVisualAlignment(children);
        const contentHomogeneity = this.assessContentHomogeneity(children);
        const semanticClues = this.findSemanticTableClues(container);

        const confidence = (structuralSimilarity * 0.3) + (visualAlignment * 0.3) + (contentHomogeneity * 0.2) + (semanticClues * 0.2);
        
        return { confidence };
    }

    calculateStructuralSimilarity(elements) {
        if (elements.length < 2) return 0;
        const getSignature = el => `${el.tagName}:${Array.from(el.children).map(c => c.tagName).join(',')}`;
        const signatures = elements.map(getSignature);
        const signatureGroups = {};
        signatures.forEach(sig => signatureGroups[sig] = (signatureGroups[sig] || 0) + 1);
        return Math.max(...Object.values(signatureGroups)) / signatures.length;
    }

    assessVisualAlignment(elements) {
        if (elements.length < 2) return 0;
        const rects = elements.map(el => el.getBoundingClientRect());
        const calculateConsistency = values => {
            if (values.length < 2) return 1;
            const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
            const maxDeviation = Math.max(...values.map(val => Math.abs(val - avg)));
            return Math.max(0, 1 - (maxDeviation / Math.abs(avg)));
        };
        const leftAlignment = calculateConsistency(rects.map(r => r.left));
        const heightConsistency = calculateConsistency(rects.map(r => r.height));
        return (leftAlignment + heightConsistency) / 2;
    }

    assessContentHomogeneity(elements) {
        if (elements.length < 2) return 0;
        const cellPatterns = elements.map(el => {
            const cells = this.tableAnalyzer.extractCellsFromElement(el);
            return cells.map(cell => this.tableAnalyzer.classifyDataType(cell));
        });
        if (cellPatterns.length < 2) return 0;
        const maxColumns = Math.max(...cellPatterns.map(row => row.length));
        if (maxColumns === 0) return 0;
        let totalConsistency = 0;
        for (let col = 0; col < maxColumns; col++) {
            const columnTypes = cellPatterns.map(row => row[col] || 'empty');
            const typeGroups = {};
            columnTypes.forEach(type => typeGroups[type] = (typeGroups[type] || 0) + 1);
            totalConsistency += Math.max(...Object.values(typeGroups)) / columnTypes.length;
        }
        return totalConsistency / maxColumns;
    }

    findSemanticTableClues(container) {
        let score = 0;
        const keywords = ['table', 'grid', 'list', 'row', 'cell', 'data', 'item'];
        const classAndId = `${(container.className || '')} ${(container.id || '')}`.toLowerCase();
        if (keywords.some(kw => classAndId.includes(kw))) {
            score = 0.5;
        }
        if (container.querySelector('h1, h2, h3, th, .header, .title')) {
            score += 0.2;
        }
        return Math.min(1, score);
    }
}