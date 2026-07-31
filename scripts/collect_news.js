// First45 운용 — 해외 요트 뉴스 수집 · AI 선별 · 한글화  (3일 주기)
const Parser = require('rss-parser');
const fs = require('fs');

const FEEDS = [
  { name: 'Yachting World',   url: 'https://www.yachtingworld.com/feed' },
  { name: 'Yachting Monthly', url: 'https://www.yachtingmonthly.com/feed' },
  { name: 'PBO',              url: 'https://www.pbo.co.uk/feed' },
  { name: 'Scuttlebutt',      url: 'https://www.sailingscuttlebutt.com/feed' },
  { name: 'Sail-World',       url: 'https://www.sail-world.com/rss/index' },
];
// Yacht Russia: RSS 없음 → 정적 목록 파싱 (장비 / 선장 조언 / 주요 소식)
const YR_PAGES = [
  'https://yachtrussia.com/news/group/4',
  'https://yachtrussia.com/news/group/17',
  'https://yachtrussia.com/news/group/13',
];
const MAX_AGE_DAYS = 10;
const PICK = 15;
const UA = { 'User-Agent': 'Mozilla/5.0 (First45 news reader)' };

const strip = s => String(s||'').replace(/<[^>]*>/g,' ').replace(/&[a-z#0-9]+;/gi,' ').replace(/\s+/g,' ').trim();

async function collectEN(){
  const parser = new Parser({ timeout: 20000, headers: UA });
  const out = [];
  for(const f of FEEDS){
    try{
      const feed = await parser.parseURL(f.url);
      (feed.items||[]).forEach(it=>{
        const d = it.isoDate || it.pubDate;
        out.push({ title: strip(it.title), link: it.link||'', source: f.name,
          date: d? new Date(d).toISOString() : '',
          desc: strip(it.contentSnippet || it.content || it.summary).slice(0,450) });
      });
      console.log('EN OK', f.name, (feed.items||[]).length);
    }catch(e){ console.warn('EN FAIL', f.name, e.message); }
  }
  return out;
}

async function collectYR(){
  const out = [];
  for(const page of YR_PAGES){
    try{
      const r = await fetch(page, { headers: UA });
      if(!r.ok) throw new Error('HTTP '+r.status);
      const html = await r.text();
      // 기사 링크: /news/YYYY/MM/DD/....html  (날짜가 URL에 내장 → 날짜 파싱 견고)
      const re = /href="(\/news\/(\d{4})\/(\d{2})\/(\d{2})\/[^"]+\.html)"[^>]*>([^<]{10,200})</g;
      let m;
      while((m = re.exec(html))){
        const path=m[1], y=m[2], mo=m[3], d=m[4], txt=m[5];
        out.push({ title: strip(txt), link: 'https://yachtrussia.com'+path,
          source: 'Yacht Russia', date: `${y}-${mo}-${d}T00:00:00.000Z`, desc: '' });
      }
      console.log('YR OK', page.slice(-2), out.length);
    }catch(e){ console.warn('YR FAIL', page, e.message); }
  }
  return out;
}

// 기사 본문 일부를 실제로 받아와 요약 재료로 사용 (RSS 요약이 부실한 문제 해결)
async function enrich(items){
  const LIMIT = 8;   // 동시 요청 수
  let idx = 0;
  async function worker(){
    while(idx < items.length){
      const it = items[idx++];
      if((it.desc||'').length > 400) continue;   // 이미 충분하면 skip
      try{
        const r = await fetch(it.link, { headers: UA, redirect:'follow', signal: AbortSignal.timeout(12000) });
        if(!r.ok) continue;
        let html = await r.text();
        html = html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ');
        // 본문 후보: <p> 태그들 중 긴 것 우선
        const ps = [...html.matchAll(/<p[^>]*>([\s\S]{40,}?)<\/p>/gi)]
          .map(m=>strip(m[1])).filter(t=>t.length>60 && !/cookie|subscribe|newsletter|copyright/i.test(t));
        const body = ps.slice(0,6).join(' ');
        if(body.length > (it.desc||'').length) it.desc = body.slice(0,1400);
      }catch(e){ /* 개별 실패 무시 */ }
    }
  }
  await Promise.all(Array.from({length:LIMIT}, worker));
  const got = items.filter(x=>(x.desc||'').length>400).length;
  console.log('본문 확보', got, '/', items.length);
  return items;
}

