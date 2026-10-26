/** Return a stable YYYY-MM-DD date for a named IANA time zone. */
export function dateISOInTimeZone(date: Date = new Date(), timeZone = 'Asia/Bahrain'): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year ?? '1970'}-${values.month ?? '01'}-${values.day ?? '01'}`
}
