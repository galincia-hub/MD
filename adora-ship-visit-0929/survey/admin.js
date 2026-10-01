const root=document.getElementById("root"), cfg=window.SURVEY_CONFIG;
let AUTH="", DATA=null, MODE="dashboard";
const esc=(s="")=>String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));

async function sha256(s){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function jsonp(params={}){
 return new Promise((resolve,reject)=>{
  const cb="adm_"+Date.now()+"_"+Math.random().toString(36).slice(2), s=document.createElement("script");
  const t=setTimeout(()=>{cl();reject(new Error("timeout"));},10000);
  const cl=()=>{clearTimeout(t);delete window[cb];s.remove()};
  window[cb]=(d)=>{cl();resolve(d)};
  const u=new URL(cfg.APPS_SCRIPT_URL); Object.entries({...params,callback:cb}).forEach(([k,v])=>u.searchParams.set(k,v));
  s.src=u; s.onerror=()=>{cl();reject(new Error("load"))}; document.body.appendChild(s);
 });
}
function loginView(){
 root.innerHTML=`<div class="login"><div class="eyebrow">ADMIN</div><h2>방선투어 피드백</h2><p class="lead">관리자 비밀번호를 입력해주세요.</p><input id="pw" type="password" autocomplete="current-password" placeholder="비밀번호"><button class="primary" onclick="login()">접속</button><div id="loginErr" class="error"></div></div>`;
}
async function login(){
 const pw=document.getElementById("pw").value; AUTH=await sha256(pw);
 try{const d=await jsonp({action:"dashboard",auth:AUTH}); if(!d.ok) throw 0; DATA=d; render();}catch(e){document.getElementById("loginErr").textContent="비밀번호 또는 연결 설정을 확인해주세요."}
}
function render(){
 const d=DATA;
 root.innerHTML=`<main class="admin-shell">
 <div class="no-print"><div class="eyebrow">ADORA MEDITERRANEA · SHIP VISIT</div><h1>Feedback Dashboard</h1>
 <div class="tabs"><button class="${MODE==="dashboard"?"on":""}" onclick="MODE='dashboard';render()">대시보드</button><button class="${MODE==="internal"?"on":""}" onclick="MODE='internal';render()">내부 1페이지</button><button class="${MODE==="adora"?"on":""}" onclick="loadAdora()">ADORA English</button><button onclick="location.reload()">잠금</button></div></div>
 ${MODE==="dashboard"?dashboard(d):MODE==="internal"?internalReport(d):adoraReport(d.adora)}
 </main>`;
}
function dashboard(d){
 return `<div class="grid">
 ${kpi("전체 응답",`${d.responseCount} / ${d.total}`,`${d.responseRate}%`)}
 ${kpi("미응답",d.nonresponders.length,"코드 기준")}
 ${kpi("중복 제출",d.duplicates,"최신 응답으로 집계")}
 ${kpi("설문 유형",d.surveyType,"현재 운영")}
 </div>
 <section class="panel"><h2>영역별 비교점수</h2><p class="small">20점 만점 · COSTA SERENA = 10점 기준</p>${bars(d.areaAverages)}</section>
 <section class="panel"><h2>조별 응답률</h2>${rateTable(d.groupRates)}</section>
 <section class="panel"><h2>참여 구분별 응답률</h2>${rateTable(d.affiliationRates)}</section>
 <section class="panel"><h2>참여 구분별 영역 점수</h2>${scoreTable(d.affiliationScores)}</section>
 <section class="panel"><h2>미응답자</h2>${nonTable(d.nonresponders)}</section>
 <section class="panel"><h2>주관식 응답</h2>${comments(d.comments)}</section>`;
}
const kpi=(t,v,s)=>`<div class="kpi"><span>${esc(t)}</span><b>${esc(v)}</b><span>${esc(s)}</span></div>`;
function bars(obj){return Object.entries(obj||{}).map(([k,v])=>`<div class="barrow"><span>${esc(k)}</span><div class="bar"><i style="width:${Math.max(0,Math.min(100,(Number(v)||0)/20*100))}%"></i></div><b>${v??"-"} / 20</b></div>`).join("")||"<p>점수형 응답이 없습니다.</p>"}
function rateTable(rows){return `<table><thead><tr><th>구분</th><th>응답</th><th>대상</th><th>응답률</th></tr></thead><tbody>${(rows||[]).map(r=>`<tr><td>${esc(r.label)}</td><td>${r.responded}</td><td>${r.total}</td><td>${r.rate}%</td></tr>`).join("")}</tbody></table>`}
function nonTable(rows){return `<table><thead><tr><th>코드</th><th>회사</th><th>이름</th><th>조</th></tr></thead><tbody>${(rows||[]).map(r=>`<tr><td>${esc(r.ref)}</td><td>${esc(r.company)}</td><td>${esc(r.name)}</td><td>${esc(r.group)}</td></tr>`).join("")}</tbody></table>`}
function scoreTable(obj){const cats=Object.keys(obj||{}); const areas=[...new Set(cats.flatMap(c=>Object.keys(obj[c]||{})))]; return `<table><thead><tr><th>구분</th>${areas.map(a=>`<th>${esc(a)}</th>`).join("")}</tr></thead><tbody>${cats.map(c=>`<tr><td>${esc(c)}</td>${areas.map(a=>`<td>${obj[c][a]??"-"}</td>`).join("")}</tr>`).join("")}</tbody></table>`}
function comments(obj){return Object.entries(obj||{}).map(([a,arr])=>`<h3>${esc(a)}</h3>${arr.length?arr.map(x=>`<div class="comment"><b>${esc(x.ref)} · ${esc(x.company)}</b><br>${esc(x.text)}</div>`).join(""):"<p class='small'>응답 없음</p>"}`).join("")}
function internalReport(d){
 return `<section class="panel"><div class="eyebrow">INTERNAL SUMMARY · 2026.09.29</div><h1>아도라 메디테라니아 방선투어 피드백</h1>
 <p class="lead">응답 ${d.responseCount}/${d.total}명 (${d.responseRate}%) · 마감 2026.10.06</p>
 <p class="small">20점 만점 · COSTA SERENA = 10점 기준</p>
 <h2>영역별 비교평가</h2>${bars(d.areaAverages)}
 <h2>회사별 주요 차이</h2>${scoreTable(d.companyScores)}
 <h2>전문가 의견</h2>${comments(d.comments)}
 <p class="small">개인 식별 정보가 포함될 수 있는 내부 공유용입니다.</p>
 <div class="actions no-print"><button class="primary" onclick="window.print()">인쇄 / PDF 저장</button></div></section>`;
}
async function loadAdora(){
 try{const d=await jsonp({action:"adoraReport",auth:AUTH}); if(!d.ok) throw 0; DATA.adora=d; MODE="adora"; render();}catch(e){alert("영문 요약을 불러오지 못했습니다.")}
}
function adoraReport(d){
 if(!d)return "<p>영문 요약을 불러오는 중입니다.</p>";
 return `<section class="panel"><div class="eyebrow">FOR ADORA CRUISES · NO PERSONAL / COMPANY DATA</div><h1>ADORA MEDITERRANEA — Korea Market Ship Visit Feedback</h1>
 <p class="lead">Ship visit: 29 Sep 2026, Busan · Responses: ${d.responseCount}/${d.total}</p>
 <p class="small">20-point scale · COSTA SERENA benchmark = 10</p>
 <h2>Comparative Scores</h2>${bars(d.areaAverages)}
 <h2>Selected Expert Comments</h2>${(d.comments||[]).map(x=>`<div class="comment">${esc(x)}</div>`).join("")||"<p>No open comments.</p>"}
 <div class="actions no-print"><button class="primary" onclick="window.print()">Print / Save PDF</button></div></section>`;
}
loginView();
