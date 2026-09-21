/**
 * Markdown Table Parser & Serializer
 * Supports GitHub Flavored Markdown (GFM) tables with round-trip fidelity,
 * section extraction, cell escaping, and whitespace preservation.
 */

export interface ParsedTable {
  sectionHeading?: string;
  headers: string[];
  rows: Record<string, string>[];
  rawPreamble: string;
  rawPostamble: string;
}

export class MarkdownTableParser {
  /**
   * Parses cells from a markdown table row line: | col1 | col2 | ... |
   */
  private static parseRowCells(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      return [];
    }

    const cells: string[] = [];
    let current = '';
    let escaped = false;

    // Skip the leading '|'
    for (let i = 1; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (escaped) {
        current += char;
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '|') {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim().length > 0) {
      cells.push(current.trim());
    }

    return cells;
  }

  /**
   * Checks if a line is a markdown table separator row: | --- | :---: | ---: |
   */
  private static isSeparatorRow(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
      return false;
    }
    const cells = trimmed.slice(1, -1).split('|');
    return cells.length > 0 && cells.every(c => /^[\s:-]+$/.test(c.trim()) && c.includes('-'));
  }

  /**
   * Escapes special characters (like unescaped '|') for table cell output.
   */
  public static escapeCell(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) {
      return '';
    }
    const str = String(value);
    // Replace unescaped pipe with \| and newlines with space
    return str.replace(/\\\|/g, '__ESCAPED_PIPE__')
              .replace(/\|/g, '\\|')
              .replace(/__ESCAPED_PIPE__/g, '\\|')
              .replace(/\r?\n/g, ' ');
  }

  /**
   * Unescapes a table cell value.
   */
  public static unescapeCell(value: string): string {
    return value.replace(/\\\|/g, '|').trim();
  }

  /**
   * Parses a single table from markdown content.
   * If sectionHeading is provided, finds the table under that markdown heading (e.g. "## Title Patterns").
   */
  public static parseTable(content: string, sectionHeading?: string): ParsedTable {
    const lines = content.split(/\r?\n/);
    let startIdx = -1;
    let endIdx = -1;
    let headerIdx = -1;
    let separatorIdx = -1;

    let inTargetSection = sectionHeading ? false : true;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (sectionHeading && line.trim().startsWith('#')) {
        const headingText = line.trim();
        if (headingText.toLowerCase() === sectionHeading.toLowerCase()) {
          inTargetSection = true;
          continue;
        } else if (inTargetSection && line.trim().startsWith('#')) {
          // Reached the next section
          break;
        }
      }

      if (inTargetSection && line.trim().startsWith('|')) {
        if (headerIdx === -1) {
          headerIdx = i;
        } else if (separatorIdx === -1) {
          if (this.isSeparatorRow(line)) {
            separatorIdx = i;
            startIdx = i + 1;
          } else {
            // Not a valid separator, reset
            headerIdx = -1;
          }
        } else {
          // We are reading rows
          endIdx = i;
        }
      } else if (separatorIdx !== -1 && !line.trim().startsWith('|')) {
        // Table finished
        break;
      }
    }

    if (headerIdx === -1 || separatorIdx === -1) {
      return {
        sectionHeading,
        headers: [],
        rows: [],
        rawPreamble: content,
        rawPostamble: '',
      };
    }

    const headerLine = lines[headerIdx];
    const headers = this.parseRowCells(headerLine).map(h => this.unescapeCell(h));
    const rows: Record<string, string>[] = [];

    const rowEnd = endIdx !== -1 ? endIdx + 1 : separatorIdx + 1;
    for (let r = startIdx; r < rowEnd; r++) {
      const cells = this.parseRowCells(lines[r]);
      if (cells.length === 0) continue;
      const rowObj: Record<string, string> = {};
      headers.forEach((header, index) => {
        rowObj[header] = cells[index] ? this.unescapeCell(cells[index]) : '';
      });
      rows.push(rowObj);
    }

    const rawPreamble = lines.slice(0, headerIdx).join('\n');
    const rawPostamble = lines.slice(rowEnd).join('\n');

    return {
      sectionHeading,
      headers,
      rows,
      rawPreamble,
      rawPostamble,
    };
  }

  /**
   * Formats headers and rows into a clean GFM markdown table.
   */
  public static formatTable(headers: string[], rows: Record<string, string>[]): string {
    if (headers.length === 0) {
      return '';
    }

    // Calculate column widths for clean alignment
    const colWidths: number[] = headers.map(h => h.length);

    const formattedRows: string[][] = rows.map(row => {
      return headers.map((header, idx) => {
        const val = this.escapeCell(row[header] || '');
        if (val.length > colWidths[idx]) {
          colWidths[idx] = val.length;
        }
        return val;
      });
    });

    // Ensure minimum column width of 3 for separator (---)
    for (let i = 0; i < colWidths.length; i++) {
      if (colWidths[i] < 3) {
        colWidths[i] = 3;
      }
    }

    const headerLine = '| ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + ' |';
    const separatorLine = '| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |';

    const bodyLines = formattedRows.map(rowCols => {
      return '| ' + rowCols.map((c, i) => c.padEnd(colWidths[i])).join(' | ') + ' |';
    });

    return [headerLine, separatorLine, ...bodyLines].join('\n');
  }

  /**
   * Updates or replaces a table within markdown content, preserving surrounding text.
   */
  public static updateTableInContent(
    content: string,
    headers: string[],
    newRows: Record<string, string>[],
    sectionHeading?: string
  ): string {
    const parsed = this.parseTable(content, sectionHeading);

    // If table was not found in content, append or create
    if (parsed.headers.length === 0) {
      const tableString = this.formatTable(headers, newRows);
      if (sectionHeading) {
        return (content ? content.trimEnd() + '\n\n' : '') + sectionHeading + '\n\n' + tableString + '\n';
      }
      return tableString + '\n';
    }

    const effectiveHeaders = headers.length > 0 ? headers : parsed.headers;
    const tableString = this.formatTable(effectiveHeaders, newRows);

    const preamble = parsed.rawPreamble.length > 0 ? parsed.rawPreamble + '\n' : '';
    const postamble = parsed.rawPostamble.length > 0 ? '\n' + parsed.rawPostamble : '\n';

    return preamble + tableString + postamble;
  }
}
