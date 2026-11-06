// Verify every Quran reading pace covers each page 1–604 exactly once per
// completed khatm, even in short 6- or 10-day cycles. Run with Node 22+.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'planner-quran-pages-'));
try {
  const output = join(dir, 'quran-reading.mjs');
  execFileSync('./node_modules/.bin/esbuild', [
    'src/utils/quranReading.ts', '--bundle', '--platform=node',
    '--format=esm', '--outfile=' + output,
  ], { stdio: 'pipe' });

  const mod = await import(pathToFileURL(output).href);
  const { QURAN_PACES, PRAYER_LABELS, quranPageRange, pagesPerReading,
    countCyclePages, completedKhatms, completedDaySessions } = mod;
  assert.deepEqual(QURAN_PACES, [30, 15, 12, 10, 6]);
  assert.equal(PRAYER_LABELS.length, 5);

  for (const pace of QURAN_PACES) {
    const pages = [];
    for (let day = 0; day < pace; day++) {
      for (let prayer = 0; prayer < 5; prayer++) {
        const range = quranPageRange(pace, day, prayer);
        for (let p = range.start; p <= range.end; p++) pages.push(p);
        assert.equal(range.pages, pagesPerReading(pace) +
          ((day === pace - 1 && prayer === 4) ? 4 : 0));
      }
    }
    assert.deepEqual(pages, Array.from({ length: 604 }, (_, i) => i + 1));
    const completeOne = {
      pace, startDate: '2027-02-08',
      completedSessions: Array.from({ length: pace * 5 }, (_, i) => i),
    };
    assert.equal(countCyclePages(completeOne, 0), 604);
    assert.equal(completedKhatms(completeOne), 1);
    assert.equal(completedDaySessions(completeOne, pace - 1), 5);
    assert.equal(completedKhatms({
      ...completeOne, completedSessions: completeOne.completedSessions.slice(0, -1),
    }), 0);
    if (pace < 30) {
      assert.deepEqual(
        quranPageRange(pace, pace, 0),
        quranPageRange(pace, 0, 0),
        'Page number must restart for the next khatm',
      );
    }
  }

  console.log('QURAN PLANNER PAGE AND PROGRESS TESTS PASSED');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
