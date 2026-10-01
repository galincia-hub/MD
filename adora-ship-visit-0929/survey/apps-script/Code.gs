const SHEETS = {
  RAW: '응답 원본',
  ROSTER: '명단',
  MATCH: '매칭 결과',
  SUMMARY: '요약'
};

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (body.action !== 'submit') return json_({ok:false,error:'invalid_action'});
    return json_(saveResponse_(body));
  } catch (err) {
    return json_({ok:false,error:String(err)});
  }
}

function doGet(e) {
  const p = e.parameter || {};
  let result;
  try {
    if (p.action === 'status') result = status_(p.ref);
    else if (p.action === 'dashboard') result = auth_(p.auth) ? dashboard_() : {ok:false,error:'unauthorized'};
    else if (p.action === 'adoraReport') result = auth_(p.auth) ? adoraReport_() : {ok:false,error:'unauthorized'};
    else result = {ok:true,service:'adora-ship-visit-survey'};
  } catch (err) {
    result = {ok:false,error:String(err)};
  }
  return output_(result, p.callback);
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  const names = Object.values(SHEETS);
  names.forEach(n => { if (!ss.getSheetByName(n)) ss.insertSheet(n); });

  const raw = ss.getSheetByName(SHEETS.RAW);
  raw.clear();
  raw.getRange(1,1,1,10).setValues([['timestamp','ref','affiliation','survey_type','group','answers_json','is_latest','duplicate_count','user_agent','response_id']]);
  raw.setFrozenRows(1);

  const match = ss.getSheetByName(SHEETS.MATCH);
  match.clear();
  match.getRange('A1:L1').setValues([['timestamp','ref','affiliation','survey_type','group','answers_json','is_latest','duplicate_count','company','name','title','roster_group']]);
  match.getRange('A2').setFormula(`=IFERROR(FILTER('${SHEETS.RAW}'!A2:H,'${SHEETS.RAW}'!G2:G=TRUE),"")`);
  match.getRange('I2').setFormula(`=ARRAYFORMULA(IF(B2:B="","",IFNA(VLOOKUP(B2:B,'${SHEETS.ROSTER}'!A:G,2,FALSE),"")))`);
  match.getRange('J2').setFormula(`=ARRAYFORMULA(IF(B2:B="","",IFNA(VLOOKUP(B2:B,'${SHEETS.ROSTER}'!A:G,3,FALSE),"")))`);
  match.getRange('K2').setFormula(`=ARRAYFORMULA(IF(B2:B="","",IFNA(VLOOKUP(B2:B,'${SHEETS.ROSTER}'!A:G,4,FALSE),"")))`);
  match.getRange('L2').setFormula(`=ARRAYFORMULA(IF(B2:B="","",IFNA(VLOOKUP(B2:B,'${SHEETS.ROSTER}'!A:G,5,FALSE),"")))`);
  match.setFrozenRows(1);

  const sum = ss.getSheetByName(SHEETS.SUMMARY);
  sum.clear();
  sum.getRange('A1:B7').setValues([
    ['항목','값'],
    ['전체 대상',44],
    ['최신 응답 수',`=COUNTIF('${SHEETS.RAW}'!G2:G,TRUE)`],
    ['응답률',`=IFERROR(B3/B2,0)`],
    ['중복 제출 건',`=COUNTIF('${SHEETS.RAW}'!H2:H,">1")`],
    ['설문 마감','2026-10-06'],
    ['관리자 대시보드','admin.html']
  ]);
  sum.getRange('B4').setNumberFormat('0.0%');
  sum.setFrozenRows(1);
  SpreadsheetApp.flush();
}

function setAdminPassword(password) {
  const hash = sha256_(String(password));
  PropertiesService.getScriptProperties().setProperty('ADMIN_HASH', hash);
  return '관리자 비밀번호가 설정되었습니다.';
}

function setAdminPasswordOnce() {
  const password = 'CHANGE_ME';
  if (password === 'CHANGE_ME') throw new Error('비밀번호를 먼저 변경하세요.');
  return setAdminPassword(password);
}

