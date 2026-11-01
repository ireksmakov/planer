import { useState } from 'react';

const duas = [
  { title: 'Благо в обоих мирах', arabic: 'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ', meaning: 'Господь наш! Даруй нам благо в этом мире и в Последней жизни и защити нас от мучений Огня.', source: 'Коран 2:201', url: 'https://quran.com/2/201' },
  { title: 'Просьба о знании', arabic: 'رَبِّ زِدْنِي عِلْمًا', meaning: 'Господи, прибавь мне знания.', source: 'Коран 20:114', url: 'https://quran.com/20/114' },
  { title: 'Милость к родителям', arabic: 'رَبِّ ارْحَمْهُمَا كَمَا رَبَّيَانِي صَغِيرًا', meaning: 'Господи! Помилуй их, ведь они растили меня ребёнком.', source: 'Коран 17:24', url: 'https://quran.com/17/24' },
  { title: 'Стойкость сердца', arabic: 'رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا', meaning: 'Господь наш! Не отклоняй наши сердца после того, как Ты наставил нас на прямой путь.', source: 'Коран 3:8, начало аята', url: 'https://quran.com/3/8' }
];
const books = [
  {title:'Священный Коран',detail:'Чтение по сурам, перевод и аудио',url:'https://quran.com/'},
  {title:'Крепость мусульманина',detail:'Сборник дуа и зикра',url:'https://sunnah.com/hisn'},
  {title:'Сады праведных',detail:'Рияд ас-Салихин — сборник хадисов',url:'https://sunnah.com/riyadussalihin'},
  {title:'40 хадисов ан-Навави',detail:'Основы поклонения и нравственности',url:'https://sunnah.com/nawawi40'}
];
export function RamadanLibrary() {
  const [filter,setFilter] = useState<'all'|'dua'|'books'>('all');
  return <section className="ramadan-library">
    <div className="ramadan-library-intro"><span className="eyebrow">ЗНАНИЯ И ВДОХНОВЕНИЕ</span><h2>Библиотека Рамадана</h2><p>Подборка дуа из Корана и книг для чтения. Каждый материал сопровождается ссылкой на источник.</p></div>
    <div className="ramadan-library-filters">
      {([['all','Все материалы'],['dua','Дуа'],['books','Книги']] as const).map(([key,label])=><button key={key} type="button" onClick={()=>setFilter(key)} className={filter===key?'active':''}>{label}</button>)}
    </div>
    {(filter==='all'||filter==='dua') && <><h3 className="ramadan-library-title">Дуа из Корана</h3><div className="ramadan-resources">{duas.map(d=><article className="ramadan-resource" key={d.source}><span className="eyebrow">{d.source}</span><h4>{d.title}</h4><p className="ramadan-dua-arabic" lang="ar" dir="rtl">{d.arabic}</p><p>{d.meaning}</p><a href={d.url} target="_blank" rel="noopener noreferrer">Открыть аят и перевод ↗</a></article>)}</div></>}
    {(filter==='all'||filter==='books') && <><h3 className="ramadan-library-title">Книги и чтение</h3><div className="ramadan-resources">{books.map(b=><article className="ramadan-resource" key={b.title}><span className="eyebrow">ЧТЕНИЕ</span><h4>{b.title}</h4><p>{b.detail}</p><a href={b.url} target="_blank" rel="noopener noreferrer">Перейти к источнику ↗</a></article>)}</div><p className="ramadan-library-note">Материалы открываются на внешних сайтах. Доступность русского перевода зависит от источника.</p></>}
  </section>;
}
