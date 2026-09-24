import { z } from 'zod';
/**
 * Validates that a string is a well-formed HTTP or HTTPS URL.
 * Rejects non-HTTP schemes (e.g. file:, javascript:, data:, ftp:) and invalid URL strings.
 */
export declare const httpUrlSchema: z.ZodEffects<z.ZodString, string, string>;
