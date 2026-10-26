/** Household-level safety thresholds. No imports here on purpose: used by prompts, approvals and tests. */

/** Purchases above this amount always need an admin; below — the agent just records them. */
export const MONEY_THRESHOLD = { amount: 200, currency: 'AED' };
