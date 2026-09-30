import { RubricDimension } from './adapters/types.js';
/**
 * Rounds a number to a specified number of decimal places using round-half-up.
 * Avoids IEEE-754 floating-point drift (e.g. 28.05 * 10 = 280.49999999999994).
 */
export declare function roundHalfUp(value: number, decimals?: number): number;
export interface RubricComputationResult {
    expectedScore: number;
    canonicalBreakdown: Record<string, number>;
}
/**
 * Validates breakdown dimensions against the active rubric and computes the exact-weight average.
 * Enforces:
 * - All rubric dimensions must be present (case-insensitive).
 * - No unknown dimensions.
 * - Dimension percentages must be finite numbers in [20.0, 100.0].
 * - Dimension weights are exact (no sum-to-100 restriction).
 */
export declare function computeWeightedRubricScore(breakdown: Record<string, number>, rubric: RubricDimension[]): RubricComputationResult;
export interface ValidatedCandidateScore {
    score: number | null;
    breakdown: Record<string, number> | null;
    needsAssessment: boolean;
}
/**
 * Validates candidate score and breakdown according to the 4 canonical input scenarios:
 * Scenario A: Both provided -> validate bounds, coverage, and weighted average consistency (error on mismatch).
 * Scenario B: Breakdown provided, score omitted -> auto-calculate score from weighted average.
 * Scenario C: Score provided, breakdown omitted -> validate score in [0.0, 100.0], flag needsAssessment: true.
 * Scenario D: Neither provided -> store null/null, flag needsAssessment: true.
 */
export declare function validateCandidateScoreAndBreakdown(data: {
    score?: number | null;
    breakdown?: Record<string, number> | null;
}, rubric: RubricDimension[]): ValidatedCandidateScore;
