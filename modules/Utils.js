/**
 * @author : Zahir
 * Desc : General utility functions
 */
class Utils {
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static createTableContentSignature(tableData) {
        const parts = [];
        if (tableData.headers && tableData.headers.length > 0) {
            parts.push('H:' + tableData.headers.join('|'));
        }
        if (tableData.rows && tableData.rows.length > 0) {
            const rowsToCheck = tableData.rows.slice(0, 3);
            rowsToCheck.forEach((row, index) => {
                parts.push(`R${index}:` + row.join('|'));
            });
        }
        parts.push(`Count:${tableData.rows.length}x${tableData.headers ? tableData.headers.length : 0}`);
        return parts.join('::');
    }

    static generatePreview(tableData, maxRows = 3, maxCols = 4) {
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
}