function dedupe(items){
  const seen = new Set();
  return items.filter(x=>{
    const k = (x.link||x.title).toLowerCase();
    if(!x.title || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

async function selectAndTranslate(items){
  const key = process.env.ANTHROPIC_API_KEY;
  const fallback = () => items.slice(0, PICK).map(x=>({ ...x, t_ko:x.title, s_ko:'', cat:'' }));
  if(!key){ console.warn('API 키 없음 — 선별·번역 생략'); return fallback(); }
  if(!items.length) return [];
  const payload = items.map((x,i)=>({ i, source:x.source, title:x.title, desc:(x.desc||'').slice(0,900) }));
  const prompt = `아래는 최근 요트·세일링 뉴스 후보 목록이다(영어·러시아어 혼재).
너는 45피트 세일링 요트를 직접 소유·정비하며 운항하는 한국인 선주를 위해 뉴스를 고르는 편집자다.

작업:
1) 최대 ${PICK}건을 골라 중요한 순서로 정렬해라.
   우선: 안전·사고, 규정·제도 변경, 정비·기술·장비, 기상·항로, 발트해·러시아·상트페테르부르크 관련, 한국 관련, 업계 동향
   후순위(웬만하면 제외): 레이스 결과 자체, 신형 요트 홍보성 리뷰, 럭셔리 슈퍼요트, 유명인 가십
2) 각 선정 기사에:
   t_ko: 자연스러운 한국어 제목 (요트 용어는 통용 표기)
   s_ko: 한국어 3줄 요약(\\n 구분). 제목을 바꿔 말하지 말고, 본문에만 있는 구체적 정보를 담아라 —
        무엇이 언제 어디서 일어났는지, 원인/수치/조치, 선주가 취할 행동이나 시사점.
        "~에 대해 다룬다", "~을 설명한다" 같은 메타 서술 금지. 사실을 그대로 써라.
        본문 정보가 부족하면 아는 것만 1~2줄로 쓰고 지어내지 마라.
   cat: 다음 중 하나 — 안전, 정비, 규정, 기상, 러시아, 산업, 레이스, 기타
JSON 배열만 출력. 마크다운 금지.
형식: [{"i":3,"t_ko":"...","s_ko":"...\\n...\\n...","cat":"정비"}]

${JSON.stringify(payload)}`;
  try{
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-api-key':key, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:6000,
        messages:[{role:'user', content:prompt}] })
    });
    if(!r.ok) throw new Error('API '+r.status+' '+(await r.text()).slice(0,180));
    const data = await r.json();
    const text = (data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('');
    const arr = JSON.parse(text.replace(/```json|```/g,'').trim());
    const picked = [];
    arr.slice(0, PICK).forEach(a=>{
      const src = items[a.i]; if(!src) return;
      picked.push({ ...src, t_ko:a.t_ko||src.title, s_ko:a.s_ko||'', cat:a.cat||'' });
    });
    if(!picked.length) throw new Error('선별 결과 비어있음');
    return picked;
  }catch(e){ console.warn('AI 선별 실패 — 최신순 대체:', e.message); return fallback(); }
}

(async ()=>{
  const cutoff = Date.now() - MAX_AGE_DAYS*864e5;
  const all = dedupe([ ...(await collectEN()), ...(await collectYR()) ])
    .filter(x => x.date && new Date(x.date).getTime() > cutoff)
    .sort((a,b)=> new Date(b.date) - new Date(a.date));
  console.log('후보', all.length, '건 (최근 '+MAX_AGE_DAYS+'일)');
  // 1차: 제목만으로 후보 압축 → 2차: 본문 확보 → 3차: 선별·요약
  const shortlist = all.slice(0, 45);
  await enrich(shortlist);
  const picked = await selectAndTranslate(shortlist);
  const news = { updated: new Date().toISOString(), candidates: all.length,
    items: picked.map(x=>({ title:x.title, t_ko:x.t_ko, s_ko:x.s_ko, cat:x.cat, link:x.link, source:x.source, date:x.date })) };
  fs.writeFileSync('news.json', JSON.stringify(news, null, 1));
  console.log('news.json 저장:', picked.length, '건 선별');
})().catch(e=>{ console.error(e); process.exit(1); });
