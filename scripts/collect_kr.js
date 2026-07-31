// First45 운용 — 한국 해양 소식 + 해상 특보 수집
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
  { name:'해양정책', url: gn('해양수산부 OR 해양경찰청 (선박 OR 항만 OR 어선 OR 해상 OR 수상레저) when:2d'), quota: 25 },
  { name:'여수·요트', url: gn('(여수 OR 요트 OR 마리나 OR 세일링) (해양 OR 항해 OR 보트) when:2d'), quota: 25 },
];
const GOV_MAX = 8;

async function collectGov(){
  const parser = new Parser({ timeout: 20000, headers: UA });
  const out = [];
  for(const g of GOV_FEEDS){
    try{
      const feed = await parser.parseURL(g.url);
      const rows = (feed.items||[]).map(it=>{
        const d = it.isoDate || it.pubDate;
        const raw = strip(it.title);
        const mm = raw.match(/^(.*) - ([^-]+)$/);
        return { title: mm? mm[1] : raw, press: mm? mm[2] : '', link: it.link||'', source: g.name,
          date: d? new Date(d).toISOString():'' };
      }).filter(x=>x.title && x.date)
        .sort((a,b)=> new Date(b.date)-new Date(a.date))
        .slice(0, g.quota);          // 피드별 할당 — 한쪽이 다 먹는 문제 방지
      out.push(...rows);
      console.log('GOV OK', g.name, (feed.items||[]).length, '→ 할당', rows.length);
    }catch(e){ console.warn('GOV FAIL', g.name, e.message); }
  }
  const seen = new Set();
  return out
    .filter(x=>{ const k=x.title.slice(0,25); if(seen.has(k)) return false; seen.add(k); return true; })
    .sort((a,b)=> new Date(b.date)-new Date(a.date));
}

// AI 선별: 후보 중 선주에게 의미 있는 것만
async function pickGov(items){
  const key = process.env.ANTHROPIC_API_KEY;
  if(!key || !items.length){ console.warn('AI 선별 생략 — 최신순'); return items.slice(0, GOV_MAX); }
  const payload = items.map((x,i)=>({ i, title:x.title, press:x.press }));
  const prompt = `아래는 한국 해양 관련 뉴스 제목 목록이다.
너는 여수에서 45피트 세일링 요트를 직접 운항·정비하는 선주를 위해 뉴스를 고르는 편집자다.

최대 ${GOV_MAX}건을 골라 중요한 순서로 정렬해라.
우선: 해상 안전·사고, 수상레저/선박 규정·제도 변경, 항로·항만 운영, 기상·해상 상황, 여수·남해 지역 소식, 마리나·요트 산업
제외: 수산물 가격·양식·어업 경영, 지역 축제·관광 홍보, 인사·수상(受賞)·행사 개최, 단순 실적 보도, 정치 공방

각 선정 기사에 cat을 붙여라 — 안전, 규정, 항만, 기상, 지역, 산업, 기타 중 하나.
JSON 배열만 출력. 마크다운 금지.
형식: [{"i":3,"cat":"안전"}]

${JSON.stringify(payload)}`;
  try{
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-api-key':key, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:1500,
        messages:[{role:'user', content:prompt}] })
    });
    if(!r.ok) throw new Error('API '+r.status);
    const data = await r.json();
    const text = (data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('');
    const arr = JSON.parse(text.replace(/```json|```/g,'').trim());
    const picked = [];
    arr.slice(0, GOV_MAX).forEach(a=>{
      const src = items[a.i]; if(!src) return;
      picked.push({ ...src, cat: a.cat||'' });
    });
    if(!picked.length) throw new Error('선별 비어있음');
    console.log('AI 선별', items.length, '→', picked.length, '건');
    return picked;
  }catch(e){ console.warn('AI 선별 실패 — 최신순 대체:', e.message); return items.slice(0, GOV_MAX); }
}

// ── 해상 특보
// 우리 해역: 여수·남해서부 일대 (구역명 기준)
const MY_SEA = /(남해서부|남해동부|서해남부|전남|여수|거문도|초도|제주)/;

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

