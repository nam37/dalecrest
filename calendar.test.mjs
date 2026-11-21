import test from 'node:test';
import assert from 'node:assert/strict';
import { dateOf, formatDate, FOUNDED } from './engine/calendar.mjs';

test('the village calendar is the Julian one, with real weekdays', () => {
  // Counting days from known dates: Magna Carta was sealed on a Monday, Hastings fought on a Saturday.
  assert.equal(dateOf(0, { year: 1215, month: 6, day: 15 }).weekday, 'Monday');
  assert.equal(dateOf(0, { year: 1066, month: 10, day: 14 }).weekday, 'Saturday');
  // 1300 was a leap year in the Julian calendar, though it would not be in ours.
  assert.equal(formatDate(1440, 'full', { year: 1300, month: 2, day: 28 }), '29 February 1300');
  assert.equal(formatDate(2 * 1440, 'full', { year: 1300, month: 2, day: 28 }), '1 March 1300');
});

test('a village day is a calendar day, and the date moves on at midnight', () => {
  assert.deepEqual(dateOf(420), { ...FOUNDED, monthName: 'August', weekday: dateOf(0).weekday, villageDay: 1 });
  assert.equal(formatDate(1439, 'day'), '1 August');
  assert.equal(formatDate(1440, 'day'), '2 August');
  assert.equal(formatDate(31 * 1440, 'short'), '1 Sep');
  assert.equal(formatDate(153 * 1440, 'full'), '1 January 1313');
  assert.match(formatDate(0, 'long'), /^[A-Z][a-z]+day, 1 August 1312$/);
  // Seven days on is the same weekday, and a year on is one weekday later (two across a leap day).
  assert.equal(dateOf(7 * 1440).weekday, dateOf(0).weekday);
  assert.equal(formatDate(365 * 1440, 'full'), '1 August 1313');
});
