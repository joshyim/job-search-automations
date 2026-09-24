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
export declare class MarkdownTableParser {
    /**
     * Parses cells from a markdown table row line: | col1 | col2 | ... |
     */
    private static parseRowCells;
    /**
     * Checks if a line is a markdown table separator row: | --- | :---: | ---: |
     */
    private static isSeparatorRow;
    /**
     * Escapes special characters (like unescaped '|') for table cell output.
     */
    static escapeCell(value: string | number | boolean | null | undefined): string;
    /**
     * Unescapes a table cell value.
     */
    static unescapeCell(value: string): string;
    /**
     * Parses a single table from markdown content.
     * If sectionHeading is provided, finds the table under that markdown heading (e.g. "## Title Patterns").
     */
    static parseTable(content: string, sectionHeading?: string): ParsedTable;
    /**
     * Formats headers and rows into a clean GFM markdown table.
     */
    static formatTable(headers: string[], rows: Record<string, string>[]): string;
    /**
     * Updates or replaces a table within markdown content, preserving surrounding text.
     */
    static updateTableInContent(content: string, headers: string[], newRows: Record<string, string>[], sectionHeading?: string): string;
}
