/** An ISO 8601 UTC time (Z, no milliseconds) n days from now, on the hour. */
export function inDays(days: number, hour = 10): string {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
