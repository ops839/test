/**
 * Short-form title aliases → canonical client name.
 *
 * Applied AFTER the full-client-name substring check and BEFORE the
 * domain-map fallback. Matched as whole words (word-boundary regex),
 * case-insensitive. Extend this file. Do not edit classifier.js.
 *
 * Rules:
 *   - Canonical name on the right MUST appear in KNOWN_CLIENTS.
 *   - Don't add ambiguous short forms (e.g. "blu" collides with Blu Mountain).
 */
export const TITLE_ALIASES = {
  select: 'Select Exterminating',
  'hall st': 'Hall Street 3PL',
  hallstreet: 'Hall Street 3PL',
  polar: 'Polar Analytics',
  'blu sky': 'Blu Sky',
  blusky: 'Blu Sky',
  razor: 'Razor Metrics',
  poppins: 'Poppins Payroll',
  wisconsin: 'Wisconsin Carports',
  ssa: 'SSA Group',
  'estate lawyers': 'The Estate Lawyers',
};
