/**
 * Rounds a number to a specified number of decimal places using round-half-up.
 * Avoids IEEE-754 floating-point drift (e.g. 28.05 * 10 = 280.49999999999994).
 */
export function roundHalfUp(value, decimals = 1) {
    if (!Number.isFinite(value)) {
        return value;
    }
    return Number(Math.round(Number(value + 'e' + decimals)) + 'e-' + decimals);
}
/**
 * Validates breakdown dimensions against the active rubric and computes the exact-weight average.
 * Enforces:
 * - All rubric dimensions must be present (case-insensitive).
 * - No unknown dimensions.
 * - Dimension percentages must be finite numbers in [20.0, 100.0].
 * - Dimension weights are exact (no sum-to-100 restriction).
 */
export function computeWeightedRubricScore(breakdown, rubric) {
    if (!rubric || rubric.length === 0) {
        throw new Error('Cannot compute rubric score: active scoring rubric has no dimensions');
    }
    const breakdownKeys = Object.keys(breakdown);
    if (breakdownKeys.length === 0) {
        throw new Error('Breakdown object cannot be empty');
    }
    const totalWeight = rubric.reduce((sum, d) => sum + Number(d.weight), 0);
    if (totalWeight <= 0) {
        throw new Error('Total rubric weight must be greater than zero');
    }
    // Create a map of normalized dimension names
    const rubricMap = new Map();
    for (const d of rubric) {
        rubricMap.set(d.dimension.trim().toLowerCase(), d);
    }
    // Check for unknown dimensions in breakdown
    for (const key of breakdownKeys) {
        if (!rubricMap.has(key.trim().toLowerCase())) {
            throw new Error(`Unknown rubric dimension in breakdown: "${key}"`);
        }
    }
    // Check coverage and validate range [20.0, 100.0]
    const canonicalBreakdown = {};
    let weightedSum = 0;
    for (const d of rubric) {
        const normName = d.dimension.trim().toLowerCase();
        const matchingKey = breakdownKeys.find((k) => k.trim().toLowerCase() === normName);
        if (matchingKey === undefined) {
            throw new Error(`Missing rubric dimension in breakdown: "${d.dimension}"`);
        }
        const val = breakdown[matchingKey];
        if (typeof val !== 'number' || !Number.isFinite(val)) {
            throw new Error(`Dimension "${d.dimension}" score must be a finite number`);
        }
        if (val < 20.0 || val > 100.0) {
            throw new Error(`Dimension "${d.dimension}" score ${val} is out of bounds [20.0, 100.0]`);
        }
        const roundedVal = roundHalfUp(val, 1);
        canonicalBreakdown[d.dimension] = roundedVal;
        weightedSum += roundedVal * Number(d.weight);
    }
    const unroundedAvg = weightedSum / totalWeight;
    const expectedScore = roundHalfUp(unroundedAvg, 1);
    return {
        expectedScore,
        canonicalBreakdown,
    };
}
/**
 * Validates candidate score and breakdown according to the 4 canonical input scenarios:
 * Scenario A: Both provided -> validate bounds, coverage, and weighted average consistency (error on mismatch).
 * Scenario B: Breakdown provided, score omitted -> auto-calculate score from weighted average.
 * Scenario C: Score provided, breakdown omitted -> validate score in [0.0, 100.0], flag needsAssessment: true.
 * Scenario D: Neither provided -> store null/null, flag needsAssessment: true.
 */
export function validateCandidateScoreAndBreakdown(data, rubric) {
    // Validate overall score bounds if provided
    if (data.score !== undefined && data.score !== null) {
        if (typeof data.score !== 'number' || !Number.isFinite(data.score)) {
            throw new Error('Candidate score must be a finite number');
        }
        if (data.score < 0.0 || data.score > 100.0) {
            throw new Error(`Candidate score ${data.score} is out of bounds [0.0, 100.0]`);
        }
    }
    // Validate breakdown if provided
    if (data.breakdown !== undefined && data.breakdown !== null) {
        if (typeof data.breakdown !== 'object' || Array.isArray(data.breakdown)) {
            throw new Error('Candidate breakdown must be an object of dimension percentages');
        }
        const { expectedScore, canonicalBreakdown } = computeWeightedRubricScore(data.breakdown, rubric);
        // Scenario A: Both provided
        if (data.score !== undefined && data.score !== null) {
            const roundedScore = roundHalfUp(data.score, 1);
            if (Math.abs(roundedScore - expectedScore) > 0.1) {
                throw new Error(`Inconsistent candidate score: provided score ${data.score} does not match breakdown weighted average ${expectedScore}`);
            }
            return {
                score: roundedScore,
                breakdown: canonicalBreakdown,
                needsAssessment: false,
            };
        }
        // Scenario B: Breakdown provided, score omitted -> auto-calculate
        return {
            score: expectedScore,
            breakdown: canonicalBreakdown,
            needsAssessment: false,
        };
    }
    // Scenario C: Score provided, breakdown omitted -> provisional score, requires assessment flow
    if (data.score !== undefined && data.score !== null) {
        return {
            score: roundHalfUp(data.score, 1),
            breakdown: null,
            needsAssessment: true,
        };
    }
    // Scenario D: Neither provided -> unscored candidate, requires assessment flow
    return {
        score: null,
        breakdown: null,
        needsAssessment: true,
    };
}