function saveResponse_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ref = String(body.ref || '').trim().toUpperCase();
    if (!/^G[1-4]-\d{2}$/.test(ref)) throw new Error('invalid_ref');

    const ss = SpreadsheetApp.getActive();
    const raw = ss.getSheetByName(SHEETS.RAW);
    const roster = ss.getSheetByName(SHEETS.ROSTER);
    if (!raw || !roster) throw new Error('run_setup_first');

    const rosterValues = roster.getDataRange().getValues();
    const hit = rosterValues.find((r,i)=>i>0 && String(r[0]).trim() === ref);
    if (!hit) throw new Error('unknown_ref');

    const values = raw.getDataRange().getValues();
    let dup = 0;
    for (let i=1;i<values.length;i++) {
      if (String(values[i][1]) === ref) {
        dup++;
        raw.getRange(i+1,7).setValue(false);
      }
    }
    const group = hit[4] || '';
    const responseId = Utilities.getUuid();
    raw.appendRow([
      new Date(), ref, String(body.affiliation||''), String(body.surveyType||'C'), group,
      JSON.stringify(body.answers||{}), true, dup+1, String(body.userAgent||''), responseId
    ]);
    return {ok:true,ref:ref,duplicateCount:dup+1,responseId:responseId};
  } finally {
    lock.releaseLock();
  }
}

function status_(ref) {
  ref = String(ref || '').trim().toUpperCase();
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.RAW);
  if (!sh) return {ok:true,found:false};
  const v = sh.getDataRange().getValues();
  for (let i=v.length-1;i>=1;i--) {
    if (String(v[i][1])===ref && v[i][6]===true) {
      return {ok:true,found:true,timestamp:new Date(v[i][0]).toISOString(),duplicateCount:v[i][7]};
    }
  }
  return {ok:true,found:false};
}

function dashboard_() {
  const ss=SpreadsheetApp.getActive();
  const roster=sheetObjects_(ss.getSheetByName(SHEETS.ROSTER));
  const raw=sheetObjects_(ss.getSheetByName(SHEETS.RAW)).filter(r=>r.is_latest===true || String(r.is_latest).toUpperCase()==='TRUE');
  const qBank = questionBank_();
  const areas = qBank.meta.areas;
  const rosterMap = Object.fromEntries(roster.map(r=>[r.ref,r]));
  const responses = raw.map(r=>({...r, answers:safeParse_(r.answers_json), roster:rosterMap[r.ref]||{}}));
  const respondedRefs = new Set(responses.map(r=>r.ref));
  const nonresponders = roster.filter(r=>!respondedRefs.has(r.ref)).map(r=>({ref:r.ref,company:r.company,name:r.name,group:r.group}));
  const surveyType = responses[0]?.survey_type || 'C';
  const areaAverages = calcAreaAverages_(responses,qBank[surveyType]||qBank.C,areas);
  return {
    ok:true,total:roster.length,responseCount:responses.length,responseRate:pct_(responses.length,roster.length),
    duplicates: sheetObjects_(ss.getSheetByName(SHEETS.RAW)).filter(r=>Number(r.duplicate_count)>1).length,
    surveyType,
    scoreMax:20,scoreBaseline:10,
    groupRates: rates_(roster,responses,'group'),
    affiliationRates: rates_(roster,responses,'expected_affiliation','affiliation'),
    areaAverages,
    affiliationScores: groupedScores_(responses,qBank[surveyType]||qBank.C,areas,'affiliation'),
    companyScores: groupedScores_(responses,qBank[surveyType]||qBank.C,areas,'company'),
    nonresponders,
    comments: collectComments_(responses,qBank[surveyType]||qBank.C,areas)
  };
}

function adoraReport_() {
  const d=dashboard_();
  const enArea={};
  const q=questionBank_();
  Object.keys(d.areaAverages).forEach(k=>{
    const key=Object.keys(q.meta.areas).find(a=>q.meta.areas[a].title===k);
    enArea[q.meta.areas[key]?.en || k]=d.areaAverages[k];
  });
  const translatedComments=[];
  const flat=Object.values(d.comments||{}).flat().slice(0,24);
  flat.forEach(x=>{
    try{translatedComments.push(LanguageApp.translate(String(x.text),'ko','en'));}catch(e){}
  });
  return {
    ok:true,total:d.total,responseCount:d.responseCount,
    scoreMax:20,scoreBaseline:10,
    areaAverages:enArea,
    comments:translatedComments
  };
}

