# Pano · 공동 라벨링

작업 ZIP을 브라우저에서 열고 AI 병소 박스를 사람이 교정하는 도구입니다.
영상·라벨·모델을 웹 서버로 전송하지 않습니다. 모델 실행과 재학습은 기존 Pano 데스크톱에서 합니다.

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

- 담당자·자료·train/val/test·분량(기본 50장)을 선택하고 **친구 작업 ZIP 만들기**.
- 기본값으로 활성 모델의 AI 초안을 생성합니다. 기존 GPU 학습 일시정지/재개 계층을 사용합니다.
- ZIP은 **F:\pano\collaboration\outbox**에 저장됩니다. 이 파일 하나를 친구에게 전달합니다.
- **친구 수정 결과 JSON 가져오기**로 병합합니다.
- 같은 결과 재수입은 중복되지 않습니다. 원본이 변경된 영상은 충돌로 남기며 덮어쓰지 않습니다.
- 반환 영상은 잠금 해제됩니다. 반환 이후 추가 교정은 새 작업으로 배정하세요.
- 미반환 영상은 배정 상태로 남습니다. **배정 취소** 시 그 ZIP의 이후 반환은 거부됩니다.
- 병소별 검토 범위와 train/val/test를 유지합니다. 검토 완료는 자동 학습을 실행하지 않습니다.
- 담당자가 통합 자료를 확인한 뒤 **새 학습**을 시작합니다.
- 작업자 이름은 출처 기록이며 인증된 신원 증명은 아닙니다.

CLI:

~~~powershell
F:\pano\pano.ps1 collab-create --actor "친구" --count 50 --source hanoi --split train --url "https://실제배포주소"
F:\pano\pano.ps1 collab-list
F:\pano\pano.ps1 collab-import F:\pano\collaboration\받은결과.pano-result.json
~~~

--without-predict는 기존 정답·초안만 보내거나 기능을 검증할 때 사용합니다.
공개 저장소 **bridge/**는 기존 Pano 앱 연결 코드 사본입니다. 단독으로 AI 모델을 실행하는 패키지가 아닙니다. 기존 앱 연결 변경은 bridge/integration.patch에 기록되어 있습니다.
영상·모델·실행 환경·실제 라벨은 공개 저장소에 포함하지 않습니다.

## 무료 기본 도메인으로 배포

외부 패키지 설치가 필요 없는 정적 HTML/CSS/JS 앱입니다. 배포할 폴더는 **dist**입니다.

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
node --test tests/*.test.js
~~~

로컬 미리보기는 dist를 정적 HTTP 서버로 실행합니다.
**기능 연습해 보기**는 합성 도형이며 실제 환자 영상이나 모델 성능 예시가 아닙니다.

작업 형식: ZIP_STORED, labels.json + images/id.png + 오프라인 편집기.
반환 형식: pano-result JSON. 좌표는 원본 픽셀의 [x1,y1,x2,y2]입니다.
백엔드는 ID·좌표·라벨 의미·완료 상태·배정 토큰·원본 버전을 검사합니다.
잘못된 결과는 반영하지 않고, 영상별 버전 충돌은 따로 보고합니다. DB 오류 시 전체 병합 트랜잭션을 되돌립니다.
공개 코드를 수정하더라도 영상/라벨 파일을 저장소에 커밋하지 마세요.
