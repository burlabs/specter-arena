import { describe, expect, it } from 'vitest';
import { isMondayToday, mondayOf, periodOf, startOfLocalDay } from './recapPeriods';

const HOUR = 3_600_000;
const utc = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number => Date.UTC(year, month - 1, day, hour, minute, second, ms);
const DENVER = 'America/Denver';

describe('startOfLocalDay', () => {
  it('is the UTC midnight in UTC', () => {
    expect(startOfLocalDay(utc(2026, 11, 25, 15, 30), 'UTC')).toBe(utc(2026, 11, 25));
  });

  it('gives a 23-hour day when Denver springs forward (2026-03-08)', () => {
    const start = startOfLocalDay(utc(2026, 3, 8, 18), DENVER);
    const next = startOfLocalDay(utc(2026, 3, 9, 18), DENVER);
    expect([start, next]).toEqual([utc(2026, 3, 8, 7), utc(2026, 3, 9, 6)]);
    expect((next - start) / HOUR).toBe(23);
  });

  it('gives a 25-hour day when Denver falls back (2026-11-01)', () => {
    const start = startOfLocalDay(utc(2026, 11, 1, 18), DENVER);
    const next = startOfLocalDay(utc(2026, 11, 2, 18), DENVER);
    expect([start, next]).toEqual([utc(2026, 11, 1, 6), utc(2026, 11, 2, 7)]);
    expect((next - start) / HOUR).toBe(25);
  });

  it('rolls a midnight that does not exist forward to the first valid instant (America/Havana, 2026-03-08)', () => {
    const start = startOfLocalDay(utc(2026, 3, 8, 12), 'America/Havana');
    expect(start).toBe(utc(2026, 3, 8, 5));
    expect(new Date(start).toLocaleString('en-US', { timeZone: 'America/Havana', hour12: false })).toContain('01:00:00');
    expect(startOfLocalDay(utc(2026, 3, 9, 12), 'America/Havana')).toBe(utc(2026, 3, 9, 4));
  });

  it('handles the 30-minute shift in Australia/Lord_Howe on both changes', () => {
    const zone = 'Australia/Lord_Howe';
    const springStart = startOfLocalDay(utc(2026, 10, 4, 5), zone);
    const springNext = startOfLocalDay(utc(2026, 10, 5, 5), zone);
    expect([springStart, springNext]).toEqual([utc(2026, 10, 3, 13, 30), utc(2026, 10, 4, 13)]);
    expect((springNext - springStart) / HOUR).toBe(23.5);
    const fallStart = startOfLocalDay(utc(2026, 4, 5, 3), zone);
    const fallNext = startOfLocalDay(utc(2026, 4, 6, 3), zone);
    expect((fallNext - fallStart) / HOUR).toBe(24.5);
  });

  it('keeps the instant just before and just at local midnight on their own days', () => {
    expect(startOfLocalDay(utc(2026, 11, 26, 6, 59, 59, 999), DENVER)).toBe(utc(2026, 11, 25, 7));
    expect(startOfLocalDay(utc(2026, 11, 26, 7), DENVER)).toBe(utc(2026, 11, 26, 7));
  });

  it('reads the zone of the machine when none is given', () => {
    const now = utc(2026, 11, 25, 15);
    const start = startOfLocalDay(now);
    expect(start).toBeLessThanOrEqual(now);
    expect(now - start).toBeLessThan(25 * HOUR);
  });
});

describe('mondayOf', () => {
  it('is the Monday of the calendar week, whatever the weekday', () => {
    const monday = utc(2026, 11, 23, 7);
    for (const day of [23, 24, 25, 26, 27, 28, 29]) expect(mondayOf(utc(2026, 11, day, 20), DENVER)).toBe(monday);
    expect(mondayOf(utc(2026, 11, 30, 20), DENVER)).toBe(utc(2026, 11, 30, 7));
  });

  it('keeps Monday 00:00 Monday across a DST change inside the week', () => {
    expect(mondayOf(utc(2026, 3, 8, 12), DENVER)).toBe(utc(2026, 3, 2, 7));
    expect(mondayOf(utc(2026, 11, 3, 12), DENVER)).toBe(utc(2026, 11, 2, 7));
  });

  it('crosses a month and a year boundary by calendar date', () => {
    expect(mondayOf(utc(2027, 1, 2, 12), 'UTC')).toBe(utc(2026, 12, 28));
  });
});

