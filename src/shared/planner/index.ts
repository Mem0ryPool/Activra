/**
 * Smart Achievement Planner: offline text → plan → achievements, with deterministic progress.
 * The parser is behind `PlanParser`, so a different parser (e.g. a future AI one) can produce the
 * same `PlanDraft` without touching the preview, storage or unlock rules.
 */
export * from './types'
export { ruleBasedParser, parsePlanText, splitClauses, normalizeText, defaultPlanTitle } from './ruleParser'
export * from './draft'
export * from './achievements'
export { goalNoun, neutralPlanTitle, suggestPlanTitle } from './naming'
export { ACHIEVEMENT_TEMPLATES, categorize, templateFor } from './templates'
export { planFocusSummary, type PlanFocusSummary } from './focus'
