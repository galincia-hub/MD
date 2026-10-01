const app = document.getElementById("app");
const progressBar = document.getElementById("progressBar");
const cfg = window.SURVEY_CONFIG;
const params = new URLSearchParams(location.search);
const refCode = (params.get("ref") || "").trim().toUpperCase();
let bank, questions, steps, stepIndex = 0;
const answers = {};
let affiliation = "";

const affiliationOptions = ["모두투어","하드블럭 업체","운영·기항지","기타"];

function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

async function boot(){
  bank = await fetch("questions.json",{cache:"no-store"}).then(r=>r.json());
  questions = bank[cfg.SURVEY_TYPE] || bank.C;
  steps = ["intro", ...Object.keys(bank.meta.areas)];
  render();
}

function setProgress(){
  const pct = stepIndex===0 ? 4 : Math.round((stepIndex/(steps.length-1))*100);
  progressBar.style.width = `${Math.min(pct,100)}%`;
}

function render(){
  setProgress();
  const step = steps[stepIndex];
  if(step==="intro") return renderIntro();
  renderArea(step);
  scrollTo({top:0,behavior:"smooth"});
}

function renderIntro(){
  app.innerHTML = `
    <div class="eyebrow">2026.09.29 · BUSAN</div>
    <h1>${esc(bank.meta.title)}</h1>
    <p class="lead">이번 설문은 코스타 세레나 전세선 판매·운영 경험을 공통 기준으로, 아도라 메디테라니아의 현재 상태와 개선 필요사항을 확인하기 위한 전문가 비교평가입니다. 각 점수는 코스타 세레나를 10점으로 두고 평가해 주세요.</p>
    <div class="field">
      <div class="q required">소속 유형을 선택해주세요.</div>
      <div class="options">
        ${affiliationOptions.map((x,i)=>`<div class="option"><input type="radio" id="aff_${i}" name="aff" value="${esc(x)}" ${affiliation===x?"checked":""}><label for="aff_${i}">${esc(x)}</label></div>`).join("")}
      </div>
      <div id="introErr" class="error"></div>
    </div>
    <div class="score-guide"><b>COSTA SERENA = 10점</b><span>0~9점: 상대적으로 아쉬움 · 10점: 비슷함 · 11~20점: 상대적으로 우수함</span></div><div class="note">응답 마감: 2026년 10월 6일 · 직접 확인하지 못한 내용은 주관식에 그 사실을 적어주셔도 됩니다.</div>
    <div class="actions"><button class="primary" onclick="nextIntro()">시작하기</button></div>`;
}

function nextIntro(){
  const checked = document.querySelector('input[name="aff"]:checked');
  if(!checked){document.getElementById("introErr").textContent="소속 유형을 선택해주세요."; return;}
  affiliation = checked.value;
  stepIndex++; render();
}

function renderArea(area){
  const meta = bank.meta.areas[area];
  const qs = questions.filter(q=>q.area===area);
  app.innerHTML = `
    <div class="eyebrow">${stepIndex} / ${steps.length-1}</div>
    <h2>${esc(meta.title)}</h2>
    <p class="lead">${esc(meta.subtitle)}</p>
    <div id="questions">${qs.map(renderQuestion).join("")}</div>
    <div id="areaErr" class="error"></div>
    <div class="actions">
      <button class="secondary" onclick="prevStep()">이전</button>
      <button class="primary" onclick="nextStep()">${stepIndex===steps.length-1?"제출하기":"다음"}</button>
    </div>`;
}