describe('periodOf', () => {
  const now = utc(2026, 11, 25, 15, 30, 12, 345);

  it('Today runs from local midnight to now', () => {
    expect(periodOf('today', now, DENVER)).toEqual({ kind: 'today', fromMs: utc(2026, 11, 25, 7), toMs: now });
  });

  it('Yesterday runs from the previous local midnight to the latest local midnight', () => {
    expect(periodOf('yesterday', now, DENVER)).toEqual({ kind: 'yesterday', fromMs: utc(2026, 11, 24, 7), toMs: utc(2026, 11, 25, 7) });
  });

  it('Yesterday is 23 hours long when it is the spring-forward day and 25 hours when it is the fall-back day', () => {
    const spring = periodOf('yesterday', utc(2026, 3, 9, 15), DENVER);
    const fall = periodOf('yesterday', utc(2026, 11, 2, 15), DENVER);
    expect((spring.toMs - spring.fromMs) / HOUR).toBe(23);
    expect((fall.toMs - fall.fromMs) / HOUR).toBe(25);
  });

  it('This week runs from local Monday 00:00 to now', () => {
    expect(periodOf('week', now, DENVER)).toEqual({ kind: 'week', fromMs: utc(2026, 11, 23, 7), toMs: now });
  });

  it('the week that holds the spring-forward day is 6 days 23 hours at its longest (Sunday 23:59:59.999)', () => {
    const period = periodOf('week', utc(2026, 3, 9, 5, 59, 59, 999), DENVER);
    expect(period.fromMs).toBe(utc(2026, 3, 2, 7));
    expect(period.toMs - period.fromMs).toBe(167 * HOUR - 1);
  });

  it('the week that holds the fall-back day is 7 days 1 hour at its longest, under the route limit of 8 days', () => {
    const period = periodOf('week', utc(2026, 11, 2, 6, 59, 59, 999), DENVER);
    expect(period.fromMs).toBe(utc(2026, 10, 26, 6));
    expect(period.toMs - period.fromMs).toBe(169 * HOUR - 1);
    expect(period.toMs - period.fromMs).toBeLessThan(8 * 24 * HOUR);
  });

  it('on a Monday, This week equals Today and says so', () => {
    const monday = utc(2026, 11, 23, 20);
    const week = periodOf('week', monday, DENVER);
    const today = periodOf('today', monday, DENVER);
    expect({ fromMs: week.fromMs, toMs: week.toMs }).toEqual({ fromMs: today.fromMs, toMs: today.toMs });
    expect(isMondayToday(monday, DENVER)).toBe(true);
    expect(isMondayToday(utc(2026, 11, 24, 20), DENVER)).toBe(false);
  });

  it('is never empty, even at exactly local midnight', () => {
    const midnight = utc(2026, 11, 25, 7);
    expect(periodOf('today', midnight, DENVER)).toEqual({ kind: 'today', fromMs: midnight, toMs: midnight + 1 });
    expect(periodOf('week', utc(2026, 11, 23, 7), DENVER).toMs).toBe(utc(2026, 11, 23, 7) + 1);
  });

  it('lets the zone shape the period: the same instant is two different days in Denver and UTC', () => {
    const instant = utc(2026, 11, 25, 3);
    expect(periodOf('today', instant, 'UTC').fromMs).toBe(utc(2026, 11, 25));
    expect(periodOf('today', instant, DENVER).fromMs).toBe(utc(2026, 11, 24, 7));
  });
});
