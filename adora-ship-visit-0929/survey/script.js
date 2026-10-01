const app = document.getElementById("app");
const progressBar = document.getElementById("progressBar");
const cfg = window.SURVEY_CONFIG;
const params = new URLSearchParams(location.search);
const refCode = (params.get("ref") || "").trim().toUpperCase();
let bank, questions;
let page = "intro";
const answers = {};
let affiliation = "";

const affiliationOptions = [
  "모두투어",
  "팬스타",
  "롯데제이티비",
  "판매여행사",
  "기항지 및 운영관련",
  "기타"
];

function esc(s=""){
  return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

async function boot(){
  bank = await fetch("questions.json",{cache:"no-store"}).then(r=>r.json());
  questions = bank[cfg.SURVEY_TYPE] || bank.C;
  render();
}

function setProgress(){
  progressBar.style.width = page === "intro" ? "50%" : "100%";
}

function render(){
  setProgress();
  if(page === "intro") renderIntro();
  else renderSurvey();
  scrollTo({top:0,behavior:"smooth"});
}

function renderIntro(){
  app.innerHTML = `
    <div class="eyebrow">2026.09.29 · BUSAN</div>
    <h1>${esc(bank.meta.title)}</h1>

    <div class="intro-copy">
      <p>먼 곳까지 시간을 내어 아도라 메디테라니아 방선투어에 함께해 주셔서 진심으로 감사드립니다.</p>
      <p>비록 짧은 시간이었지만, 크루즈 전세선 판매와 운영을 직접 경험해 오신 전문가 여러분의 시각에서 선박의 현재 상태를 살펴봐 주시고 좋은 의견을 주시면 향후 개선에 적극 반영하겠습니다.</p>
      <p>아도라 크루즈 역시 한국 시장에 높은 관심을 가지고 있으며, 한국 시장을 위한 여러분의 의견을 적극적으로 반영할 의지가 있습니다. 이번에 주시는 의견은 잘 정리하여 아도라 측에 전달하고, 10월 20일 인스펙션에서도 주요 개선사항을 다시 확인하겠습니다.</p>
      <p>아도라 메디테라니아는 코스타 세레나호 철수 이후 한국 출발 차터사업을 이어갈 수 있는 중요한 대체 선박입니다. 이날 참석하신 모든 분들이 향후 한국 차터사업과 직접 연결된 만큼, 애정을 가지고 적극적인 의견을 부탁드립니다.</p>
    </div>

    <div class="field intro-affiliation">
      <div class="q required">참여 구분을 선택해주세요.</div>
      <div class="options affiliation-grid">
        ${affiliationOptions.map((x,i)=>`<div class="option"><input type="radio" id="aff_${i}" name="aff" value="${esc(x)}" ${affiliation===x?"checked":""}><label for="aff_${i}">${esc(x)}</label></div>`).join("")}
      </div>
      <div id="introErr" class="error"></div>
    </div>

    <div class="note">응답 마감: 2026년 10월 6일</div>
    <div class="actions"><button class="primary" onclick="nextIntro()">설문 시작하기</button></div>`;
}

function nextIntro(){
  const checked = document.querySelector('input[name="aff"]:checked');
  if(!checked){
    document.getElementById("introErr").textContent="참여 구분을 선택해주세요.";
    return;
  }
  affiliation = checked.value;
  page = "survey";
  render();
}

function renderSurvey(){
  const guide = bank.meta.scoreGuide;
  const sections = Object.keys(bank.meta.areas).map(area => {
    const meta = bank.meta.areas[area];
    const qs = questions.filter(q=>q.area===area);
    return `
      <section class="survey-section" id="area_${area}">
        <div class="section-head">
          <h2>${esc(meta.title)}</h2>
          <p>${esc(meta.subtitle || "")}</p>
        </div>
        ${qs.map(renderQuestion).join("")}
      </section>`;
  }).join("");

  app.innerHTML = `
    <div class="eyebrow">ADORA MEDITERRANEA · EXPERT FEEDBACK</div>
    <h1>방선투어 전문가 비교평가</h1>
    <p class="lead">아래 모든 점수 항목은 동일한 기준으로 평가해 주세요. 세부 설명을 반복하지 않고 한 번의 기준으로 통일했습니다.</p>

    <div class="score-guide score-guide-main">
      <b>${esc(guide.baselineLabel)}</b>
      <span>${esc(guide.lowLabel)} · ${esc(guide.sameLabel)} · ${esc(guide.highLabel)}</span>
    </div>

    <div id="surveyQuestions">${sections}</div>
    <div id="surveyErr" class="error survey-error"></div>
    <div class="actions survey-actions">
      <button class="secondary" onclick="backToIntro()">이전</button>
      <button class="primary" onclick="submitFromSurvey()">제출하기</button>
    </div>`;
}

function renderQuestion(q){
  const req = q.required ? " required" : "";
  let body="";

  if(q.type==="score20"){
    const saved = answers[q.id];
    const hasSaved = saved !== undefined && saved !== "";
    const current = hasSaved ? Number(saved) : Number(q.baseline ?? 10);
    body=`<div class="score20 compact-score" data-score-wrap="${q.id}">
      <div class="score-readout"><span>선택 점수</span><strong id="score_${q.id}">${hasSaved?current:"-"}</strong><em>/ 20</em></div>
      <input class="score-slider" type="range" min="${q.min??0}" max="${q.max??20}" step="1" value="${current}" data-qid="${q.id}" data-selected="${hasSaved?current:""}" oninput="selectScore('${q.id}', this.value)">
      <div class="score-axis"><span>0</span><span class="baseline">10<small>COSTA</small></span><span>20</span></div>
      <button type="button" class="baseline-btn" onclick="selectScore('${q.id}', 10)">10점 선택</button>
    </div>`;
  } else {
    body=`<textarea name="${q.id}" rows="${q.rows||4}" placeholder="자유롭게 적어주세요.">${esc(answers[q.id]||"")}</textarea>`;
  }

  return `<div class="field question-card" data-qid="${q.id}">
    <div class="q${req}">${esc(q.prompt)}</div>
    ${q.help?`<div class="qhelp">${esc(q.help)}</div>`:""}
    ${body}
    <div class="error" id="err_${q.id}"></div>
  </div>`;
}

function selectScore(id, value){
  const el=document.querySelector(`.score-slider[data-qid="${id}"]`);
  if(!el) return;
  el.dataset.selected=String(value);
  el.value=String(value);
  const out=document.getElementById(`score_${id}`);
  if(out) out.textContent=value;
  answers[id]=Number(value);
  const err=document.getElementById(`err_${id}`);
  if(err) err.textContent="";
}

function collectSurvey(showErrors=true){
  let valid=true;
  let firstInvalid=null;

  questions.forEach(q=>{
    let val;
    if(q.type==="score20"){
      const el=document.querySelector(`.score-slider[data-qid="${q.id}"]`);
      val=el?.dataset.selected ?? "";
      if(val!=="") val=Number(val);
    } else {
      val=document.querySelector(`[name="${q.id}"]`)?.value.trim() || "";
    }

    answers[q.id]=val;
    const empty = val === "" || val === null || val === undefined;
    const err=document.getElementById(`err_${q.id}`);
    if(err) err.textContent="";

    if(q.required && empty){
      valid=false;
      if(showErrors && err) err.textContent="이 문항에 답해주세요.";
      if(!firstInvalid) firstInvalid=document.querySelector(`[data-qid="${q.id}"]`);
    }
  });

  if(!valid && showErrors && firstInvalid){
    firstInvalid.scrollIntoView({behavior:"smooth",block:"center"});
  }
  return valid;
}

function backToIntro(){
  collectSurvey(false);
  page="intro";
  render();
}

function submitFromSurvey(){
  if(!collectSurvey(true)){
    document.getElementById("surveyErr").textContent="필수 문항을 확인해주세요.";
    return;
  }
  document.getElementById("surveyErr").textContent="";
  submitSurvey();
}

function jsonp(url, params={}){
  return new Promise((resolve,reject)=>{
    const cb="cb_"+Date.now()+"_"+Math.random().toString(36).slice(2);
    const s=document.createElement("script");
    const timer=setTimeout(()=>{cleanup();reject(new Error("timeout"));},8000);
    function cleanup(){clearTimeout(timer);delete window[cb];s.remove();}
    window[cb]=(data)=>{cleanup();resolve(data);};
    const u=new URL(url);
    Object.entries({...params,callback:cb}).forEach(([k,v])=>u.searchParams.set(k,v));
    s.src=u.toString();
    s.onerror=()=>{cleanup();reject(new Error("jsonp"));};
    document.body.appendChild(s);
  });
}

async function submitSurvey(){
  const btn=document.querySelector(".survey-actions .primary");
  btn.disabled=true;
  btn.textContent="제출 중…";

  if(!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.startsWith("PASTE_")){
    btn.disabled=false;
    btn.textContent="제출하기";
    document.getElementById("surveyErr").textContent="응답 저장 연결이 아직 완료되지 않았습니다.";
    return;
  }

  const payload={
    action:"submit",
    ref:refCode,
    affiliation,
    surveyType:cfg.SURVEY_TYPE,
    answers,
    userAgent:navigator.userAgent
  };

  try{
    await fetch(cfg.APPS_SCRIPT_URL,{
      method:"POST",
      mode:"no-cors",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify(payload)
    });

    let status=null;
    for(let i=0;i<3;i++){
      await new Promise(r=>setTimeout(r,700));
      status=await jsonp(cfg.APPS_SCRIPT_URL,{action:"status",ref:refCode});
      if(status && status.found) break;
    }
    if(!status || !status.found) throw new Error("not-confirmed");
    showDone();
  }catch(e){
    btn.disabled=false;
    btn.textContent="다시 제출하기";
    document.getElementById("surveyErr").textContent="제출 확인이 되지 않았습니다. 네트워크 상태를 확인한 뒤 다시 눌러주세요.";
  }
}

function showDone(){
  progressBar.style.width="100%";
  app.innerHTML=`<div class="done"><div class="mark">✓</div><h2>감사합니다.</h2><p class="lead">소중한 의견을 아도라 측에 잘 전달하고 2027년 한국 전세선 준비에 반영하겠습니다.</p></div>`;
}

boot().catch(()=>{
  app.innerHTML="<p>설문을 불러오지 못했습니다. 잠시 후 다시 접속해주세요.</p>";
});
