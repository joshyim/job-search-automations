import fs from 'node:fs';
import path from 'node:path';
import {
  Candidate,
  CandidateFilters,
  CandidateStatus,
  Company,
  DataAdapter,
  QueueEntry,
  QueueStatus,
  RubricDimension,
  RunLog,
  Skill,
  TitlePattern,
  TitlePatternType,
} from '../types.js';
import { MarkdownTableParser } from './markdown-parser.js';

export class LocalAdapter implements DataAdapter {
  private workflowDataPath: string;

  constructor(workflowDataPath: string) {
    this.workflowDataPath = workflowDataPath;
  }

  private getFilePath(filename: string): string {
    return path.join(this.workflowDataPath, filename);
  }

  private readFile(filename: string, defaultContent = ''): string {
    const fullPath = this.getFilePath(filename);
    if (!fs.existsSync(fullPath)) {
      return defaultContent;
    }
    return fs.readFileSync(fullPath, 'utf-8');
  }

  private writeFile(filename: string, content: string): void {
    if (!fs.existsSync(this.workflowDataPath)) {
      fs.mkdirSync(this.workflowDataPath, { recursive: true });
    }
    const fullPath = this.getFilePath(filename);
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  public async initialize(): Promise<void> {
    if (!fs.existsSync(this.workflowDataPath)) {
      fs.mkdirSync(this.workflowDataPath, { recursive: true });
    }

    // Initialize target-companies.md if missing
    if (!fs.existsSync(this.getFilePath('target-companies.md'))) {
      const initialContent = `# Target Companies\n\n| Company | Careers URL | Excluded | Notes | Last Searched |\n| --- | --- | --- | --- | --- |\n`;
      this.writeFile('target-companies.md', initialContent);
    }

    // Initialize target-job-titles-and-skills.md if missing
    if (!fs.existsSync(this.getFilePath('target-job-titles-and-skills.md'))) {
      const initialContent = `# Target Job Titles and Skills\n\n## Title Patterns\n\n| Pattern | Type | Level | Notes |\n| --- | --- | --- | --- |\n\n## Skills\n\n| Skill | Category | Importance | Notes |\n| --- | --- | --- | --- |\n`;
      this.writeFile('target-job-titles-and-skills.md', initialContent);
    }

    // Initialize scoring-rubric.md if missing
    if (!fs.existsSync(this.getFilePath('scoring-rubric.md'))) {
      const initialContent = `# Scoring Rubric\n\n| Dimension | Weight | Poor (1-2) | Moderate (3) | Strong (4-5) |\n| --- | --- | --- | --- | --- |\n| Title match | 25% | Little to no title relevance | Partial title keyword overlap | Exact title match or target senior/lead level |\n| Skills match | 30% | Missing required core stack | Has some core skills, missing others | Full alignment with required and preferred stack |\n| Experience match | 25% | Insufficient domain/system scale | Relevant domain, minor gaps in scale | Proven track record in equivalent problem domain |\n| Seniority fit | 20% | Misaligned seniority level | Adjacent seniority level | Matches target Staff/Principal IC level |\n`;
      this.writeFile('scoring-rubric.md', initialContent);
    }

    // Initialize crawl-queue.md if missing
    if (!fs.existsSync(this.getFilePath('crawl-queue.md'))) {
      const initialContent = `# Crawl Queue\n\n| URL | Company | Status | Notes | Queued At |\n| --- | --- | --- | --- | --- |\n`;
      this.writeFile('crawl-queue.md', initialContent);
    }

    // Initialize job-candidates.md if missing
    if (!fs.existsSync(this.getFilePath('job-candidates.md'))) {
      const initialContent = `# Job Candidates\n\n| Company | Job Title | URL | Location | Score | Breakdown | Status | Discovered At | Applied At | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
      this.writeFile('job-candidates.md', initialContent);
    }

    // Initialize logs.md if missing
    if (!fs.existsSync(this.getFilePath('logs.md'))) {
      const initialContent = `# Run Logs\n\n| Timestamp | Mode | Companies Processed | URLs Queued | Candidates Scored | Summary | Details |\n| --- | --- | --- | --- | --- | --- | --- |\n`;
      this.writeFile('logs.md', initialContent);
    }
  }

  public async close(): Promise<void> {
    // No-op for local filesystem adapter
  }

  // --- Companies ---

  public async listCompanies(includeExcluded = false): Promise<Company[]> {
    const content = this.readFile('target-companies.md');
    const table = MarkdownTableParser.parseTable(content);
    const companies: Company[] = table.rows.map(row => ({
      name: row['Company'] || '',
      careers_url: row['Careers URL'] || '',
      is_excluded: (row['Excluded'] || '').toLowerCase() === 'yes' || (row['Excluded'] || '').toLowerCase() === 'true',
      notes: row['Notes'] || null,
      last_searched_at: row['Last Searched'] || null,
    })).filter(c => c.name.length > 0);

    if (!includeExcluded) {
      return companies.filter(c => !c.is_excluded);
    }
    return companies;
  }

  public async addCompany(data: { name: string; careers_url: string; notes?: string; last_searched_at?: string }): Promise<Company> {
    const content = this.readFile('target-companies.md');
    const headers = ['Company', 'Careers URL', 'Excluded', 'Notes', 'Last Searched'];
    const table = MarkdownTableParser.parseTable(content);
    
    let existingIndex = table.rows.findIndex(
      r => (r['Company'] || '').toLowerCase() === data.name.toLowerCase()
    );

    const updatedCompany: Company = {
      name: data.name,
      careers_url: data.careers_url,
      is_excluded: false,
      notes: data.notes || null,
      last_searched_at: data.last_searched_at !== undefined
        ? data.last_searched_at
        : (existingIndex >= 0 ? (table.rows[existingIndex]['Last Searched'] || null) : null),
    };

    const newRowRecord: Record<string, string> = {
      'Company': updatedCompany.name,
      'Careers URL': updatedCompany.careers_url,
      'Excluded': 'No',
      'Notes': updatedCompany.notes || '',
      'Last Searched': updatedCompany.last_searched_at || '',
    };

    if (existingIndex >= 0) {
      table.rows[existingIndex] = newRowRecord;
    } else {
      table.rows.push(newRowRecord);
    }

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows);
    this.writeFile('target-companies.md', updatedContent);

    return updatedCompany;
  }

