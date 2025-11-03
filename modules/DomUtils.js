/**
 * @author : Zahir
 * Desc : DOM utility functions
 */
class DomUtils {
    getElementSelector(element) {
        if (!element) return '';
        
        if (element.id) {
            const escapedId = CSS.escape ? CSS.escape(element.id) : element.id.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
            return `#${escapedId}`;
        }
        
        const escapeClassName = (className) => {
            if (!className) return '';
            if (CSS.escape) return CSS.escape(className);
            return className.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
        };
        
        const path = [];
        let current = element;
        
        while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 6) {
            let selector = current.nodeName.toLowerCase();
            
            if (typeof current.className === 'string' && current.className) {
                try {
                    const classes = Array.from(current.classList || [])
                        .filter(cls => cls && !cls.includes('[') && !cls.includes(']') && !/\s/.test(cls) && cls.length <= 50)
                        .slice(0, 2)
                        .map(cls => escapeClassName(cls));
                    
                    if (classes.length > 0) {
                        selector += '.' + classes.join('.');
                    }
                } catch (e) {
                    console.warn('Error processing classes:', e);
                }
            }
            
            if (!current.id && path.length < 3) {
                const siblings = Array.from(current.parentNode?.children || []).filter(sibling => sibling.nodeName === current.nodeName);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(current);
                    selector += `:nth-of-type(${index + 1})`;
                }
            }
            
            path.unshift(selector);
            current = current.parentNode;
        }
        
        const fullSelector = path.join(' > ');
        return fullSelector.length > 200 ? path.slice(-3).join(' > ') : fullSelector;
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

    isVisibleElement(element) {
        if (!element) return false;
        
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        
        const hasVisibleDimensions = rect.width > 0 && rect.height > 0;
        const isNotHidden = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        
        return hasVisibleDimensions && isNotHidden;
    }

    calculateDOMPosition(element, root = document) {
        let position = 0;
        let current = element;
        let depth = 0;
        
        while (current && current !== root && depth < 20) {
            const parent = current.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children);
                const index = siblings.indexOf(current);
                position += index * Math.pow(0.1, depth);
            }
            current = parent;
            depth++;
        }
        
        return position;
    }
}