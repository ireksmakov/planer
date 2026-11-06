import { useEffect, useRef, useState } from 'react';

type QuranAyah = {
  text: string;
  numberInSurah: number;
  surah: { number: number; name: string };
};

type QuranPage = {
  page: number;
  edition: 'quran-uthmani';
  ayahs: QuranAyah[];
};

type Props = {
  page: number;
  firstPage: number;
  lastPage: number;
  readCount: number;
  isBookmarked: boolean;
  onClose: () => void;
  onBack: () => void;
  onReadPage: () => void;
  onBookmark: () => void;
};

const arabicNumber = (value: number) =>
  String(value).replace(/[0-9]/g, character => '٠١٢٣٤٥٦٧٨٩'[Number(character)]);

function validPage(value: unknown, expectedPage: number): value is QuranPage {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<QuranPage>;
  return data.page === expectedPage && data.edition === 'quran-uthmani'
    && Array.isArray(data.ayahs) && data.ayahs.length > 0
    && data.ayahs.every(ayah =>
      typeof ayah.text === 'string' && ayah.text.length > 0
      && typeof ayah.numberInSurah === 'number'
      && typeof ayah.surah?.number === 'number'
      && typeof ayah.surah.name === 'string');
}

export function QuranPageReader({
  page, firstPage, lastPage, readCount, isBookmarked,
  onClose, onBack, onReadPage, onBookmark,
}: Props) {
  const [data, setData] = useState<QuranPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const [bookmarkSaved, setBookmarkSaved] = useState(false);
  const cache = useRef(new Map<number, QuranPage>());
  const top = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [page]);

  useEffect(() => {
    setBookmarkSaved(false);
    const cached = cache.current.get(page);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError('');
      return;
    }

    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    setData(null);
    setLoading(true);
    setError('');

    void fetch('/api/quran/page/' + page, {
      signal: controller.signal, cache: 'default',
    })
      .then(async res => {
        if (!res.ok) throw new Error('Не удалось загрузить страницу Корана.');
        const json: unknown = await res.json();
        if (!validPage(json, page)) throw new Error('Получена некорректная страница.');
        if (!active) return;
        cache.current.set(page, json);
        if (cache.current.size > 12) {
          const oldest = cache.current.keys().next().value;
          if (oldest !== undefined) cache.current.delete(oldest);
        }
        setData(json);
      })
      .catch(() => {
        if (active) setError('Страница сейчас недоступна. Проверьте интернет и повторите загрузку.');
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [page, retryKey]);

  const displayed = data?.page === page ? data : null;
  let previousSurah = 0;

  return (
    <div className="quran-inline-reader" ref={top} aria-label={`Чтение Корана, страница ${page}`}>
      <div className="quran-reader-toolbar">
        <span className="quran-reader-heading">📖 Чтение внутри Планера</span>
        <button type="button" className="quran-reader-close" onClick={onClose}>Закрыть ×</button>
      </div>
      <div className="quran-reader-page-title">
        <span>Страница <strong>{page}</strong> из 604</span>
        <span>В этом чтении: {firstPage}–{lastPage}</span>
      </div>

      <div
        className="quran-mushaf-page"
        lang="ar"
        dir="rtl"
        translate="no"
        onTouchStart={event => {
          const touch = event.touches[0];
          if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={event => {
          const start = touchStart.current;
          touchStart.current = null;
          const end = event.changedTouches[0];
          if (!start || !end || !displayed) return;
          const horizontal = end.clientX - start.x;
          const vertical = end.clientY - start.y;
          // Preserve ordinary vertical scrolling. Only deliberate horizontal
          // book-like swipes move to another page.
          if (Math.abs(horizontal) < 70 || Math.abs(horizontal) < Math.abs(vertical) * 1.5) return;
          if (horizontal < 0) onReadPage();
          else if (page > firstPage) onBack();
        }}
      >
        <div className="quran-mushaf-ornament" aria-hidden="true">۞</div>
        {loading && !displayed && (
          <p className="quran-reader-loading" lang="ru" dir="ltr" role="status">Загружаем арабский текст Корана…</p>
        )}
        {error && !displayed && (
          <div className="quran-reader-error" lang="ru" dir="ltr" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => setRetryKey(key => key + 1)}>Повторить</button>
          </div>
        )}
        {displayed && displayed.ayahs.map((ayah, i) => {
          const showSurah = previousSurah !== ayah.surah.number;
          previousSurah = ayah.surah.number;
          return (
            <div className="quran-reader-ayah" key={`${ayah.surah.number}-${ayah.numberInSurah}-${i}`}>
              {showSurah && <h4 className="quran-reader-surah">{ayah.surah.name}</h4>}
              <span className="quran-reader-text">{ayah.text}</span>
              <span className="quran-reader-ayah-number" aria-label={`Аят ${ayah.numberInSurah}`}>﴿{arabicNumber(ayah.numberInSurah)}﴾</span>
            </div>
          );
        })}
      </div>

      <div className="quran-reader-reading-status">
        <span>Прочитано в этой части: <strong>{readCount} из {lastPage - firstPage + 1} стр.</strong></span>
        <span>{isBookmarked ? '🔖 Здесь закладка' : ''}</span>
      </div>
      <div className="quran-reader-actions">
        <button type="button" className="quran-reader-prev" disabled={page <= firstPage} onClick={onBack}>
          ← Назад
        </button>
        <button type="button" className="quran-reader-bookmark" onClick={() => { onBookmark(); setBookmarkSaved(true); }}>
          🔖 {bookmarkSaved || isBookmarked ? 'Закладка сохранена' : 'Поставить закладку'}
        </button>
        <button type="button" className="quran-reader-next" disabled={!displayed} onClick={onReadPage}>
          {page >= lastPage ? '✓ Завершить чтение' : 'Прочитано · Далее →'}
        </button>
      </div>
      <p className="quran-reader-info">
        Для перехода можно нажать «Прочитано · Далее» или пролистать страницу влево.
        Свайп вправо возвращает назад; вертикальная прокрутка не отмечает страницу.
        Прочитанные страницы и закладка сохраняются в вашем аккаунте.
      </p>
      <p className="quran-reader-source">
        Арабский текст без изменений: AlQuran Cloud, редакция quran-uthmani.
        Разбивка по страницам — мединский мусхаф (604 страницы).
      </p>
    </div>
  );
}
