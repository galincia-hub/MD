(function(){
  const originalRenderIntro = window.renderIntro;
  const originalRenderQuestion = window.renderQuestion;

  if (typeof originalRenderIntro === 'function') {
    window.renderIntro = function(){
      originalRenderIntro();
      const title = document.querySelector('.intro-affiliation .q');
      if (title) {
        title.textContent = '참여 구분을 선택해주세요. (본인의 소속회사에 해당하는 카테고리를 골라주세요.)';
      }
    };
  }

  if (typeof originalRenderQuestion === 'function') {
    window.renderQuestion = function(q){
      // 모든 주관식은 실제 제출 검증에서도 필수 응답으로 통일합니다.
      if (q.type === 'text') q.required = true;

      let html = originalRenderQuestion(q);

      if (q.type === 'score20') {
        // 기존 10점 선택 버튼은 제거하고, 슬라이더 조작 안내로 대체합니다.
        html = html.replace(
          /\s*<button type="button" id="baseline_[^"]+"[^>]*>10점 선택<\/button>/,
          '<span class="score-move-hint">점수 배정을 위해서는 슬라이드를 움직여주세요.</span>'
        );
      }

      if (q.type === 'text') {
        // 모든 주관식에 필수 응답 안내를 명시합니다.
        html = html.replace(
          /(<textarea[^>]*>[\s\S]*?<\/textarea>)/,
          '$1<div class="text-required-note">답변을 해주셔야만 설문을 완성할 수 있습니다.</div>'
        );
      }

      return html;
    };
  }
})();
