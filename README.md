# Pano · 공동 라벨링

**웹사이트: https://pano-9kh.pages.dev** · Cloudflare Pages에서 GitHub `main` 변경 시 자동 배포됩니다.

작업 ZIP을 브라우저에서 열고 AI 병소 박스를 사람이 교정하는 도구입니다.
**기존 ZIP 편집기(`/`)는** 영상·라벨·모델을 웹 서버로 전송하지 않습니다. 모델 실행과 재학습은 기존 Pano 데스크톱에서 합니다.

## League of Doctors · 판독 게임

게임: **[pano-9kh.pages.dev/play/](https://pano-9kh.pages.dev/play/)**.
한국어·영어·일본어를 선택할 수 있으며 랜딩, 프로필, 편집, 결과, 참여 안내에 적용됩니다.
언어는 브라우저에 저장되고 원본 픽셀 좌표에는 영향을 주지 않습니다.

### 채점 v2

세트당 100점. 정답 종류·위치가 일치하는 박스를 일대일 대응합니다. IoU 0.30 이상에서
최대 개수 우선, 같은 개수면 전체 IoU 합이 최대인 대응을 사용합니다.
같은 병소의 대체 정답은 같은 `finding_id`로 묶습니다.

- N = 채점 대상 정답의 서로 다른 병소 총수.
- TP = 찾은 병소 수, FP = 남은 제출 박스 수(오탐·종류 불일치·중복), FN = N − TP.
- Q = 대응한 박스들의 IoU 합.
- **세트 점수 = 100 × Q / (N + FP)**. 0–100 사이이며 N=0이면 점수를 계산하지 않고 순위에서 제외합니다.
- 재현율 = TP/N, 정밀도 = TP/(TP+FP), 박스 일치도 = Q/TP를 결과에 따로 표시합니다.
- 음성 영상의 오탐도 세트 FP에 포함됩니다. 미검토 문항은 모든 채점 계산에서 제외합니다.
- 개인·국가·대학 순위는 완료한 세트 점수 평균입니다. 예전 1병소 1점 기록은 변경하지 않고 새 순위·학습 후보에서 제외합니다.

현재 무료 세트는 **검증 3장 + 미검토 7장**입니다. 시작 안내에는 수치 비율을 강조하지 않고
일부 문항을 기준으로 채점·피드백한다는 사실을 안내합니다. 개별 정답은 전체 세트 제출 후에만 반환합니다.
`SCORED_PER_ROUND=3`, `TRAINING_MIN_SCORE=50`입니다.
미검토 영상은 전역 단독 배정되며, 다른 참가자에게 중복 배정하지 않습니다.
검증 영상은 참가자 간에 공유하되 같은 계정에 반복 출제하지 않습니다.

무료 세트의 검증 점수가 **50점 이상**일 때만 나머지 답변이 `game_training_candidates`에 포함됩니다.
문턱값은 세트 시작 시 고정합니다. 후보는 `candidate_needs_review`이며 확정 라벨로 자동 승격하지 않습니다.

향후 유료 권한은 서버의 `feedback_plan='full'`로 구분하며 **새로 시작하는 10장 모두 검증된 세트**에만 적용됩니다.
진행 중인 무료 세트나 이전 피드백을 바꾸지 않습니다. 브라우저 요청만으로 권한을 변경할 수 없습니다.
**결제 제공자·결제·권한 발급은 아직 연결 전입니다.** 화면에서도 결제 준비 중으로 안내합니다.

### 실제 Hanoi 문제은행

`F:\pano\league\hanoi-bank\manifest.json`에 비공개 출제 목록을 준비했습니다.
2026-10-17 기준 검증 28장, 미검토 2,942장입니다. 본인 전체 검토 이력 31장 중 train에 속하고
현재 모든 소견의 검토가 유효한 자료를 사용합니다. 친구에게 배정된 100장과 평가 자료 795장은 제외했습니다.
원본 영상 약 8.33 GB는 복사하지 않고 기존 F 드라이브 경로를 참조합니다.

~~~powershell
. F:\pano\scripts\env.ps1
Set-Location F:\pano\collab-web
F:\pano\.venv\Scripts\python.exe -B scripts/prepare-hanoi-bank.py
node scripts/bank.mjs prepare F:\pano\league\hanoi-bank\manifest.json
# Cloudflare 인증, D1/R2 연결 및 모든 migration 적용 후:
node scripts/bank.mjs publish F:\pano\league\hanoi-bank\manifest.json pano-game pano-game-images
# 완료된 세트 중 기준 통과 답변만 반환:
node scripts/bank.mjs export-candidates pano-game F:\pano\league\returns\candidates.json
~~~

업로드 도구는 성공한 R2 객체를 로컬에 기록하여 재개합니다. 영상 업로드가 끝난 다음에만 출제 DB에 등록합니다.
기존 ID의 정답을 자동 덮어쓰지 않습니다. 재검토한 정답은 새 버전 반영 절차가 필요합니다.
내보내기는 사용자 닉네임·Google 식별자 없이 내부 작업자 ID와 점수·기준·박스를 보존합니다.
원본 Pano에 자동 확정/재학습하는 연결은 아직 없으며 검수용 후보 반환 단계입니다.

### 운영 연결 상태

Google OAuth 인증 정보는 Cloudflare Production의 암호화된 Secret으로 관리합니다.
로그인용 D1 `pano-game`에는 0001–0003 마이그레이션을 적용했습니다.
`wrangler.jsonc`의 `env.production`에만 운영 DB를 연결하며 미리보기에는 연결하지 않습니다.
로그인 시험에서 기존 클라이언트가 데스크톱 유형으로 확인되어 `redirect_uri_mismatch`가 발생했습니다.
웹 애플리케이션 클라이언트로 교체해야 실제 로그인이 완료됩니다. 승인된 리디렉션 URI는
`https://pano-9kh.pages.dev/api/auth/callback`입니다.
Google 앱은 현재 테스트 상태이므로 Google 콘솔의 테스트 사용자 설정을 확인하세요.
R2 및 문제은행 업로드는 아직 연결 전입니다. 로그인 연결과 실제 영상 출제 준비는 별개입니다.
[운영자 설정 안내](https://pano-9kh.pages.dev/play/setup)를 참고하세요.
Cloudflare CLI는 미인증 상태입니다. 후속 마이그레이션은 인증 후
`node node_modules/wrangler/bin/wrangler.js d1 migrations apply pano-game --remote --env production`으로 적용합니다.

기존 ZIP 편집기와 달리 게임 답변은 서버에 저장됩니다. Cloudflare Pages Functions + D1 + R2 기반이며
문제은행·환자 영상·정답·사용자 정보·비밀키는 공개 저장소에 포함하지 않습니다.

## 친구가 하는 일

1. 받은 ZIP을 그대로 보관합니다.
2. 웹사이트의 **작업 ZIP 열기**로 선택합니다.
   - 배포 전에도 됩니다: ZIP을 풀고 **index.html**을 연 뒤 원래 ZIP을 선택하세요.
3. 박스를 **확정**하거나 **오탐 제외**합니다. 누락은 **박스 추가**로 표시합니다.
4. 박스 밖의 누락까지 살핀 뒤 소견별 **검토 완료**를 누릅니다.
5. **수정 결과 내보내기**로 내려받은 .pano-result.json을 담당자에게 보냅니다.

진행 중인 결과도 반환할 수 있습니다. 판단이 어려운 영상은 **추가 검토 요청**으로 남깁니다.
자동 저장은 현재 브라우저의 IndexedDB에 보관됩니다. 브라우저 자료 삭제·시크릿 모드·기기 이동에는 남지 않을 수 있으므로 결과 JSON을 백업하세요.
작업 ZIP을 연 뒤 **저장한 결과 JSON 불러오기**로 다른 브라우저에서도 이어서 작업할 수 있습니다.
공유 계정이나 클라우드 동기화 기능은 없습니다. 담당 작업은 원본 Pano 앱에서 관리합니다.

## 박스의 의미

| 소견 | 표시할 범위 |
|---|---|
| 충치 | 병소를 포함하는 작은 박스 |
| 깊은 충치 | 해당 치아 전체 박스 — 기존 탐지기 학습 형식 |
| 매복치 | 해당 치아 전체 박스 |
| 치근단 병소 | 병소 범위 박스 |

정밀 윤곽 교정은 기존 Pano 데스크톱에서 합니다. 웹에서는 기존 정밀 마스크의 좌표를 바꾸지 않습니다.
AI 초안은 정답이나 진단이 아닙니다. **검토 완료**는 해당 범위의 누락까지 사람이 확인했다는 뜻입니다.

단축키: B 추가, V 선택, H 박스 숨기기, Enter 확정, Delete 제외, Ctrl+Z 취소,
Ctrl+Shift+Z 다시 실행, Ctrl+S 결과 내보내기. 휠 확대, Space+드래그 이동.

## 본인 Pano 앱

업데이트된 Pano를 다시 실행하면 **친구와 공동 라벨링** 탭이 있습니다.

- 담당자·자료·train/val/test·분량(기본 100장)을 선택하고 **친구 작업 ZIP 만들기**.
- 기본값으로 활성 모델의 AI 초안을 생성합니다. 기존 GPU 학습 일시정지/재개 계층을 사용합니다.
- ZIP은 **F:\pano\collaboration\outbox**에 저장됩니다. 이 파일 하나를 친구에게 전달합니다.
- **친구 수정 결과 JSON 가져오기**로 병합합니다.
- 같은 결과 재수입은 중복되지 않습니다. 원본이 변경된 영상은 충돌로 남기며 덮어쓰지 않습니다.
- 반환 영상은 잠금 해제됩니다. 반환 이후 추가 교정은 새 작업으로 배정하세요.
- 목록에 **배정·수정 잠김**, **반환·미완료**, **회수·내가 이어하기**가 표시됩니다.
- 반환 JSON 기준으로 **완료 / 부분 작업 / 미반환 / 회수** 수를 확인합니다. 친구 브라우저의 실시간 진행률을 서버로 전송하지 않습니다.
- 친구가 도중에 그만두면 먼저 JSON을 가져온 뒤 **미완료 회수 · 내 작업으로**를 누릅니다. 이미 받은 교정은 보존됩니다.
- **회수분 같은 편집기로 이어하기**로 본인이 남은 작업을 이어합니다. 회수된 영상의 이전 ZIP 반환은 자동 덮어쓰지 않고 충돌로 표시합니다.
- **전체 배정 취소**는 그 ZIP의 이후 반환을 모두 중단합니다. 부분 인계에는 미완료 회수를 사용하세요.
- 병소별 검토 범위와 train/val/test를 유지합니다. 검토 완료는 자동 학습을 실행하지 않습니다.
- 담당자가 통합 자료를 확인한 뒤 **새 학습**을 시작합니다.
- 작업자 이름은 출처 기록이며 인증된 신원 증명은 아닙니다.

CLI:

~~~powershell
F:\pano\pano.ps1 collab-create --actor "친구" --count 100 --source hanoi --split train --url "https://pano-9kh.pages.dev"
F:\pano\pano.ps1 collab-list
F:\pano\pano.ps1 collab-import F:\pano\collaboration\받은결과.pano-result.json
~~~

--without-predict는 기존 정답·초안만 보내거나 기능을 검증할 때 사용합니다.
공개 저장소 **bridge/**는 기존 Pano 앱 연결 코드 사본입니다. 공통 PC 편집기는 기존 PySide6의 QtWebEngineWidgets를 사용합니다. 단독으로 AI 모델을 실행하는 패키지가 아닙니다. 기존 앱 연결 변경은 bridge/integration.patch에 기록되어 있습니다.
영상·모델·실행 환경·실제 라벨은 공개 저장소에 포함하지 않습니다.

## PC와 웹에서 같은 결과 만들기

Pano의 **친구와 같은 박스 편집기** 또는 공동 라벨링 탭의 **본인 작업 준비 · 같은 편집기**를 사용하세요.
PC 창에 웹과 동일한 HTML/JavaScript 편집기를 넣었습니다. ZIP 읽기, 박스 편집, 검토 규칙, JSON 내보내기 함수가 같습니다.
창의 **작업 ZIP 열기**를 누르면 준비된 본인 파일이 자동 선택됩니다. 작업 후 **수정 결과 내보내기 → 내 수정 결과 반영 · 닫기** 순서입니다.
친구에게 이미 배정된 영상은 본인 작업에서 제외됩니다.

좌표 계약은 원본 영상 픽셀의 **[x1,y1,x2,y2]**, 좌상단 원점, 우하단 경계 좌표입니다.
예를 들어 **[10.125,10.75,29.625,31.875]**는 확대율이나 화면 배율과 관계없이 그대로 저장·반영됩니다.
CSS 좌표·확대 배율·스크롤 위치를 JSON 박스에 넣지 않으며, 정수로 반올림하지 않습니다.
작업자·시각·수정 이력은 달라질 수 있지만 같은 박스의 좌표·종류·상태는 같아야 합니다.
기존 정밀 마스크는 박스로 재작성하지 않습니다. 정밀 윤곽 작업은 기존 데스크톱 기능입니다.

검증: 실제 Qt 내장 브라우저가 생성·다운로드한 JSON을 같은 웹용 JavaScript 출력과 비교하고,
데스크톱 DB로 병합한 뒤에도 소수점 좌표가 동일함을 검사합니다. 확대·이동·화면 배율별 좌표 왕복 검사도 포함합니다.
기존 네이티브 편집기에서 공통 편집기로 이동할 때도 원본 픽셀 좌표를 그대로 전달합니다.

## 무료 기본 도메인으로 배포

기존 ZIP 편집기는 정적 HTML/CSS/JS로 실행됩니다. 배포 폴더는 **dist**입니다. 판독 게임 API는 `jose` 패키지와 Cloudflare 연결이 필요하며 Git 연동 빌드에서 의존성을 설치합니다.

### Vercel

1. [New Project](https://vercel.com/new) → GitHub의 **Kevin-Jung-dentist/pano**를 Import.
2. Framework Preset: **Other**, Root Directory: 저장소 루트.
3. vercel.json이 Build Command **node scripts/check.js**, Output Directory **dist**를 지정합니다.
4. Deploy 후 Vercel이 제공하는 **.vercel.app** 주소를 사용합니다.

### Cloudflare Pages

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → Pages 프로젝트 생성 → Git 저장소 연결.
2. **Kevin-Jung-dentist/pano**, Production branch **main**.
3. Framework **None**, Build command **node scripts/check.js**, Build output directory **dist**.
4. 배포 후 제공되는 **.pages.dev** 주소를 사용합니다. 별도 도메인이 필요 없습니다.

발급된 주소를 Pano 협업 탭의 **웹 주소**에 넣으면 이후 ZIP 안내에 포함됩니다.
대용량 ZIP은 Vercel/Cloudflare에 업로드하지 않습니다. 웹사이트에는 편집기 코드만 올라갑니다.

## 검증과 개발

~~~sh
node scripts/check.js
node --test tests/core.test.js tests/game.test.mjs tests/i18n.test.js
~~~

ZIP 편집기는 dist를 정적 HTTP 서버로 실행합니다. 게임 검증용 `node scripts/game-preview.mjs`는 localhost에서만 동작하는 합성 문제·가짜 계정 서버입니다. `/__qa/start`는 이 로컬 서버에만 존재하며 배포되는 Functions에는 없습니다.
**조작 연습**은 운영자가 제공한 `banner_before.PNG`를 실제 게임과 같은 원본 픽셀 박스 편집기로 엽니다. 연습 중 박스는 이 브라우저에 자동 저장되고, 제출하면 `banner_after.PNG` 표시 예시와 비교할 수 있습니다. 검증된 정답 JSON이 없는 예시이므로 점수를 산정하거나 순위·학습자료에 반영하지 않습니다. 두 PNG는 `dist/play/assets/`에 원본 그대로 포함되며 공개 랜딩에도 사용됩니다.

작업 형식: ZIP_STORED, labels.json + images/id.png + 오프라인 편집기.
반환 형식: pano-result JSON. 좌표는 원본 픽셀의 [x1,y1,x2,y2]입니다.
백엔드는 ID·좌표·라벨 의미·완료 상태·배정 토큰·원본 버전을 검사합니다.
잘못된 결과는 반영하지 않고, 영상별 버전 충돌은 따로 보고합니다. DB 오류 시 전체 병합 트랜잭션을 되돌립니다.
공개 코드를 수정하더라도 영상/라벨 파일을 저장소에 커밋하지 마세요.
