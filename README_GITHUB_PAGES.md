# PromptGuard GitHub Pages 이전본

업로드한 최신 소스 기반. 원본 백업은 따로 보관하세요.

## 변경
Netlify 서버 어댑터와 TanStack Start 실행을 Vite React 정적 진입점으로 변경했습니다. 기존 Home 화면과 문서 추출 코드를 유지했습니다. PDF Worker/폰트/cmap/WASM/OCR 자산 경로를 BASE_URL 기준 상대 경로로 변경했습니다. GitHub Pages Actions를 추가했습니다.

## 배포
1. ZIP 압축 해제 후 package.json이 최상위에 오도록 전체 내용을 저장소에 올립니다. node_modules는 제외합니다.
2. 숨김 폴더 .github/workflows/pages.yml이 반드시 포함되어야 합니다. 웹 업로드에서 누락되면 GitHub Add file > Create new file에서 .github/workflows/pages.yml을 만들고 패키지 안 파일 내용을 붙여넣습니다.
3. 저장소 Settings > Pages > Source: GitHub Actions.
4. main에 커밋하면 Actions에서 설치 및 빌드 후 배포합니다. 실패하면 로그를 전달하세요.
5. Actions가 성공하고 배포 URL이 표시되면 시크릿 창에서 확인합니다.

## 검증 상태
구조·경로 교체·파일 존재·ZIP 무결성만 검사했습니다. 이 환경에서 의존성 설치/최신 앱 빌드/브라우저 실행은 수행하지 않았습니다. GitHub Actions 첫 실행이 실제 빌드 검증입니다. npm install은 잠금 파일 없이 새 의존성 트리를 계산하므로 변경 가능성이 있습니다. 성공 후 생성된 package-lock.json을 별도 확보해 고정하는 것을 권장합니다.

원본 소스는 이전 v5와 다른 구현입니다. 카드번호·라벨 기반 이름/주소 정규식, 이미지 OCR 코드가 들어 있지만 기능 정확도는 미검증이며, 이전 v5의 암호화 보관함 구현이 이 최신 화면에 통합되었다고 확인되지 않았습니다. 기존 v5 기능이 모두 유지됐다고 주장하면 안 됩니다.

GitHub Pages에서는 netlify.toml/_headers 응답 헤더가 적용되지 않습니다. CSP를 무작정 추가하면 OCR Worker가 중단될 수 있어 이번 패키지에서는 새 CSP를 넣지 않았습니다. 별도 보안 헤더·공급망 검토가 필요합니다. 기존 Netlify와 호스트가 달라 저장 기록이 따라오지 않습니다. 실제 개인정보 대신 합성 예제로 시험하세요.

원본 netlify.toml, AGENTS.md와 라우트 파일은 참고용이며 새 진입점에서 Netlify 서버를 실행하지 않습니다. 잠금 파일은 이식본 의존성과 맞지 않을 수 있어 제거했습니다.