// ── 기상청 API허브 특보현황 조회 (wrn_now_data.php)
// 실제 응답 형식 (2026-07-31 확인):
//   주석행은 '#'로 시작, 데이터행은 콤마 구분, 끝에 '=' 붙음
//   REG_UP, REG_UP_KO, REG_ID, REG_KO, TM_FC, TM_EF, WRN, LVL, CMD, ED_TM
//   WRN/LVL은 영문코드·숫자가 아니라 한글 (예: 폭염 / 중대경보, 풍랑 / 주의)
function parseHub(txt){
  const rows = [];
  for(const raw of txt.split(/\r?\n/)){
    const line = raw.trim();
    if(!line || line.startsWith('#')) continue;
    const c = line.replace(/=\s*$/,'').split(',').map(s=>s.trim());
    if(c.length < 9) continue;
    const REG_ID = c[2], REG_KO = c[3], TM_EF = c[5], WRN = c[6], LVL = c[7], CMD = c[8];
    if(!WRN || !REG_KO) continue;
    if(CMD === '해제') continue;
    // 해상 구역: 구역코드 S로 시작 또는 구역명에 바다/해상/해역 포함 (앞바다·먼바다)
    const marine = /^S/i.test(REG_ID) || /바다|해상|해역/.test(REG_KO);
    const lvl = LVL === '주의' ? '주의보' : (LVL || '특보');
    rows.push({ kind: WRN + lvl, reg: REG_KO, marine, tmEf: TM_EF });
  }
  return rows;
}

function groupWarn(rows){
  const m = new Map();
  rows.forEach(r=>{
    if(!m.has(r.kind)) m.set(r.kind, []);
    const a = m.get(r.kind);
    if(!a.includes(r.reg)) a.push(r.reg);
  });
  return [...m].map(([k,v])=> k + ': ' + v.join(', '));
}

async function collectWxHub(){
  const key = process.env.KMA_HUB_KEY;
  if(!key){ console.log('WX HUB 키 없음 — 건너뜀'); return null; }
  try{
    const url = 'https://apihub.kma.go.kr/api/typ01/url/wrn_now_data.php?fe=f&disp=0&help=1&authKey=' + key;
    const txt = await fetchText(url);
    if(txt.length < 400 && /401|403|Unauthorized|인증|권한/i.test(txt))
      throw new Error('인증/권한 실패 — 활용신청 상태 확인');
    const all = parseHub(txt);
    if(!all.length){
      console.warn('WX HUB 파싱 0건 — 응답 원문 앞부분:');
      console.warn(txt.replace(key,'***').slice(0, 600));
      return null;
    }
    const marine = all.filter(r=>r.marine);
    const mine   = marine.filter(r=>MY_SEA.test(r.reg));
    const others = marine.filter(r=>!MY_SEA.test(r.reg));
    console.log('WX HUB 성공: 전체', all.length, '· 해상', marine.length, '· 우리해역', mine.length);
    if(mine.length)
      return { src:'KMA', active: groupWarn(mine), summary:'' };
    if(marine.length)
      return { src:'KMA', active: [], summary:'우리 해역 특보 없음 · 타 해역 '+marine.length+'건',
               others: groupWarn(others).slice(0,6) };
    return { src:'KMA', active: [], summary:'발효 중인 해상 특보 없음' };
  }catch(e){ console.warn('WX HUB FAIL', e.message); return null; }
}

async function collectWx(){
  const hub = await collectWxHub();
  if(hub) return hub;
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
        return { src:'KMA', active: [], summary:'발효 중인 해상 특보 없음' };
    }catch(e){ console.warn('WX FAIL', url, e.message); }
  }
  // 폴백: 구글뉴스 최근 36시간 특보 보도
  try{
    const parser = new Parser({ timeout: 20000, headers: UA });
    const feed = await parser.parseURL(gn('풍랑주의보 OR 풍랑경보 OR 해상특보 OR "강풍·풍랑"'));
    const cutoff = Date.now() - 36*3600e3;
    const items = (feed.items||[])
      .filter(i=>{ const d=i.isoDate||i.pubDate; return d && new Date(d).getTime() > cutoff; })
      .map(i=>strip(i.title).replace(/ - [^-]+$/,''));
    console.log('WX NEWS 폴백', items.length, '건');
    const mine = items.filter(t=>MY_SEA.test(t));
    if(mine.length) return { src:'NEWS', active: mine.slice(0,3), summary:'※ 언론 보도 기준 — 기상청 실시간 확인 필수' };
    if(items.length) return { src:'NEWS', active: [], summary:'우리 해역 특보 보도 없음 (최근 36시간)' };
    return { src:'NEWS', active: [], summary:'발효 중인 해상 특보 없음' };
  }catch(e){ console.warn('WX NEWS FAIL', e.message); }
  return { src:'NONE', active: [], summary:'자동 확인 불가 — 아래 기상청 링크로 직접 확인' };
}

(async ()=>{
  const govAll = await collectGov();
  const gov = await pickGov(govAll);
  const wx = await collectWx();
  console.log('한국소식', gov.length, '건 / 특보', wx.src, wx.active.length, '건');
  fs.writeFileSync('kr.json', JSON.stringify({ updated:new Date().toISOString(), gov, wx }, null, 1));
  console.log('kr.json 저장 완료');
})().catch(e=>{ console.error(e); process.exit(1); });
