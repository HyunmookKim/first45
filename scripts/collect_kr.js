// First45 운용 — 한국 해양 소식 + 해상 특보 수집 (3시간마다)
const Parser = require('rss-parser');
const fs = require('fs');
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9'
};
const strip = s => String(s||'').replace(/<[^>]*>/g,' ').replace(/&[a-z#0-9]+;/gi,' ').replace(/\s+/g,' ').trim();
const gn = q => 'https://news.google.com/rss/search?q='+encodeURIComponent(q)+'&hl=ko&gl=KR&ceid=KR:ko';

// ── 한국 해양 소식: 구글뉴스 RSS (무인증 공개 피드)
const GOV_FEEDS = [
  { name:'해양정책', url: gn('해양수산부 OR 해양경찰청 (선박 OR 항만 OR 어선 OR 해상 OR 수상레저) when:7d') },
  { name:'여수·요트', url: gn('(여수 OR 요트 OR 마리나 OR 세일링) (해양 OR 항해 OR 보트) when:7d') },
];
const GOV_MAX = 10;

async function collectGov(){
  const parser = new Parser({ timeout: 20000, headers: UA });
  const out = [];
  for(const g of GOV_FEEDS){
    try{
      const feed = await parser.parseURL(g.url);
      (feed.items||[]).forEach(it=>{
        const d = it.isoDate || it.pubDate;
        out.push({ title: strip(it.title).replace(/ - [^-]+$/,''), link: it.link||'', source: g.name,
          date: d? new Date(d).toISOString():'' });
      });
      console.log('GOV OK', g.name, (feed.items||[]).length);
    }catch(e){ console.warn('GOV FAIL', g.name, e.message); }
  }
  const seen = new Set();
  return out
    .filter(x=>x.title && x.date)
    .filter(x=>{ const k=x.title.slice(0,30); if(seen.has(k)) return false; seen.add(k); return true; })
    .sort((a,b)=> new Date(b.date)-new Date(a.date))
    .slice(0, GOV_MAX);
}

// ── 해상 특보: 기상청 후보 2곳 → 실패 시 구글뉴스 속보 폴백
const MY_SEA = /(남해서부|서해남부|전남|여수|제주)/;

async function fetchText(url){
  const r = await fetch(url, { headers: UA, redirect:'follow' });
  if(!r.ok) throw new Error('HTTP '+r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  let t = buf.toString('utf8');
  if(/charset=euc-kr/i.test(t.slice(0,800))){
    try{ t = new TextDecoder('euc-kr').decode(buf); }catch(e){}
  }
  return t;
}

function parseWarnText(body){
  const lines = [...body.matchAll(/(풍랑|태풍|폭풍해일|안개|강풍)\s*(주의보|경보)\s*[:：]?\s*([^o·<>{}\n]{2,90})/g)]
    .map(m=>`${m[1]}${m[2]}: ${strip(m[3])}`);
  return [...new Set(lines)];
}

async function collectWx(){
  const KMA = [
    'https://www.weather.go.kr/w/special-report/overall.do',
    'https://www.kma.go.kr/weather/warning/status.jsp',
  ];
  for(const url of KMA){
    try{
      const body = strip(await fetchText(url));
      const lines = parseWarnText(body);
      console.log('WX TRY', url.slice(8,40), '추출', lines.length, '건');
      if(lines.length){
        const mine = lines.filter(t=>MY_SEA.test(t));
        return { src:'KMA', active: mine.length?mine:lines.slice(0,4),
                 summary: mine.length? '' : '우리 해역 특보 없음 · 타 해역 '+lines.length+'건' };
      }
      if(/특보.{0,80}(없|해제)/.test(body))
        return { src:'KMA', active: [], summary:'현재 발효 중인 해상 특보 없음' };
    }catch(e){ console.warn('WX FAIL', url, e.message); }
  }
  // 폴백: 구글뉴스 최근 24시간 특보 보도
  try{
    const parser = new Parser({ timeout: 20000, headers: UA });
    const feed = await parser.parseURL(gn('(풍랑주의보 OR 풍랑경보 OR 해상특보) when:1d'));
    const items = (feed.items||[]).map(i=>strip(i.title).replace(/ - [^-]+$/,''));
    console.log('WX NEWS 폴백', items.length, '건');
    const mine = items.filter(t=>MY_SEA.test(t));
    if(mine.length) return { src:'NEWS', active: mine.slice(0,3), summary:'※ 언론 보도 기준 — 기상청 실시간 확인 필수' };
    if(items.length) return { src:'NEWS', active: [], summary:'우리 해역 특보 보도 없음 (최근 24h)' };
  }catch(e){ console.warn('WX NEWS FAIL', e.message); }
  return { src:'NONE', active: [], summary:'특보 수집 실패 — 기상청에서 직접 확인' };
}

(async ()=>{
  const gov = await collectGov();
  const wx = await collectWx();
  console.log('한국소식', gov.length, '건 / 특보', wx.src, wx.active.length, '건');
  fs.writeFileSync('kr.json', JSON.stringify({ updated:new Date().toISOString(), gov, wx }, null, 1));
  console.log('kr.json 저장 완료');
})().catch(e=>{ console.error(e); process.exit(1); });
