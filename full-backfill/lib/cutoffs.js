export const SYBILL_CUTOFF_DAYS = 365;
export const SLACK_CUTOFF_DAYS = 30;

export function cutoffDateStr(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