function rates_(roster,responses,rosterKey,responseKey) {
  responseKey=responseKey||rosterKey;
  const labels=[...new Set(roster.map(r=>r[rosterKey]).filter(Boolean))];
  return labels.map(label=>{
    const total=roster.filter(r=>r[rosterKey]===label).length;
    const refs=new Set(roster.filter(r=>r[rosterKey]===label).map(r=>r.ref));
    const responded=responses.filter(r=>refs.has(r.ref)).length;
    return {label:String(label),responded,total,rate:pct_(responded,total)};
  });
}

function calcAreaAverages_(responses,qs,areas){
  const out={};
  Object.keys(areas).forEach(a=>{
    const ids=qs.filter(q=>q.area===a && (q.type==='score20' || q.type==='scale')).map(q=>q.id);
    const vals=[];
    responses.forEach(r=>ids.forEach(id=>{
      const raw=r.answers[id];
      if(raw==='' || raw===null || raw===undefined) return;
      const n=Number(raw);
      if(Number.isFinite(n) && n>=0 && n<=20) vals.push(n);
    }));
    out[areas[a].title]=vals.length?round_(avg_(vals),2):null;
  });
  return out;
}

function groupedScores_(responses,qs,areas,key){
  const groups={};
  responses.forEach(r=>{
    const g=key==='company'?(r.roster.company||'기타'):(r[key]||'기타');
    if(!groups[g])groups[g]=[];
    groups[g].push(r);
  });
  const out={}; Object.keys(groups).forEach(g=>out[g]=calcAreaAverages_(groups[g],qs,areas)); return out;
}

function collectComments_(responses,qs,areas){
  const out={}; Object.keys(areas).forEach(a=>out[areas[a].title]=[]);
  const textQs=qs.filter(q=>q.type==='text');
  responses.forEach(r=>textQs.forEach(q=>{
    const t=String(r.answers[q.id]||'').trim(); if(t) out[areas[q.area].title].push({ref:r.ref,company:r.roster.company||'',text:t});
  }));
  return out;
}

function questionBank_(){
  return {
    meta:{areas:{
      overall:{title:'선박 전반',en:'Overall Ship Condition'},
      facilities:{title:'공용시설',en:'Public Facilities'},
      fnb:{title:'음식·서비스',en:'Food & Service'},
      venue:{title:'바·라운지·행사공간',en:'Bars, Lounges & Event Spaces'},
      summary:{title:'종합평가·개선의견',en:'Overall Assessment & Improvements'}
    }},
    C:[
      {id:'C01',area:'overall',type:'score20'},
      {id:'C03',area:'facilities',type:'score20'},
      {id:'C04',area:'facilities',type:'text'},
      {id:'C05',area:'fnb',type:'score20'},
      {id:'C06',area:'fnb',type:'score20'},
      {id:'C07',area:'fnb',type:'text'},
      {id:'C08',area:'venue',type:'score20'},
      {id:'C09',area:'venue',type:'text'},
      {id:'C10',area:'summary',type:'score20'},
      {id:'C11',area:'summary',type:'text'},
      {id:'C12',area:'summary',type:'text'},
      {id:'C13',area:'summary',type:'text'}
    ]
  };
}

function auth_(hash){return hash && hash===PropertiesService.getScriptProperties().getProperty('ADMIN_HASH');}
function sha256_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s).map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join('');}
function sheetObjects_(sh){if(!sh)return[];const v=sh.getDataRange().getValues();if(v.length<2)return[];const h=v[0].map(String);return v.slice(1).filter(r=>r.some(x=>x!==''&&x!==null)).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])));}
function safeParse_(s){try{return JSON.parse(String(s||'{}'));}catch(e){return{};}}
function avg_(a){return a.reduce((x,y)=>x+y,0)/a.length;}
function round_(n,d){const p=Math.pow(10,d);return Math.round(n*p)/p;}
function pct_(a,b){return b?round_(a/b*100,1):0;}
function json_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function output_(o,callback){
  const text=JSON.stringify(o);
  if(callback && /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)){
    return ContentService.createTextOutput(`${callback}(${text});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(o);
}
