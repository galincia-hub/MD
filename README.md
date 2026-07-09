# MD Charter Dashboard

## 개요
2027 Adora Magic City 차터 협상용 3사 컨소시엄 미팅 대시보드.
순수 HTML + CSS + JS 단일 페이지. 빌드 도구 불필요.

## 폴더 구조
- src/                  실제 동작 파일
  - md_dashboard_v2.html  메인 대시보드
- reference/            이전 버전 백업, 제안서 원본 등
- docs/                 작업 메모, 의사결정 기록
  - DECISIONS.md          핵심 가정 및 NPD 도출 근거
- README.md             이 파일

## 실행 방법
src/md_dashboard_v2.html 더블클릭 → 브라우저에서 열림.
서버 불필요. CDN 폰트 로드를 위해 인터넷 연결만 필요.

## 핵심 페이지
1. Overview - 옵션 A/B 한눈 비교
2. 봄 일정 (4항차 / 5항차)
3. 1차/2차 제안서 + 비교
4. 선박 비교, 비용 분석
5. 미팅 아젠다 (협상 / 레그 / 배분)
6. 시뮬레이션 (LB / 가중치 / 레그 / 캐빈 쉐어)
7. 1항차 수익 검증 (NPD 도출, 캐빈별 로드율, 부가수익)