function renderQuestion(q){
  const req = q.required ? " required" : "";
  let body="";
  if(q.type==="score20"){
    const saved = answers[q.id];
    const hasSaved = saved !== undefined && saved !== "";
    const current = hasSaved ? Number(saved) : Number(q.baseline ?? 10);
    body=`<div class="score20" data-score-wrap="${q.id}">
      <div class="score-readout"><span>선택 점수</span><strong id="score_${q.id}">${hasSaved?current:"-"}</strong><em>/ 20</em></div>
      <input class="score-slider" type="range" min="${q.min??0}" max="${q.max??20}" step="1" value="${current}" data-qid="${q.id}" data-selected="${hasSaved?current:""}" oninput="selectScore('${q.id}', this.value)">
      <div class="score-axis"><span>0<br><small>낮음</small></span><span class="baseline">10<br><small>COSTA SERENA</small></span><span>20<br><small>높음</small></span></div>
      <div class="score-hint">슬라이더를 움직여 점수를 선택하거나, 동일 수준이면 아래 버튼을 눌러주세요.</div>
      <button type="button" class="baseline-btn" onclick="selectScore('${q.id}', 10)">코스타 세레나와 동일 · 10점</button>
    </div>`;
  } else if(q.type==="scale"){
    const nums=Array.from({length:(q.max||5)-(q.min||1)+1},(_,i)=>(q.min||1)+i);
    body=`<div class="scale">${nums.map(n=>`<div class="option"><input type="radio" name="${q.id}" id="${q.id}_${n}" value="${n}" ${String(answers[q.id])===String(n)?"checked":""}><label for="${q.id}_${n}"><strong>${n}</strong><span>${q.labels?.[String(n)]||""}</span></label></div>`).join("")}</div>`;
  } else if(q.type==="radio"){
    body=`<div class="options">${q.options.map((x,i)=>`<div class="option"><input type="radio" name="${q.id}" id="${q.id}_${i}" value="${esc(x)}" ${answers[q.id]===x?"checked":""}><label for="${q.id}_${i}">${esc(x)}</label></div>`).join("")}</div>`;
  } else if(q.type==="multi"){
    const cur = answers[q.id] || [];
    body=`<div class="options">${q.options.map((x,i)=>`<div class="option"><input type="checkbox" name="${q.id}" id="${q.id}_${i}" value="${esc(x)}" ${cur.includes(x)?"checked":""}><label for="${q.id}_${i}">${esc(x)}</label></div>`).join("")}</div><div class="small">최대 ${q.maxSelect || q.options.length}개 선택</div>`;
  } else {
    body=`<textarea name="${q.id}" rows="${q.rows||4}" placeholder="자유롭게 적어주세요.">${esc(answers[q.id]||"")}</textarea>`;
  }
  return `<div class="field" data-qid="${q.id}"><div class="q${req}">${esc(q.prompt)}</div>${q.help?`<div class="qhelp">${esc(q.help)}</div>`:""}${body}<div class="error" id="err_${q.id}"></div></div>`;
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

function collectArea(){
  const area = steps[stepIndex];
  const qs = questions.filter(q=>q.area===area);
  let valid=true;
  qs.forEach(q=>{
    let val;
    if(q.type==="score20"){
      const el=document.querySelector(`.score-slider[data-qid="${q.id}"]`);
      val=el?.dataset.selected ?? "";
      if(val!=="") val=Number(val);
    } else if(q.type==="scale" || q.type==="radio"){
      val = document.querySelector(`input[name="${q.id}"]:checked`)?.value || "";
      if(q.type==="scale" && val!=="") val = Number(val);
    } else if(q.type==="multi"){
      val = [...document.querySelectorAll(`input[name="${q.id}"]:checked`)].map(x=>x.value);
      if(q.maxSelect && val.length>q.maxSelect){
        document.getElementById(`err_${q.id}`).textContent=`${q.maxSelect}개까지만 선택해주세요.`;
        valid=false; return;
      }
    } else {
      val = document.querySelector(`[name="${q.id}"]`)?.value.trim() || "";
    }
    answers[q.id]=val;
    const empty = Array.isArray(val) ? val.length===0 : val==="";
    document.getElementById(`err_${q.id}`).textContent="";
    if(q.required && empty){
      document.getElementById(`err_${q.id}`).textContent="이 문항에 답해주세요.";
      valid=false;
    }
  });
  return valid;
}
function prevStep(){ collectArea(); stepIndex=Math.max(0,stepIndex-1); render(); }
function nextStep(){
  if(!collectArea()) return;
  if(stepIndex<steps.length-1){stepIndex++; render(); return;}
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
    s.src=u.toString(); s.onerror=()=>{cleanup();reject(new Error("jsonp"));};
    document.body.appendChild(s);
  });
}

async function submitSurvey(){
  const btn=document.querySelector(".primary"); btn.disabled=true; btn.textContent="제출 중…";
  if(!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.startsWith("PASTE_")){
    btn.disabled=false; btn.textContent="제출하기";
    document.getElementById("areaErr").textContent="관리자 설정이 아직 완료되지 않았습니다.";
    return;
  }
  const payload={action:"submit",ref:refCode,affiliation,surveyType:cfg.SURVEY_TYPE,answers,userAgent:navigator.userAgent};
  try{
    await fetch(cfg.APPS_SCRIPT_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload)});
    let status=null;
    for(let i=0;i<3;i++){
      await new Promise(r=>setTimeout(r,700));
      status=await jsonp(cfg.APPS_SCRIPT_URL,{action:"status",ref:refCode});
      if(status && status.found) break;
    }
    if(!status || !status.found) throw new Error("not-confirmed");
    showDone();
  }catch(e){
    btn.disabled=false; btn.textContent="다시 제출하기";
    document.getElementById("areaErr").textContent="제출 확인이 되지 않았습니다. 네트워크 상태를 확인한 뒤 다시 눌러주세요.";
  }
}

function showDone(){
  progressBar.style.width="100%";
  app.innerHTML=`<div class="done"><div class="mark">✓</div><h2>감사합니다.</h2><p class="lead">소중한 의견을 2027년 아도라 메디테라니아 상품 준비에 잘 반영하겠습니다.</p></div>`;
}
boot().catch(()=>{app.innerHTML="<p>설문을 불러오지 못했습니다. 잠시 후 다시 접속해주세요.</p>";});
