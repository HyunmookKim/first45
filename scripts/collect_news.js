// First45 운용 — 해외 요트 뉴스 수집 · AI 선별 · 한글화  (3일 주기)
const Parser = require('rss-parser');
const fs = require('fs');

const FEEDS = [
  { name: 'Yachting World',   url: 'https://www.yachtingworld.com/feed' },
  { name: 'Yachting Monthly', url: 'https://www.yachtingmonthly.com/feed' },
  { name: 'PBO',              url: 'https://www.pbo.co.uk/feed' },
  { name: 'Scuttlebutt',      url: 'https://www.sailingscuttlebutt.com/feed' },
  { name: 'Sail-World',       url: 'https://www.sail-world.com/rss' },
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

// 분류 — 이름만 나열하면 제목 속 단어에 반응해 엉뚱하게 붙는다.
// (예: "마스트 손상"이 보이면 무조건 정비, "라니냐"가 보이면 무조건 기상)
// 그래서 각 항목에 정의와 예시를 붙이고, 겹칠 때 우선순위를 준다.
const CATS = ['사고','안전','정비','장비','항해술','산업','레이스','기타'];
const CAT_GUIDE = `
- 사고 : 실제로 일이 벌어진 것. 침몰·좌초·충돌·조난·구조·인명피해·범고래 공격.
        고장이 원인이어도 사고가 났으면 "사고"다.
        예) 브리타니 해역 요트 좌초 후 헬기 구조 → 사고
        예) 태평양 횡단 중 리깅 파손으로 조난 → 사고
- 안전 : 아직 사고는 안 났지만 위험을 다루는 것. 안전 권고·주의보·리콜·위험 해역 경고.
        예) 특정 해역 범고래 활동 증가 경고 → 안전
- 정비 : 배를 고치고 관리하는 방법. 수리 기법·도장·엔진 정비·부식 관리.
        예) 목재 선실 페인트 코팅 시공 사례 → 정비
- 장비 : 물건 자체. 신제품·장비 비교·리뷰·설치.
        예) 새 오토파일럿 출시, 앵커 성능 비교 → 장비
- 항해술 : 배를 다루는 기술. 세일 트림·선회·정박·항로 계획·악천후 대응 요령.
        예) 지브 종류별 선회(Gybe) 절차 → 항해술  (정비 아님)
- 산업 : 업계와 제도. 설계 동향·시장·조선소·규정 변화·자격 제도·참여 장벽.
        예) 신형 크루징 요트 설계 트렌드 → 산업  (정비 아님)
        예) 원양 참가 요건 강화로 진입장벽 상승 → 산업
- 레이스 : 경기 자체. 대회 결과·채점·선수·레이스 준비.
        예) 골든글로브 레이스 대비 훈련 → 레이스  (기상 아님)
        예) 뉴포트-버뮤다 채점 방식 변경 → 레이스
- 기타 : 위 어디에도 안 맞을 때만. 되도록 쓰지 마라.`;

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

// Yacht Russia — 2026-08 기준 자동 접근이 막혀 있다(robots).
// 정책이 풀리면 저절로 다시 수집되도록 남겨두고, 실패는 한 줄로만 알린다.
async function collectYR(){
  const out = [];
  let yrFail = 0;
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
    }catch(e){ yrFail++; }
  }
  if(yrFail) console.log('YR 건너뜀', yrFail, '개 (접근 차단 — 풀리면 자동 복구)');
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

// 지난 수집에서 내보낸 기사 링크. 다음 회차에는 뒤로 미룬다.
// (아예 빼면 새 기사가 적은 주에 화면이 빈다)
const SEEN_FILE = 'news_seen.json';
const SEEN_KEEP = 200;          // 최근 200건까지 기억
function loadSeen(){
  try{
    const j = JSON.parse(fs.readFileSync(SEEN_FILE,'utf8'));
    return Array.isArray(j.links) ? j.links : [];
  }catch(e){ return []; }
}
function saveSeen(prev, picked){
  const now = picked.map(x=>x.link).filter(Boolean);
  const merged = [...now, ...prev.filter(l=>!now.includes(l))].slice(0, SEEN_KEEP);
  try{ fs.writeFileSync(SEEN_FILE, JSON.stringify({ updated:new Date().toISOString(), links:merged }, null, 1)); }
  catch(e){ console.warn('seen 저장 실패', e.message); }
}

