import { z } from 'zod';

/**
 * Validates that a string is a well-formed HTTP or HTTPS URL.
 * Rejects non-HTTP schemes (e.g. file:, javascript:, data:, ftp:) and invalid URL strings.
 */
export const httpUrlSchema = z.string().refine(
  (val) => {
    try {
      const url = new URL(val);
      return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
    } catch {
      return false;
    }
  },
  { message: 'URL must be a valid HTTP or HTTPS URL' }
);
