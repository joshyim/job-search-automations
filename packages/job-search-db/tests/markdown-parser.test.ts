import { describe, it, expect } from 'vitest';
import { MarkdownTableParser } from '../src/adapters/local/markdown-parser.js';

describe('MarkdownTableParser', () => {
  it('parses a basic markdown table with headers and rows', () => {
    const md = `# Title\n\n| Company | URL | Excluded |\n| --- | --- | --- |\n| Stripe | https://stripe.com | No |\n| Airbnb | https://airbnb.com | Yes |\n`;
    const parsed = MarkdownTableParser.parseTable(md);

    expect(parsed.headers).toEqual(['Company', 'URL', 'Excluded']);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]['Company']).toBe('Stripe');
    expect(parsed.rows[0]['URL']).toBe('https://stripe.com');
    expect(parsed.rows[0]['Excluded']).toBe('No');
    expect(parsed.rows[1]['Company']).toBe('Airbnb');
    expect(parsed.rows[1]['Excluded']).toBe('Yes');
  });

  it('escapes and unescapes pipes correctly in table cells', () => {
    const original = 'Fintech | Payments';
    const escaped = MarkdownTableParser.escapeCell(original);
    expect(escaped).toBe('Fintech \\| Payments');
    const unescaped = MarkdownTableParser.unescapeCell(escaped);
    expect(unescaped).toBe(original);
  });

  it('preserves round-trip fidelity when formatting parsed rows', () => {
    const initialContent = `# Target Companies\n\nPreamble text.\n\n| Company | Careers URL         | Excluded | Notes   |\n| ------- | ------------------- | -------- | ------- |\n| Stripe  | https://stripe.com  | No       | Fintech |\n\nFooter note.`;
    
    const parsed = MarkdownTableParser.parseTable(initialContent);
    const reformatted = MarkdownTableParser.updateTableInContent(
      initialContent,
      parsed.headers,
      parsed.rows
    );

    const reParsed = MarkdownTableParser.parseTable(reformatted);
    expect(reParsed.rows).toEqual(parsed.rows);
    expect(reformatted).toContain('Preamble text.');
    expect(reformatted).toContain('Footer note.');
  });

  it('isolates tables by markdown section headings', () => {
    const multiTableDoc = `
# Target Job Titles and Skills

## Title Patterns

| Pattern | Type | Level | Notes |
| --- | --- | --- | --- |
| Staff Engineer | include | Staff | IC |

## Skills

| Skill | Category | Importance | Notes |
| --- | --- | --- | --- |
| TypeScript | Languages | required | Primary |
| PostgreSQL | Databases | required | DB |
`;

    const titlesTable = MarkdownTableParser.parseTable(multiTableDoc, '## Title Patterns');
    expect(titlesTable.headers).toEqual(['Pattern', 'Type', 'Level', 'Notes']);
    expect(titlesTable.rows).toHaveLength(1);
    expect(titlesTable.rows[0]['Pattern']).toBe('Staff Engineer');

    const skillsTable = MarkdownTableParser.parseTable(multiTableDoc, '## Skills');
    expect(skillsTable.headers).toEqual(['Skill', 'Category', 'Importance', 'Notes']);
    expect(skillsTable.rows).toHaveLength(2);
    expect(skillsTable.rows[0]['Skill']).toBe('TypeScript');
    expect(skillsTable.rows[1]['Skill']).toBe('PostgreSQL');
  });

  it('updates a specific section table without affecting other sections', () => {
    const multiTableDoc = `# Multi Section\n\n## Title Patterns\n\n| Pattern | Type | Level | Notes |\n| --- | --- | --- | --- |\n| Old Title | include | Senior | Note |\n\n## Skills\n\n| Skill | Category | Importance | Notes |\n| --- | --- | --- | --- |\n| Python | Languages | preferred | Data |\n`;

    const updated = MarkdownTableParser.updateTableInContent(
      multiTableDoc,
      ['Pattern', 'Type', 'Level', 'Notes'],
      [{ Pattern: 'New Title', Type: 'include', Level: 'Staff', Notes: 'New Note' }],
      '## Title Patterns'
    );

    expect(updated).toContain('New Title');
    expect(updated).not.toContain('Old Title');
    expect(updated).toContain('Python'); // Skills section preserved!
  });
});
