# CognitoTable - AI Web Data Extractor

A powerful Chrome extension that revolutionizes web data extraction using multi-modal AI pipeline for reliable tabular data extraction from any web page.

## Features

- **Intelligent Table Detection**: Uses both explicit HTML table detection and advanced heuristics to find implicit tabular data
- **Multi-Modal Analysis**: Combines visual, structural, and semantic analysis for accurate data extraction
- **Visual Alignment Detection**: Analyzes element positioning and spacing to identify grid-like structures
- **Content Type Inference**: Automatically detects column types (numbers, dates, currency, emails, etc.)
- **Real-time Preview**: Interactive table preview with sorting and filtering
- **Multiple Export Formats**: Export to CSV, JSON, and more
- **Performance Optimized**: Uses Web Workers and debounced analysis for responsive performance

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The CognitoTable icon should appear in your toolbar

## Usage

1. Navigate to any webpage with tabular data
2. Click the CognitoTable extension icon in your toolbar
3. The extension will automatically scan for tables and show a count badge
4. Click on any detected table to preview and interact with the data
5. Use the export buttons to download data in your preferred format

## Advanced Features

### Deep Scan
Click "Deep Scan for Implicit Tables" to perform a more thorough analysis of the page, looking for hidden tabular structures that might not be immediately obvious.

### Manual Selection
Use "Manually Select Area" to manually define regions of the page that contain tabular data.

### Multi-Page Extraction
The "Multi-Page Extraction" feature (coming soon) will allow you to extract data across multiple pages with pagination.

## Detection Algorithm

CognitoTable uses a sophisticated multi-tier detection system:

### Tier 1: Explicit Table Detection
- Identifies standard HTML `<table>` elements
- Processes `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` with full colspan/rowspan support

### Tier 2: Implicit Table Detection
- **Structural Similarity**: Analyzes DOM structures for repeating patterns
- **Visual Alignment**: Examines element positioning, spacing, and dimensions
- **Content Homogeneity**: Looks for consistent data types and patterns
- **Semantic Clues**: Identifies table-related CSS classes and semantic elements

### Confidence Scoring
Each detected table receives a confidence score based on:
- Visual alignment consistency
- Structural homogeneity
- Content pattern recognition
- Semantic indicators

## Data Types Supported

The extension automatically detects and handles various data types:

- **Numbers**: Integers and floating-point numbers
- **Currency**: Various currency symbols and formats
- **Dates**: Multiple date formats (MM/DD/YYYY, DD/MM/YYYY, etc.)
- **Time**: Time stamps and durations
- **URLs**: Web addresses and links
- **Emails**: Email addresses
- **Phone Numbers**: Various phone number formats
- **Boolean**: True/false, yes/no values
- **Text**: General text content

## Export Formats

- **CSV**: Comma-separated values for spreadsheet applications
- **JSON**: JavaScript Object Notation for programming use
- **TSV**: Tab-separated values (coming soon)
- **Excel**: Direct Excel format export (coming soon)

## Browser Compatibility

- Chrome 88+
- Chromium-based browsers (Edge, Brave, etc.)
- Manifest V3 compatible

## Performance Considerations

- Uses Web Workers for heavy computations
- Debounced DOM observation for dynamic content
- Aggressive caching for improved performance
- Lazy analysis to minimize initial page load impact

## Privacy

- All processing happens locally in your browser
- No data is sent to external servers
- Optional anonymous usage analytics (can be disabled)

## Technical Architecture

The extension consists of several components:

1. **Content Script** (`content.js`): Performs DOM analysis and table detection
2. **Background Script** (`background.js`): Coordinates between components and manages state
3. **Popup Interface** (`popup.html/js/css`): User interface for table interaction
4. **Manifest** (`manifest.json`): Extension configuration and permissions

## Development

To modify or extend the extension:

1. Make your changes to the source files
2. Reload the extension in `chrome://extensions/`
3. Test on various websites with different table structures

## Known Limitations

- Very complex CSS layouts may require manual adjustment
- Dynamic content that loads after initial scan may need refresh
- Some anti-scraping mechanisms may interfere with detection
- Performance may vary on pages with thousands of elements

## Roadmap

- [ ] Vision-Language Model integration for advanced visual analysis
- [ ] Machine learning model for improved pattern recognition
- [ ] Multi-page extraction with automated pagination
- [ ] Advanced data cleaning and transformation tools
- [ ] Integration with popular data analysis tools
- [ ] Mobile browser support

## Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.

## License

MIT License - see LICENSE file for details.

## Support

For support, please create an issue in the GitHub repository or contact the development team.
