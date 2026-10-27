/**
 * Retired data repair: Correct a completed Woodland payment amount repair.
 *
 * FGP-1543: the team lead confirmed this migration has completed in production.
 * Customer-specific selectors and values were redacted on 2026-10-26.
 * Keep the filename and no-op export to preserve migrate-mongo history.
 * Restores that predate this repair require an authorised recovery procedure
 * using securely held data; do not reintroduce customer data into this file.
 */
export const up = async () => {
  // Intentionally retired: do not replay the completed data repair.
};
