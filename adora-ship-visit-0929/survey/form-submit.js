(function(){
  function fallbackFormSubmit(action, entryName, payload){
    return new Promise((resolve,reject)=>{
      try{
        const frameName = `gf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const iframe = document.createElement('iframe');
        iframe.name = frameName;
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        const form = document.createElement('form');
        form.method = 'POST';
        form.action = action;
        form.target = frameName;
        form.style.display = 'none';

        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = entryName;
        input.value = payload;
        form.appendChild(input);

        document.body.appendChild(form);
        form.submit();

        setTimeout(()=>{
          form.remove();
          iframe.remove();
          resolve();
        }, 1200);
      }catch(e){
        reject(e);
      }
    });
  }

  window.submitSurvey = async function(){
    const btn=document.querySelector('.survey-actions .primary');
    if(btn){
      btn.disabled=true;
      btn.textContent='제출 중…';
    }

    const action = window.SURVEY_CONFIG?.GOOGLE_FORM_ACTION;
    const entryName = window.SURVEY_CONFIG?.GOOGLE_FORM_ENTRY;

    if(!action || !entryName){
      if(btn){
        btn.disabled=false;
        btn.textContent='제출하기';
      }
      document.getElementById('surveyErr').textContent='응답 저장 설정을 확인해주세요.';
      return;
    }

    const payload = JSON.stringify({
      version: '2026-10-01-v1',
      ref: refCode || '',
      affiliation,
      surveyType: window.SURVEY_CONFIG.SURVEY_TYPE,
      answers,
      submittedAt: new Date().toISOString()
    });

    try{
      const body = new URLSearchParams();
      body.set(entryName, payload);

      await fetch(action, {
        method: 'POST',
        mode: 'no-cors',
        headers: {'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body: body.toString(),
        keepalive: true
      });

      showDone();
    }catch(e){
      try{
        await fallbackFormSubmit(action, entryName, payload);
        showDone();
      }catch(e2){
        if(btn){
          btn.disabled=false;
          btn.textContent='다시 제출하기';
        }
        document.getElementById('surveyErr').textContent='응답 저장에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 눌러주세요.';
      }
    }
  };
})();
