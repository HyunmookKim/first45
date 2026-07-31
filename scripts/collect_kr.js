// First45 운용 — 한국 해양 소식 + 해상 특보 수집 (매일)
const Parser = require('rss-parser');
const fs = require('fs');
const UA = { 'User-Agent': 'Mozilla/5.0 (First45 news reader)' };
const strip = s => String(s||'').replace(/<[^>]*>/g,' ').replace(/&[a-z#0-9]+;/gi,' ').replace(/\s+/g,' ').trim();

// ── 정부 RSS (korea.kr 정책브리핑 부처별)
const GOV = [
  { name:'해양수산부', url:'https://www.korea.kr/rss/dept_mof.xml' },
  { name:'해양경찰청', url:'https://www.korea.kr/rss/dept_kcg.xml' },   // 존재 확인용 후보 — 실패해도 무시
];
const GOV_DAYS = 14, GOV_MAX = 10;
// 바다 관련 키워드 (해수부는 수산·급식 보도도 많아 필터)
const SEA_KW = /해상|항만|선박|어선|항해|해양안전|요트|마리나|수상레저|해경|구조|익수|특보|태풍|연안|항로|등대|여수|낚시/;

async function collectGov(){
  const parser = new Parser({ timeout: 20000, headers: UA });
  const out = [];
  for(const g of GOV){
    try{
      const feed = await parser.parseURL(g.url);
      (feed.items||[]).forEach(it=>{
        const d = it.isoDate || it.pubDate;
        out.push({ title: strip(it.title), link: it.link||'', source: g.name,
          date: d? new Date(d).toISOString():'' });
      });
      console.log('GOV OK', g.name, (feed.items||[]).length);
    }catch(e){ console.warn('GOV FAIL', g.name, e.message); }
  }
  const cutoff = Date.now() - GOV_DAYS*864e5;
  const seen = new Set();
  return out
    .filter(x=>x.title && x.date && new Date(x.date).getTime()>cutoff)
    .filter(x=>{ const k=x.title; if(seen.has(k)) return false; seen.add(k); return true; })
    .sort((a,b)=> new Date(b.date)-new Date(a.date))
    .filter((x,i)=> SEA_KW.test(x.title) || i<3)   // 바다 키워드 우선, 최신 3건은 무조건
    .slice(0, GOV_MAX);
}

// ── 기상청 해상 특보
// 1차: RSS 안내 페이지에서 '특보' RSS 주소를 자동 추출해 시도
// 2차: 안내 페이지 본문에 노출되는 '특보발효 중' 텍스트 직접 파싱
const KMA_PAGES = [
  'https://www.kma.go.kr/weather/lifenindustry/sevice_rss.jsp',
  'https://devweather.kma.go.kr/weather/lifenindustry/sevice_rss.jsp',
];
const MY_SEA = /(남해서부|서해남부|전남|여수|제주)/;   // 우리 해역

async function fetchText(url){
  const r = await fetch(url, { headers: UA, redirect:'follow' });
  if(!r.ok) throw new Error('HTTP '+r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  let t = buf.toString('utf8');
  if(/charset=euc-kr/i.test(t.slice(0,600)) || t.includes('\uFFFD')){
    try{ t = new TextDecoder('euc-kr').decode(buf); }catch(e){}
  }
  return t;
}

async function collectWx(){
  for(const page of KMA_PAGES){
    try{
      const html = await fetchText(page);
      // 1차: 특보 RSS 링크 추출 시도
      const rssM = html.match(/href="([^"]*(?:warning|특보)[^"]*(?:rss|xml|jsp|do)[^"]*)"/i);
      if(rssM){
        try{
          let u = rssM[1];
          if(u.startsWith('/')) u = new URL(page).origin + u;
          const xml = await fetchText(u);
          const items = [...xml.matchAll(/<title>(?:<!\[CDATA\[)?([^<\]]+)/g)].map(m=>strip(m[1]))
            .filter(t=>/주의보|경보|예비특보/.test(t));
          if(items.length){
            const mine = items.filter(t=>MY_SEA.test(t));
            return { src:'RSS', active: mine.length?mine:items.slice(0,4),
                     summary: mine.length? '' : '우리 해역(남해서부·여수) 특보 없음 · 전국 '+items.length+'건' };
          }
        }catch(e){ console.warn('WX RSS 시도 실패:', e.message); }
      }
      // 2차: 페이지 본문의 특보 통보문 파싱
      const body = strip(html);
      const seg = body.match(/특보발효\s*중.{0,600}/);
      if(seg){
        const txt = seg[0];
        const lines = [...txt.matchAll(/(풍랑|태풍|폭풍해일|안개|강풍)\s*(주의보|경보)\s*:?\s*([^o·<]{2,80})/g)]
          .map(m=>`${m[1]}${m[2]}: ${strip(m[3])}`);
        if(lines.length){
          const mine = lines.filter(t=>MY_SEA.test(t));
          return { src:'PAGE', active: mine.length?mine:lines.slice(0,4),
                   summary: mine.length? '' : '우리 해역 특보 없음 · 타 해역 '+lines.length+'건' };
        }
        return { src:'PAGE', active: [], summary:'현재 발효 중 해상 특보 없음' };
      }
    }catch(e){ console.warn('WX FAIL', page, e.message); }
  }
  return { src:'NONE', active: [], summary:'특보 수집 실패 — 기상청 페이지에서 직접 확인' };
}

(async ()=>{
  const gov = await collectGov();
  const wx = await collectWx();
  console.log('한국소식', gov.length, '건 / 특보', wx.src, wx.active.length, '건');
  fs.writeFileSync('kr.json', JSON.stringify({ updated:new Date().toISOString(), gov, wx }, null, 1));
  console.log('kr.json 저장 완료');
})().catch(e=>{ console.error(e); process.exit(1); });
