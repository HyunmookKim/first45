// First45 운용 — 물때(만조·간조) 자동 수집
// 출처: 바다타임(badatime.com) · 원자료 국립해양조사원
// 전국 지점을 순회하며 14일치 조석을 tide.json 으로 저장.
// 지점 좌표는 별도 파일(tide-spots.json)에 누적 저장 — 최초 1회 지도 API 없이 페이지에서 추출.
const fs = require('fs');

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9'
};
const BASE = 'https://www.badatime.com/';
const GAP_MS = 350;          // 서버 부담 줄이려 요청 간격
const CONCURRENCY = 3;       // 동시 요청 수 (낮게 유지)
const OUT = 'tide.json';
const SPOTS = 'tide-spots.json';

const sleep = ms => new Promise(r=>setTimeout(r, ms));
const strip = s => String(s||'')
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]*>/g,' ')
  .replace(/&nbsp;/gi,' ').replace(/&[a-z#0-9]+;/gi,' ')
  .replace(/\s+/g,' ').trim();

async function fetchPage(url){
  const r = await fetch(url, { headers: UA, redirect:'follow', signal: AbortSignal.timeout(20000) });
  if(!r.ok) throw new Error('HTTP '+r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  let t = buf.toString('utf8');
  if(t.includes('\uFFFD')){ try{ t = new TextDecoder('euc-kr').decode(buf); }catch(e){} }
  return t;
}

// ── 지점 목록: 통합검색 페이지들에서 /숫자.html 링크와 이름을 수집
const HUBS = ['41-2.html','120.html','195.html','67.html'];   // 남해/서해/동해/제주 통합검색
async function collectSpotList(){
  const map = new Map();
  for(const h of HUBS){
    try{
      const html = await fetchPage(BASE+h);
      const re = /href="(?:https?:\/\/www\.badatime\.com)?\/?(\d{1,5})\.html"[^>]*>\s*([^<>{}]{1,20}?)\s*</g;
      let m;
      while((m = re.exec(html))){
        const id = m[1], name = strip(m[2]);
        if(!name || /^\d+$/.test(name) || name.length < 2) continue;
        if(!map.has(id)) map.set(id, name);
      }
      console.log('HUB', h, '누적 지점', map.size);
      await sleep(GAP_MS);
    }catch(e){ console.warn('HUB FAIL', h, e.message); }
  }
  return map;
}

// ── 조석 파싱 (실데이터 검증 완료)
function parseTide(txt, fallbackYear){
  const out = [];
  const tok = /(\d{4})年\s*(\d{1,2})月|([일월화수목금토])\s+(\d{1,2})\s+(\d{1,2}\.\d{1,2})/g;
  let m, curY = fallbackYear, curM = null;
  const marks = [];
  while((m = tok.exec(txt))){
    if(m[1]){ curY = +m[1]; curM = +m[2]; }
    else marks.push({ day:+m[4], y:curY, mo:curM, start:m.index });
  }
  marks.forEach((mk,i)=>{
    if(!mk.mo) return;
    const seg = txt.slice(mk.start, i+1<marks.length ? marks[i+1].start : txt.length);
    const highs=[], lows=[];
    const re = /(\d{1,2}):(\d{2})\s*\(\s*(-?\d{1,4})\s*\)\s*([▲▼])/g;
    let t;
    while((t = re.exec(seg))){
      const rec = { t: t[1].padStart(2,'0')+':'+t[2], v: +t[3] };
      (t[4]==='▲' ? highs : lows).push(rec);
    }
    if(!highs.length && !lows.length) return;
    const sun = seg.match(/(\d{2}:\d{2})\/(\d{2}:\d{2})/);
    out.push({
      d: mk.y+'-'+String(mk.mo).padStart(2,'0')+'-'+String(mk.day).padStart(2,'0'),
      h: highs, l: lows,
      sr: sun? sun[1]:'', ss: sun? sun[2]:''
    });
  });
  return out;
}

// 좌표: "동경127:46 북위34:45" 형식
function parseLatLon(txt){
  const m = txt.match(/동경\s*(\d{1,3})\s*[:：]\s*(\d{1,2}).{0,12}?북위\s*(\d{1,2})\s*[:：]\s*(\d{1,2})/);
  if(!m) return null;
  return { lon: +m[1] + (+m[2])/60, lat: +m[3] + (+m[4])/60 };
}

async function collectSpot(id, name, year){
  const txt = strip(await fetchPage(BASE + id + '-2.html'));
  const days = parseTide(txt, year);
  const pos = parseLatLon(txt);
  if(!days.length || !pos) return null;
  return { id, name, lat: +pos.lat.toFixed(4), lon: +pos.lon.toFixed(4), days: days.slice(0, 15) };
}

(async ()=>{
  const year = new Date().getFullYear();
  const list = await collectSpotList();
  const ids = [...list.entries()];
  console.log('대상 지점', ids.length, '개');

  const spots = [];
  let idx = 0, ok = 0, fail = 0;
  async function worker(){
    while(idx < ids.length){
      const [id, name] = ids[idx++];
      try{
        const s = await collectSpot(id, name, year);
        if(s){ spots.push(s); ok++; }
        else fail++;
      }catch(e){ fail++; }
      await sleep(GAP_MS);
    }
  }
  await Promise.all(Array.from({length:CONCURRENCY}, worker));

  spots.sort((a,b)=> a.id.localeCompare(b.id, undefined, {numeric:true}));
  const data = {
    updated: new Date().toISOString(),
    source: '바다타임(badatime.com) · 원자료 국립해양조사원',
    count: spots.length,
    spots
  };
  fs.writeFileSync(OUT, JSON.stringify(data));
  fs.writeFileSync(SPOTS, JSON.stringify(spots.map(s=>({id:s.id,name:s.name,lat:s.lat,lon:s.lon}))));
  const kb = (fs.statSync(OUT).size/1024).toFixed(0);
  console.log(`완료: 성공 ${ok} / 실패 ${fail} · tide.json ${kb}KB`);
  if(!spots.length){ console.error('수집 0건 — 실패'); process.exit(1); }
})().catch(e=>{ console.error(e); process.exit(1); });
