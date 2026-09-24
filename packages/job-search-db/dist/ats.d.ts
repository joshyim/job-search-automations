export type AtsPlatform = 'ashby' | 'greenhouse' | 'lever' | 'workday' | 'smartrecruiters' | 'rippling' | 'bamboohr' | 'jazzhr' | 'icims' | 'jobvite' | 'breezy' | 'workable' | 'recruitee' | 'custom';
/**
 * Normalizes an ATS platform identifier string to lowercase and trimmed.
 * Returns null if the value is empty or undefined.
 */
export declare function normalizeAtsPlatform(val?: string | null): string | null;
/**
 * Detects known ATS platform from a career page URL or job posting URL.
 * Returns normalized ATS platform name (e.g. 'ashby', 'greenhouse', 'lever'),
 * or null if the URL does not match any known ATS platform pattern.
 */
export declare function detectAtsPlatform(url?: string | null): string | null;
