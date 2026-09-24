import { describe, it, expect } from 'vitest';
import { detectAtsPlatform, normalizeAtsPlatform } from '../src/ats.js';

describe('ATS Platform Detection & Normalization', () => {
  describe('normalizeAtsPlatform', () => {
    it('normalizes uppercase and mixed-case platform strings', () => {
      expect(normalizeAtsPlatform('Greenhouse')).toBe('greenhouse');
      expect(normalizeAtsPlatform('  ASHBY  ')).toBe('ashby');
      expect(normalizeAtsPlatform('Lever')).toBe('lever');
    });

    it('returns null for empty, whitespace, or invalid values', () => {
      expect(normalizeAtsPlatform('')).toBeNull();
      expect(normalizeAtsPlatform('   ')).toBeNull();
      expect(normalizeAtsPlatform(undefined)).toBeNull();
      expect(normalizeAtsPlatform(null)).toBeNull();
    });
  });

  describe('detectAtsPlatform', () => {
    it('detects Ashby URLs', () => {
      expect(detectAtsPlatform('https://jobs.ashbyhq.com/openai')).toBe('ashby');
      expect(detectAtsPlatform('https://ashbyhq.com/company')).toBe('ashby');
      expect(detectAtsPlatform('https://sub.jobs.ashbyhq.com/posting/123')).toBe('ashby');
    });

    it('detects Greenhouse URLs', () => {
      expect(detectAtsPlatform('https://boards.greenhouse.io/github')).toBe('greenhouse');
      expect(detectAtsPlatform('https://job-boards.greenhouse.io/stripe')).toBe('greenhouse');
      expect(detectAtsPlatform('https://greenhouse.io/embed/job_board?for=acme')).toBe('greenhouse');
      expect(detectAtsPlatform('https://grnh.se/abc123xyz')).toBe('greenhouse');
    });

    it('detects Lever URLs', () => {
      expect(detectAtsPlatform('https://jobs.lever.co/netflix')).toBe('lever');
      expect(detectAtsPlatform('https://api.lever.co/v0/postings/netflix')).toBe('lever');
      expect(detectAtsPlatform('https://lever.co/careers')).toBe('lever');
    });

    it('detects Workday URLs', () => {
      expect(detectAtsPlatform('https://target.myworkdayjobs.com/targetcareers')).toBe('workday');
      expect(detectAtsPlatform('https://wd5.myworkdayjobs.com/company/job/123')).toBe('workday');
      expect(detectAtsPlatform('https://workday.com/jobs')).toBe('workday');
    });

    it('detects other known ATS platforms', () => {
      expect(detectAtsPlatform('https://jobs.smartrecruiters.com/acme')).toBe('smartrecruiters');
      expect(detectAtsPlatform('https://ats.rippling.com/company')).toBe('rippling');
      expect(detectAtsPlatform('https://company.bamboohr.com/careers')).toBe('bamboohr');
      expect(detectAtsPlatform('https://company.applytojob.com/apply/123')).toBe('jazzhr');
      expect(detectAtsPlatform('https://careers-company.icims.com/jobs/123')).toBe('icims');
      expect(detectAtsPlatform('https://jobs.jobvite.com/company')).toBe('jobvite');
      expect(detectAtsPlatform('https://company.breezy.hr/p/123')).toBe('breezy');
      expect(detectAtsPlatform('https://apply.workable.com/company/j/123')).toBe('workable');
      expect(detectAtsPlatform('https://company.recruitee.com/o/123')).toBe('recruitee');
    });

    it('returns null for custom or unrecognized URLs', () => {
      expect(detectAtsPlatform('https://stripe.com/jobs')).toBeNull();
      expect(detectAtsPlatform('https://airbnb.com/careers')).toBeNull();
      expect(detectAtsPlatform('https://example.com/openings')).toBeNull();
    });

    it('returns null for invalid or non-URL strings', () => {
      expect(detectAtsPlatform('')).toBeNull();
      expect(detectAtsPlatform(null)).toBeNull();
      expect(detectAtsPlatform(undefined)).toBeNull();
      expect(detectAtsPlatform('not-a-url')).toBeNull();
    });
  });
});