  public async updateCompany(currentName: string, updates: Partial<Company>): Promise<Company> {
    const content = this.readFile('target-companies.md');
    const headers = ['Company', 'Careers URL', 'Excluded', 'Notes', 'Last Searched'];
    const table = MarkdownTableParser.parseTable(content);

    const existingIndex = table.rows.findIndex(
      r => (r['Company'] || '').toLowerCase() === currentName.toLowerCase()
    );

    if (existingIndex < 0) {
      throw new Error(`Company "${currentName}" not found`);
    }

    const row = table.rows[existingIndex];
    if (updates.name !== undefined) row['Company'] = updates.name;
    if (updates.careers_url !== undefined) row['Careers URL'] = updates.careers_url;
    if (updates.is_excluded !== undefined) row['Excluded'] = updates.is_excluded ? 'Yes' : 'No';
    if (updates.notes !== undefined) row['Notes'] = updates.notes || '';
    if (updates.last_searched_at !== undefined) row['Last Searched'] = updates.last_searched_at || '';

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows);
    this.writeFile('target-companies.md', updatedContent);

    return {
      name: row['Company'],
      careers_url: row['Careers URL'],
      is_excluded: (row['Excluded'] || '').toLowerCase() === 'yes' || (row['Excluded'] || '').toLowerCase() === 'true',
      notes: row['Notes'] || null,
      last_searched_at: row['Last Searched'] || null,
    };
  }

  public async excludeCompany(name: string, reason?: string): Promise<Company> {
    const content = this.readFile('target-companies.md');
    const headers = ['Company', 'Careers URL', 'Excluded', 'Notes', 'Last Searched'];
    const table = MarkdownTableParser.parseTable(content);

    let existingIndex = table.rows.findIndex(
      r => (r['Company'] || '').toLowerCase() === name.toLowerCase()
    );

    if (existingIndex < 0) {
      // If company doesn't exist, create it as excluded
      const newCompany: Company = {
        name,
        careers_url: '',
        is_excluded: true,
        notes: reason || 'Excluded',
        last_searched_at: null,
      };
      table.rows.push({
        'Company': name,
        'Careers URL': '',
        'Excluded': 'Yes',
        'Notes': reason || 'Excluded',
        'Last Searched': '',
      });
      const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows);
      this.writeFile('target-companies.md', updatedContent);
      return newCompany;
    }

    const existingRow = table.rows[existingIndex];
    existingRow['Excluded'] = 'Yes';
    if (reason) {
      existingRow['Notes'] = existingRow['Notes'] ? `${existingRow['Notes']} (${reason})` : reason;
    }

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows);
    this.writeFile('target-companies.md', updatedContent);

    return {
      name: existingRow['Company'],
      careers_url: existingRow['Careers URL'],
      is_excluded: true,
      notes: existingRow['Notes'] || null,
      last_searched_at: existingRow['Last Searched'] || null,
    };
  }

  public async getBatch(limit: number): Promise<Company[]> {
    const all = await this.listCompanies(false); // only non-excluded
    // Sort by last_searched_at ascending (null/empty values first)
    all.sort((a, b) => {
      if (!a.last_searched_at && !b.last_searched_at) return 0;
      if (!a.last_searched_at) return -1;
      if (!b.last_searched_at) return 1;
      return new Date(a.last_searched_at).getTime() - new Date(b.last_searched_at).getTime();
    });
    return all.slice(0, limit);
  }

  // --- Title Patterns & Skills ---

  public async listTitlePatterns(type?: TitlePatternType): Promise<TitlePattern[]> {
    const content = this.readFile('target-job-titles-and-skills.md');
    const table = MarkdownTableParser.parseTable(content, '## Title Patterns');
    const patterns: TitlePattern[] = table.rows.map(r => ({
      pattern: r['Pattern'] || '',
      type: ((r['Type'] || '').toLowerCase() === 'exclude' ? 'exclude' : 'include') as TitlePatternType,
      level: r['Level'] || null,
      notes: r['Notes'] || null,
    })).filter(p => p.pattern.length > 0);

    if (type) {
      return patterns.filter(p => p.type === type);
    }
    return patterns;
  }

  public async addTitlePattern(data: { pattern: string; type: TitlePatternType; level?: string; notes?: string }): Promise<TitlePattern> {
    const content = this.readFile('target-job-titles-and-skills.md');
    const headers = ['Pattern', 'Type', 'Level', 'Notes'];
    const table = MarkdownTableParser.parseTable(content, '## Title Patterns');

    const existingIdx = table.rows.findIndex(
      r => (r['Pattern'] || '').toLowerCase() === data.pattern.toLowerCase() &&
           (r['Type'] || '').toLowerCase() === data.type.toLowerCase()
    );

    const newRowRecord: Record<string, string> = {
      'Pattern': data.pattern,
      'Type': data.type,
      'Level': data.level || '',
      'Notes': data.notes || '',
    };

    if (existingIdx >= 0) {
      table.rows[existingIdx] = newRowRecord;
    } else {
      table.rows.push(newRowRecord);
    }

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows, '## Title Patterns');
    this.writeFile('target-job-titles-and-skills.md', updatedContent);

    return {
      pattern: data.pattern,
      type: data.type,
      level: data.level || null,
      notes: data.notes || null,
    };
  }

  public async updateTitlePattern(pattern: string, type: TitlePatternType, updates: Partial<TitlePattern>): Promise<TitlePattern> {
    const content = this.readFile('target-job-titles-and-skills.md');
    const headers = ['Pattern', 'Type', 'Level', 'Notes'];
    const table = MarkdownTableParser.parseTable(content, '## Title Patterns');

    const existingIdx = table.rows.findIndex(
      r => (r['Pattern'] || '').toLowerCase() === pattern.toLowerCase() &&
           (r['Type'] || '').toLowerCase() === type.toLowerCase()
    );

    if (existingIdx < 0) {
      throw new Error(`Title pattern "${pattern}" (${type}) not found`);
    }

    const row = table.rows[existingIdx];
    if (updates.pattern !== undefined) row['Pattern'] = updates.pattern;
    if (updates.type !== undefined) row['Type'] = updates.type;
    if (updates.level !== undefined) row['Level'] = updates.level || '';
    if (updates.notes !== undefined) row['Notes'] = updates.notes || '';

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows, '## Title Patterns');
    this.writeFile('target-job-titles-and-skills.md', updatedContent);

    return {
      pattern: row['Pattern'],
      type: row['Type'] as TitlePatternType,
      level: row['Level'] || null,
      notes: row['Notes'] || null,
    };
  }

  public async removeTitlePattern(pattern: string, type?: TitlePatternType): Promise<boolean> {
    const content = this.readFile('target-job-titles-and-skills.md');
    const headers = ['Pattern', 'Type', 'Level', 'Notes'];
    const table = MarkdownTableParser.parseTable(content, '## Title Patterns');

    const initialLen = table.rows.length;
    table.rows = table.rows.filter(r => {
      const matchPattern = (r['Pattern'] || '').toLowerCase() === pattern.toLowerCase();
      if (!matchPattern) return true;
      if (type) {
        return (r['Type'] || '').toLowerCase() !== type.toLowerCase();
      }
      return false;
    });

    if (table.rows.length !== initialLen) {
      const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows, '## Title Patterns');
      this.writeFile('target-job-titles-and-skills.md', updatedContent);
      return true;
    }
    return false;
  }

  public async listSkills(category?: string): Promise<Skill[]> {
    const content = this.readFile('target-job-titles-and-skills.md');
    const table = MarkdownTableParser.parseTable(content, '## Skills');
    const skills: Skill[] = table.rows.map(r => ({
      name: r['Skill'] || '',
      category: r['Category'] || null,
      importance: r['Importance'] || null,
      notes: r['Notes'] || null,
    })).filter(s => s.name.length > 0);

    if (category) {
      return skills.filter(s => (s.category || '').toLowerCase() === category.toLowerCase());
    }
    return skills;
  }

  public async addSkill(data: { name: string; category?: string; importance?: string; notes?: string }): Promise<Skill> {
    const content = this.readFile('target-job-titles-and-skills.md');
    const headers = ['Skill', 'Category', 'Importance', 'Notes'];
    const table = MarkdownTableParser.parseTable(content, '## Skills');

    const existingIdx = table.rows.findIndex(
      r => (r['Skill'] || '').toLowerCase() === data.name.toLowerCase()
    );

    const newRow: Record<string, string> = {
      'Skill': data.name,
      'Category': data.category || '',
      'Importance': data.importance || 'preferred',
      'Notes': data.notes || '',
    };

    if (existingIdx >= 0) {
      table.rows[existingIdx] = newRow;
    } else {
      table.rows.push(newRow);
    }

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows, '## Skills');
    this.writeFile('target-job-titles-and-skills.md', updatedContent);

    return {
      name: data.name,
      category: data.category || null,
      importance: data.importance || 'preferred',
      notes: data.notes || null,
    };
  }

  public async updateSkill(name: string, updates: Partial<Skill>): Promise<Skill> {
    const content = this.readFile('target-job-titles-and-skills.md');
    const headers = ['Skill', 'Category', 'Importance', 'Notes'];
    const table = MarkdownTableParser.parseTable(content, '## Skills');

    const existingIdx = table.rows.findIndex(
      r => (r['Skill'] || '').toLowerCase() === name.toLowerCase()
    );

    if (existingIdx < 0) {
      throw new Error(`Skill "${name}" not found`);
    }

    const row = table.rows[existingIdx];
    if (updates.name !== undefined) row['Skill'] = updates.name;
    if (updates.category !== undefined) row['Category'] = updates.category || '';
    if (updates.importance !== undefined) row['Importance'] = updates.importance || '';
    if (updates.notes !== undefined) row['Notes'] = updates.notes || '';

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows, '## Skills');
    this.writeFile('target-job-titles-and-skills.md', updatedContent);

    return {
      name: row['Skill'],
      category: row['Category'] || null,
      importance: row['Importance'] || null,
      notes: row['Notes'] || null,
    };
  }

  public async removeSkill(name: string): Promise<boolean> {
    const content = this.readFile('target-job-titles-and-skills.md');
    const headers = ['Skill', 'Category', 'Importance', 'Notes'];
    const table = MarkdownTableParser.parseTable(content, '## Skills');

    const initialLen = table.rows.length;
    table.rows = table.rows.filter(r => (r['Skill'] || '').toLowerCase() !== name.toLowerCase());

    if (table.rows.length !== initialLen) {
      const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows, '## Skills');
      this.writeFile('target-job-titles-and-skills.md', updatedContent);
      return true;
    }
    return false;
  }

  // --- Scoring Rubric ---

  public async getScoringRubric(): Promise<RubricDimension[]> {
    const content = this.readFile('scoring-rubric.md');
    const table = MarkdownTableParser.parseTable(content);
    return table.rows.map(r => {
      const rawWeight = (r['Weight'] || '').replace('%', '').trim();
      const weightNum = parseFloat(rawWeight) || 0;
      return {
        dimension: (r['Dimension'] || '').trim(),
        weight: weightNum,
        poor_description: r['Poor (1-2)'] ? r['Poor (1-2)'].trim() : null,
        moderate_description: r['Moderate (3)'] ? r['Moderate (3)'].trim() : null,
        strong_description: r['Strong (4-5)'] ? r['Strong (4-5)'].trim() : null,
      };
    }).filter(d => d.dimension.length > 0);
  }

  public async updateRubricDimension(dimension: string, updates: Partial<RubricDimension>): Promise<RubricDimension> {
    const content = this.readFile('scoring-rubric.md');
    const headers = ['Dimension', 'Weight', 'Poor (1-2)', 'Moderate (3)', 'Strong (4-5)'];
    const table = MarkdownTableParser.parseTable(content);

    const target = dimension.trim().toLowerCase();
    const idx = table.rows.findIndex(
      r => (r['Dimension'] || '').trim().toLowerCase() === target
    );

    if (idx < 0) {
      throw new Error(`Rubric dimension not found: ${dimension}`);
    }

    const row = table.rows[idx];
    if (updates.weight !== undefined) {
      row['Weight'] = `${updates.weight}%`;
    }
    if (updates.poor_description !== undefined) {
      row['Poor (1-2)'] = updates.poor_description || '';
    }
    if (updates.moderate_description !== undefined) {
      row['Moderate (3)'] = updates.moderate_description || '';
    }
    if (updates.strong_description !== undefined) {
      row['Strong (4-5)'] = updates.strong_description || '';
    }

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows);
    this.writeFile('scoring-rubric.md', updatedContent);

    const weightNum = parseFloat(row['Weight'].replace('%', '').trim()) || 0;
    return {
      dimension: row['Dimension'].trim(),
      weight: weightNum,
      poor_description: row['Poor (1-2)'] ? row['Poor (1-2)'].trim() : null,
      moderate_description: row['Moderate (3)'] ? row['Moderate (3)'].trim() : null,
      strong_description: row['Strong (4-5)'] ? row['Strong (4-5)'].trim() : null,
    };
  }

  public async addRubricDimension(dimension: RubricDimension): Promise<RubricDimension> {
    const content = this.readFile('scoring-rubric.md');
    const headers = ['Dimension', 'Weight', 'Poor (1-2)', 'Moderate (3)', 'Strong (4-5)'];
    const table = MarkdownTableParser.parseTable(content);

    const target = dimension.dimension.trim().toLowerCase();
    const idx = table.rows.findIndex(
      r => (r['Dimension'] || '').trim().toLowerCase() === target
    );

    const weightStr = `${dimension.weight}%`;

    if (idx >= 0) {
      const existing = table.rows[idx];
      table.rows[idx] = {
        'Dimension': dimension.dimension.trim() || existing['Dimension'],
        'Weight': weightStr,
        'Poor (1-2)': dimension.poor_description !== undefined ? (dimension.poor_description || '') : existing['Poor (1-2)'],
        'Moderate (3)': dimension.moderate_description !== undefined ? (dimension.moderate_description || '') : existing['Moderate (3)'],
        'Strong (4-5)': dimension.strong_description !== undefined ? (dimension.strong_description || '') : existing['Strong (4-5)'],
      };
    } else {
      table.rows.push({
        'Dimension': dimension.dimension.trim(),
        'Weight': weightStr,
        'Poor (1-2)': dimension.poor_description || '',
        'Moderate (3)': dimension.moderate_description || '',
        'Strong (4-5)': dimension.strong_description || '',
      });
    }

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows);
    this.writeFile('scoring-rubric.md', updatedContent);

    return {
      dimension: dimension.dimension.trim(),
      weight: dimension.weight,
      poor_description: dimension.poor_description || null,
      moderate_description: dimension.moderate_description || null,
      strong_description: dimension.strong_description || null,
    };
  }

  public async removeRubricDimension(dimension: string): Promise<boolean> {
    const content = this.readFile('scoring-rubric.md');
    const headers = ['Dimension', 'Weight', 'Poor (1-2)', 'Moderate (3)', 'Strong (4-5)'];
    const table = MarkdownTableParser.parseTable(content);

    const target = dimension.trim().toLowerCase();
    const initialLen = table.rows.length;
    table.rows = table.rows.filter(
      r => (r['Dimension'] || '').trim().toLowerCase() !== target
    );

    if (table.rows.length !== initialLen) {
      const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows);
      this.writeFile('scoring-rubric.md', updatedContent);
      return true;
    }
    return false;
  }

  // --- Crawl Queue ---

  public async checkUrlExists(url: string): Promise<{ exists: boolean; entry?: QueueEntry }> {
    const content = this.readFile('crawl-queue.md');
    const table = MarkdownTableParser.parseTable(content);
    const row = table.rows.find(r => (r['URL'] || '').trim() === url.trim());
    if (!row) {
      return { exists: false };
    }
    return {
      exists: true,
      entry: {
        url: row['URL'],
        company_name: row['Company'] || '',
        status: (row['Status'] || 'pending') as QueueStatus,
        notes: row['Notes'] || null,
        created_at: row['Queued At'] || undefined,
      },
    };
  }

  public async addToQueue(data: { url: string; company_name: string; notes?: string }): Promise<QueueEntry> {
    const content = this.readFile('crawl-queue.md');
    const headers = ['URL', 'Company', 'Status', 'Notes', 'Queued At'];
    const table = MarkdownTableParser.parseTable(content);

    const existingIdx = table.rows.findIndex(r => (r['URL'] || '').trim() === data.url.trim());
    const nowIso = new Date().toISOString();

    const entry: QueueEntry = {
      url: data.url,
      company_name: data.company_name,
      status: 'pending',
      notes: data.notes || null,
      created_at: existingIdx >= 0 ? table.rows[existingIdx]['Queued At'] : nowIso,
    };

    const rowRecord: Record<string, string> = {
      'URL': entry.url,
      'Company': entry.company_name,
      'Status': entry.status,
      'Notes': entry.notes || '',
      'Queued At': entry.created_at || nowIso,
    };

    if (existingIdx >= 0) {
      table.rows[existingIdx] = rowRecord;
    } else {
      table.rows.push(rowRecord);
    }

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows);
    this.writeFile('crawl-queue.md', updatedContent);

    return entry;
  }

  public async getPendingQueue(companyName?: string, limit?: number): Promise<QueueEntry[]> {
    const content = this.readFile('crawl-queue.md');
    const table = MarkdownTableParser.parseTable(content);

    let entries: QueueEntry[] = table.rows
      .filter(r => (r['Status'] || '').toLowerCase() === 'pending')
      .map(r => ({
        url: r['URL'] || '',
        company_name: r['Company'] || '',
        status: 'pending' as QueueStatus,
        notes: r['Notes'] || null,
        created_at: r['Queued At'] || undefined,
      }));

    if (companyName) {
      entries = entries.filter(e => e.company_name.toLowerCase() === companyName.toLowerCase());
    }

    if (limit && limit > 0) {
      return entries.slice(0, limit);
    }
    return entries;
  }

  public async listQueue(filters?: { status?: QueueStatus; company_name?: string; limit?: number }): Promise<QueueEntry[]> {
    const content = this.readFile('crawl-queue.md');
    const table = MarkdownTableParser.parseTable(content);

    let entries: QueueEntry[] = table.rows.map(r => ({
      url: r['URL'] || '',
      company_name: r['Company'] || '',
      status: ((r['Status'] || 'pending').toLowerCase() as QueueStatus),
      notes: r['Notes'] || null,
      created_at: r['Queued At'] || undefined,
    }));

    if (filters?.status) {
      entries = entries.filter(e => e.status.toLowerCase() === filters.status!.toLowerCase());
    }
    if (filters?.company_name) {
      entries = entries.filter(e => e.company_name.toLowerCase() === filters.company_name!.toLowerCase());
    }
    if (filters?.limit && filters.limit > 0) {
      entries = entries.slice(0, filters.limit);
    }
    return entries;
  }

  public async updateQueueStatus(url: string, status: QueueStatus, notes?: string): Promise<QueueEntry> {
    const content = this.readFile('crawl-queue.md');
    const headers = ['URL', 'Company', 'Status', 'Notes', 'Queued At'];
    const table = MarkdownTableParser.parseTable(content);

    const idx = table.rows.findIndex(r => (r['URL'] || '').trim() === url.trim());
    if (idx < 0) {
      throw new Error(`Queue entry not found for URL: ${url}`);
    }

    const row = table.rows[idx];
    row['Status'] = status;
    if (notes) {
      row['Notes'] = notes;
    }

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows);
    this.writeFile('crawl-queue.md', updatedContent);

    return {
      url: row['URL'],
      company_name: row['Company'],
      status,
      notes: row['Notes'] || null,
      created_at: row['Queued At'] || undefined,
    };
  }

  // --- Candidates ---

  public async addCandidate(data: {
    company_name: string;
    job_title: string;
    url: string;
    location?: string;
    score?: number;
    breakdown?: Record<string, number>;
    notes?: string;
    status?: CandidateStatus;
  }): Promise<Candidate> {
    const content = this.readFile('job-candidates.md');
    const headers = [
      'Company',
      'Job Title',
      'URL',
      'Location',
      'Score',
      'Breakdown',
      'Status',
      'Discovered At',
      'Applied At',
      'Notes',
    ];
    const table = MarkdownTableParser.parseTable(content);

    const existingIdx = table.rows.findIndex(r => (r['URL'] || '').trim() === data.url.trim());
    const nowIso = new Date().toISOString();

    const candidate: Candidate = {
      company_name: data.company_name,
      job_title: data.job_title,
      url: data.url,
      location: data.location || null,
      score: data.score !== undefined ? data.score : null,
      breakdown: data.breakdown || null,
      status: data.status || 'new',
      notes: data.notes || null,
      discovered_at: existingIdx >= 0 ? (table.rows[existingIdx]['Discovered At'] || nowIso) : nowIso,
      applied_at: existingIdx >= 0 ? (table.rows[existingIdx]['Applied At'] || null) : null,
    };

    const rowRecord: Record<string, string> = {
      'Company': candidate.company_name,
      'Job Title': candidate.job_title,
      'URL': candidate.url,
      'Location': candidate.location || '',
      'Score': candidate.score !== null && candidate.score !== undefined ? String(candidate.score) : '',
      'Breakdown': candidate.breakdown ? JSON.stringify(candidate.breakdown) : '',
      'Status': candidate.status,
      'Discovered At': candidate.discovered_at || nowIso,
      'Applied At': candidate.applied_at || '',
      'Notes': candidate.notes || '',
    };

    if (existingIdx >= 0) {
      table.rows[existingIdx] = rowRecord;
    } else {
      table.rows.push(rowRecord);
    }

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows);
    this.writeFile('job-candidates.md', updatedContent);

    return candidate;
  }

  public async updateCandidateStatus(url: string, status: CandidateStatus, notes?: string): Promise<Candidate> {
    const content = this.readFile('job-candidates.md');
    const headers = [
      'Company',
      'Job Title',
      'URL',
      'Location',
      'Score',
      'Breakdown',
      'Status',
      'Discovered At',
      'Applied At',
      'Notes',
    ];
    const table = MarkdownTableParser.parseTable(content);

    const idx = table.rows.findIndex(r => (r['URL'] || '').trim() === url.trim());
    if (idx < 0) {
      throw new Error(`Candidate not found with URL: ${url}`);
    }

    const row = table.rows[idx];
    row['Status'] = status;
    if (status === 'applied' && !row['Applied At']) {
      row['Applied At'] = new Date().toISOString();
    }
    if (notes) {
      row['Notes'] = notes;
    }

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows);
    this.writeFile('job-candidates.md', updatedContent);

    let parsedBreakdown: Record<string, number> | null = null;
    if (row['Breakdown']) {
      try {
        parsedBreakdown = JSON.parse(row['Breakdown']);
      } catch {
        parsedBreakdown = null;
      }
    }

    return {
      company_name: row['Company'],
      job_title: row['Job Title'],
      url: row['URL'],
      location: row['Location'] || null,
      score: row['Score'] ? parseFloat(row['Score']) : null,
      breakdown: parsedBreakdown,
      status: row['Status'] as CandidateStatus,
      discovered_at: row['Discovered At'] || undefined,
      applied_at: row['Applied At'] || null,
      notes: row['Notes'] || null,
    };
  }

  public async getCandidates(filters?: CandidateFilters): Promise<Candidate[]> {
    const content = this.readFile('job-candidates.md');
    const table = MarkdownTableParser.parseTable(content);

    let candidates: Candidate[] = table.rows.map(r => {
      let parsedBreakdown: Record<string, number> | null = null;
      if (r['Breakdown']) {
        try {
          parsedBreakdown = JSON.parse(r['Breakdown']);
        } catch {
          parsedBreakdown = null;
        }
      }

      return {
        company_name: r['Company'] || '',
        job_title: r['Job Title'] || '',
        url: r['URL'] || '',
        location: r['Location'] || null,
        score: r['Score'] ? parseFloat(r['Score']) : null,
        breakdown: parsedBreakdown,
        status: (r['Status'] || 'new') as CandidateStatus,
        discovered_at: r['Discovered At'] || undefined,
        applied_at: r['Applied At'] || null,
        notes: r['Notes'] || null,
      };
    }).filter(c => c.url.length > 0);

    if (filters?.status) {
      candidates = candidates.filter(c => {
        if (c.status === filters.status) return true;
        if (filters.status === 'in_progress' && (c.status as string === 'interviewing' || c.status as string === 'in progress')) return true;
        if ((filters.status === 'not_pursuing' || filters.status === 'closed') && (c.status === 'not_pursuing' || c.status === 'closed' || (c.status as string) === 'rejected' || (c.status as string) === 'offer')) return true;
        return false;
      });
    }
    if (filters?.company_name) {
      candidates = candidates.filter(c => c.company_name.toLowerCase() === filters.company_name?.toLowerCase());
    }
    if (filters?.min_score !== undefined) {
      candidates = candidates.filter(c => c.score !== null && c.score !== undefined && c.score >= (filters.min_score || 0));
    }

    const sortBy = filters?.sort_by || 'score';
    const sortOrder = filters?.sort_order || 'desc';

    candidates.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'score') {
        const scoreA = a.score ?? -Infinity;
        const scoreB = b.score ?? -Infinity;
        comparison = scoreA - scoreB;
      } else if (sortBy === 'discovered_at') {
        const dateA = a.discovered_at ? new Date(a.discovered_at).getTime() : 0;
        const dateB = b.discovered_at ? new Date(b.discovered_at).getTime() : 0;
        comparison = dateA - dateB;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    if (filters?.limit && filters.limit > 0) {
      return candidates.slice(0, filters.limit);
    }

    return candidates;
  }

  // --- Run Logs ---

  public async logRun(data: {
    companies_processed: string[];
    urls_queued: number;
    candidates_scored: number;
    summary?: string;
    details?: Record<string, unknown>;
  }): Promise<RunLog> {
    const content = this.readFile('logs.md');
    const headers = [
      'Timestamp',
      'Mode',
      'Companies Processed',
      'URLs Queued',
      'Candidates Scored',
      'Summary',
      'Details',
    ];
    const table = MarkdownTableParser.parseTable(content);

    const nowIso = new Date().toISOString();
    const log: RunLog = {
      timestamp: nowIso,
      mode: 'local',
      companies_processed: data.companies_processed,
      urls_queued: data.urls_queued,
      candidates_scored: data.candidates_scored,
      summary: data.summary || null,
      details: data.details || null,
    };

    const rowRecord: Record<string, string> = {
      'Timestamp': nowIso,
      'Mode': log.mode,
      'Companies Processed': JSON.stringify(log.companies_processed),
      'URLs Queued': String(log.urls_queued),
      'Candidates Scored': String(log.candidates_scored),
      'Summary': log.summary || '',
      'Details': log.details ? JSON.stringify(log.details) : '',
    };

    table.rows.push(rowRecord);

    const updatedContent = MarkdownTableParser.updateTableInContent(content, headers, table.rows);
    this.writeFile('logs.md', updatedContent);

    return log;
  }

  public async getRecentRuns(limit = 10): Promise<RunLog[]> {
    const content = this.readFile('logs.md');
    const table = MarkdownTableParser.parseTable(content);

    const runs: RunLog[] = table.rows.map(r => {
      let companies: string[] = [];
      if (r['Companies Processed']) {
        try {
          companies = JSON.parse(r['Companies Processed']);
        } catch {
          companies = [];
        }
      }

      let details: Record<string, unknown> | null = null;
      if (r['Details']) {
        try {
          details = JSON.parse(r['Details']);
        } catch {
          details = null;
        }
      }

      return {
        timestamp: r['Timestamp'] || undefined,
        mode: r['Mode'] || 'local',
        companies_processed: companies,
        urls_queued: parseInt(r['URLs Queued'] || '0', 10),
        candidates_scored: parseInt(r['Candidates Scored'] || '0', 10),
        summary: r['Summary'] || null,
        details,
      };
    });

    runs.reverse(); // Most recent first
    return runs.slice(0, limit);
  }
}
