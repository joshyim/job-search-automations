export type AtsPlatform =
  | 'ashby'
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'smartrecruiters'
  | 'rippling'
  | 'bamboohr'
  | 'jazzhr'
  | 'icims'
  | 'jobvite'
  | 'breezy'
  | 'workable'
  | 'recruitee'
  | 'custom';

/**
 * Normalizes an ATS platform identifier string to lowercase and trimmed.
 * Returns null if the value is empty or undefined.
 */
export function normalizeAtsPlatform(val?: string | null): string | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Detects known ATS platform from a career page URL or job posting URL.
 * Returns normalized ATS platform name (e.g. 'ashby', 'greenhouse', 'lever'),
 * or null if the URL does not match any known ATS platform pattern.
 */
export function detectAtsPlatform(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;

  let hostname = '';
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }

  if (hostname === 'ashbyhq.com' || hostname.endsWith('.ashbyhq.com')) {
    return 'ashby';
  }

  if (
    hostname === 'greenhouse.io' ||
    hostname.endsWith('.greenhouse.io') ||
    hostname === 'grnh.se' ||
    hostname.endsWith('.grnh.se')
  ) {
    return 'greenhouse';
  }

  if (hostname === 'lever.co' || hostname.endsWith('.lever.co')) {
    return 'lever';
  }

  if (
    hostname === 'myworkdayjobs.com' ||
    hostname.endsWith('.myworkdayjobs.com') ||
    hostname === 'workday.com' ||
    hostname.endsWith('.workday.com')
  ) {
    return 'workday';
  }

  if (hostname === 'smartrecruiters.com' || hostname.endsWith('.smartrecruiters.com')) {
    return 'smartrecruiters';
  }

  if (
    hostname === 'ats.rippling.com' ||
    hostname === 'rippling-ats.com' ||
    hostname.endsWith('.rippling-ats.com')
  ) {
    return 'rippling';
  }

  if (hostname === 'bamboohr.com' || hostname.endsWith('.bamboohr.com')) {
    return 'bamboohr';
  }

  if (
    hostname === 'applytojob.com' ||
    hostname.endsWith('.applytojob.com') ||
    hostname === 'jazzhr.com' ||
    hostname.endsWith('.jazzhr.com')
  ) {
    return 'jazzhr';
  }

  if (hostname === 'icims.com' || hostname.endsWith('.icims.com')) {
    return 'icims';
  }

  if (hostname === 'jobvite.com' || hostname.endsWith('.jobvite.com')) {
    return 'jobvite';
  }

  if (hostname === 'breezy.hr' || hostname.endsWith('.breezy.hr')) {
    return 'breezy';
  }

  if (hostname === 'workable.com' || hostname.endsWith('.workable.com')) {
    return 'workable';
  }

  if (hostname === 'recruitee.com' || hostname.endsWith('.recruitee.com')) {
    return 'recruitee';
  }

  return null;
}
