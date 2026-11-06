import type { QuranReadingPace, QuranReadingState } from '../types';

export const QURAN_TRACKER_CATEGORY = '__planer_quran_reading__';
export const TOTAL_QURAN_PAGES = 604;
export const RAMADAN_DAYS = 30;
export const READINGS_PER_DAY = 5;
export const QURAN_PACES: readonly QuranReadingPace[] = [30, 15, 12, 10, 6];
export const PRAYER_LABELS = [
  'После Фаджра',
  'После Зухра',
  'После Асра',
  'После Магриба',
  'После Иша',
] as const;

export function pagesPerReading(pace: QuranReadingPace): number {
  // These user-requested plans all cover 600 pages in even installments.
  return 600 / (pace * READINGS_PER_DAY);
}

export function quranPageRange(pace: QuranReadingPace, day: number, prayer: number) {
  if (!Number.isInteger(day) || day < 0 || day >= RAMADAN_DAYS
    || !Number.isInteger(prayer) || prayer < 0 || prayer >= READINGS_PER_DAY) {
    throw new RangeError('Invalid Ramadan day or prayer');
  }
  const dayOfCycle = day % pace;
  const pages = pagesPerReading(pace);
  const start = dayOfCycle * pages * READINGS_PER_DAY + prayer * pages + 1;
  const lastReadingOfCycle = dayOfCycle === pace - 1 && prayer === READINGS_PER_DAY - 1;
  const end = start + pages - 1 + (lastReadingOfCycle ? 4 : 0);
  return { start, end, pages: end - start + 1, lastReadingOfCycle };
}

export function countCyclePages(plan: QuranReadingState, cycleIndex: number): number {
  const read = new Set(plan.completedSessions);
  let pages = 0;
  for (let day = cycleIndex * plan.pace; day < Math.min(RAMADAN_DAYS, (cycleIndex + 1) * plan.pace); day++) {
    for (let prayer = 0; prayer < READINGS_PER_DAY; prayer++) {
      if (read.has(day * READINGS_PER_DAY + prayer)) {
        pages += quranPageRange(plan.pace, day, prayer).pages;
      }
    }
  }
  return pages;
}

export function completedKhatms(plan: QuranReadingState): number {
  let count = 0;
  for (let cycle = 0; (cycle + 1) * plan.pace <= RAMADAN_DAYS; cycle++) {
    if (countCyclePages(plan, cycle) === TOTAL_QURAN_PAGES) count++;
  }
  return count;
}

export function completedDaySessions(plan: QuranReadingState, day: number): number {
  const done = new Set(plan.completedSessions);
  return Array.from({ length: READINGS_PER_DAY }, (_, prayer) =>
    Number(done.has(day * READINGS_PER_DAY + prayer))).reduce((a, b) => a + b, 0);
}
