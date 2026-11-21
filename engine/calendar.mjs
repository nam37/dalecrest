// The village calendar. The clock is still a count of minutes; this turns it into a date a person
// would say. Dalecrest keeps the Julian calendar, as England did, so weekdays and leap years are real ones.

// The founding day: Lammas, the first of August, when the harvest begins.
export const FOUNDED = { year: 1312, month: 8, day: 1 };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Julian calendar date to and from a running day number.
function dayNumber({ year, month, day }) {
  const a = Math.floor((14 - month) / 12), y = year + 4800 - a, m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
}
function fromDayNumber(n) {
  const c = n + 32082, d = Math.floor((4 * c + 3) / 1461), e = c - Math.floor(1461 * d / 4), m = Math.floor((5 * e + 2) / 153);
  return { day: e - Math.floor((153 * m + 2) / 5) + 1, month: m + 3 - 12 * Math.floor(m / 10), year: d - 4800 + Math.floor(m / 10) };
}

// The date a village minute falls on. villageDay counts from 1 on the founding day.
export function dateOf(minute, founded = FOUNDED) {
  const villageDay = Math.floor(minute / 1440) + 1, n = dayNumber(founded) + villageDay - 1;
  const date = fromDayNumber(n);
  return { ...date, monthName: MONTHS[date.month - 1], weekday: WEEKDAYS[(n + 1) % 7], villageDay };
}

// 'long' is "Tuesday, 1 August 1312", 'full' is "1 August 1312", 'day' is "1 August" and 'short' is "1 Aug".
export function formatDate(minute, style = 'full', founded = FOUNDED) {
  const d = dateOf(minute, founded);
  if (style === 'short') return d.day + ' ' + d.monthName.slice(0, 3);
  if (style === 'day') return d.day + ' ' + d.monthName;
  const full = d.day + ' ' + d.monthName + ' ' + d.year;
  return style === 'long' ? d.weekday + ', ' + full : full;
}