function dedupe(items){
  const seen = new Set();
  return items.filter(x=>{
    const k = (x.link||x.title).toLowerCase();
    if(!x.title || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// AI가 목록에 없는 이름을 지어내는 것을 막는다
function normCat(v){
  const s = String(v||'').trim();
  if(CATS.includes(s)) return s;
  const alias = { '규정':'산업', '제도':'산업', '기상':'안전', '날씨':'안전',
                  '러시아':'기타', '지역':'기타', '기술':'항해술', '수리':'정비',
                  '구조':'사고', '조난':'사고', '리뷰':'장비', '제품':'장비' };
  if(alias[s]) return alias[s];
  const hit = CATS.find(c => s.includes(c));
  return hit || '기타';
}

async function selectAndTranslate(items, seen){
  const key = process.env.ANTHROPIC_API_KEY;
  const fallback = () => items.slice(0, PICK).map(x=>({ ...x, t_ko:x.title, s_ko:'', cat:'' }));
  // items 는 이미 '새 기사 먼저' 순서로 들어온다 — 폴백도 자연히 새 기사 우선이 된다.
  if(!key){ console.warn('API 키 없음 — 선별·번역 생략'); return fallback(); }
  if(!items.length) return [];
  const seenSet = new Set(seen||[]);
  const payload = items.map((x,i)=>({ i, source:x.source, title:x.title,
    desc:(x.desc||'').slice(0,900), old: seenSet.has(x.link) ? 1 : 0 }));
  const prompt = `아래는 최근 요트·세일링 뉴스 후보 목록이다(영어·러시아어 혼재).
너는 45피트 세일링 요트를 직접 소유·정비하며 운항하는 한국인 선주를 위해 뉴스를 고르는 편집자다.

작업:
1) 최대 ${PICK}건을 골라 중요한 순서로 정렬해라.
   우선: 안전·사고, 규정·제도 변경, 정비·기술·장비, 기상·항로, 발트해·러시아·상트페테르부르크 관련, 한국 관련, 업계 동향
   후순위(웬만하면 제외): 레이스 결과 자체, 신형 요트 홍보성 리뷰, 럭셔리 슈퍼요트, 유명인 가십

   ★ old:1 은 지난번에 이미 보여준 기사다. 독자는 같은 기사를 또 보고 싶어하지 않는다.
     old:0 (새 기사)을 먼저 채워라. 새 기사만으로 ${PICK}건이 안 되면 그때만 old:1 을 보태라.
     새 기사가 ${PICK}건 이상이면 old:1 은 하나도 넣지 마라.

2) 각 선정 기사에:
   t_ko: 자연스러운 한국어 제목 (요트 용어는 통용 표기)
   s_ko: 한국어 3줄 요약(\\n 구분). 제목을 바꿔 말하지 말고, 본문에만 있는 구체적 정보를 담아라 —
        무엇이 언제 어디서 일어났는지, 원인/수치/조치, 선주가 취할 행동이나 시사점.
        "~에 대해 다룬다", "~을 설명한다" 같은 메타 서술 금지. 사실을 그대로 써라.
        본문 정보가 부족하면 아는 것만 1~2줄로 쓰고 지어내지 마라.
   cat: 아래 8개 중 하나. 반드시 이 목록의 단어를 그대로 써라. 새로 만들지 마라.
${CAT_GUIDE}

   분류 규칙:
   · 기사 전체가 무엇에 관한 것인지로 판단해라. 제목에 특정 단어가 들어있다는 이유로 고르지 마라.
     "마스트 손상"이 있다고 무조건 정비가 아니고, "라니냐"가 있다고 무조건 날씨 얘기가 아니다.
   · 둘 이상 걸치면 이 순서로 정해라: 사고 > 안전 > 레이스 > 항해술 > 정비 > 장비 > 산업 > 기타
   · 고장·파손이 나왔을 때: 그래서 조난·구조로 이어졌으면 사고, 고치는 방법이 본론이면 정비다.

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
    const raw = {};
    arr.slice(0, PICK).forEach(a=>{
      const src = items[a.i]; if(!src) return;
      const cat = normCat(a.cat);
      if(a.cat && cat !== String(a.cat).trim()) raw[a.cat] = (raw[a.cat]||0)+1;
      picked.push({ ...src, t_ko:a.t_ko||src.title, s_ko:a.s_ko||'', cat });
    });
    if(!picked.length) throw new Error('선별 결과 비어있음');
    // 분류 분포를 로그로 남긴다 — 한쪽으로 쏠리면 안내문을 손봐야 한다
    const dist = {};
    picked.forEach(p=> dist[p.cat] = (dist[p.cat]||0)+1);
    console.log('분류 분포:', JSON.stringify(dist, null, 0));
    if(Object.keys(raw).length) console.log('목록 밖 분류 교정:', JSON.stringify(raw));
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
  // 이미 보여준 기사는 뒤로 미뤄 새 기사가 먼저 후보에 들어가게 한다
  const seen = loadSeen();
  const fresh = all.filter(x=> !seen.includes(x.link));
  const olds  = all.filter(x=>  seen.includes(x.link));
  console.log('새 기사', fresh.length, '건 · 이미 본 것', olds.length, '건');
  const shortlist = [...fresh, ...olds].slice(0, 45);
  await enrich(shortlist);
  const picked = await selectAndTranslate(shortlist, seen);
  const news = { updated: new Date().toISOString(), candidates: all.length,
    items: picked.map(x=>({ title:x.title, t_ko:x.t_ko, s_ko:x.s_ko, cat:x.cat, link:x.link, source:x.source, date:x.date })) };
  fs.writeFileSync('news.json', JSON.stringify(news, null, 1));
  saveSeen(seen, picked);
  const newCnt = picked.filter(x=> !seen.includes(x.link)).length;
  console.log('news.json 저장:', picked.length, '건 선별 (새 기사', newCnt, '건)');
})().catch(e=>{ console.error(e); process.exit(1); });
