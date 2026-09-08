# madi v0.1.0

한국어 중심의 자체 호스팅 Knowledge & AI Workspace입니다. Go 서버가 React 화면을 함께 제공하며 외부 PostgreSQL과 영구 파일 볼륨을 사용합니다. P0~P3 전체 범위를 구현한 첫 릴리즈이며, 게시 워크플로의 빌드·검증·오프라인 실행 검사를 통과한 이미지만 첨부합니다.

## 제공 범위

- 워크스페이스, Markdown 문서와 블록 ID·다중 선택·이동, 위키 링크·백링크·그래프, 문서 트리·검색·즐겨찾기·할 일
- 문서 버전·휴지통 보존기간 정리·첨부파일, 데이터베이스 표·보드·캘린더, Vault 폴더·첨부를 보존하는 Markdown ZIP 입출력
- 로컬 로그인·Keycloak OIDC, 역할과 문서 권한, 개인화 및 분리된 관리자 화면
- 워크스페이스·권한·만료·IP·호출 제한을 설정하는 API 키와 즉시 키 회전
- REST API·OpenAPI 목록·HTTP MCP, OpenAI 호환 스트리밍 AI 및 최대 262,144 토큰 설정
- 관리자 사용자·설정·이력·감사와 논리 백업·복원, 설정할 때만 사용하는 승인 절차
- 한국어 반응형 화면, 로고·파비콘, 로그인·프로필 메뉴의 서비스 버전
- 오프라인 서비스 이미지, Compose·Kubernetes 예제, 제품 소개와 사용자·관리자·운영 가이드
- Yjs 실시간 협업·커서·presence, 고급 중첩·동기화·임베드 블록·KaTeX·Mermaid·다단 편집
- 데이터베이스 6개 보기·관계·안전 수식·롤업·AI 속성, 팀 할 일·칸반·달력·토론·멘션·알림
- 문서 소유권·생명주기·보존·품질·지식 건강, 작업 큐·outbox·Webhook·자동화
- 동의 기반 임베딩·하이브리드 RAG·재정렬·현재 원문 인용, 자연어 검색·선택 문서 요약·개인 AI/검색 기록
- AI 그래프·엔터티·주제·중복·지식 보완 후보와 사용자 단건 확인, Workspace Agent의 도구 제한·쓰기 확인
- SAML·TLS LDAP·SCIM·그룹 매핑, 1/N단계·부서·병렬 승인, 읽기 전용 지원 진단
- 기업 문서 커넥터·외부 SQL 소스·Entity·읽기 전용 Text2SQL, 고정 원격 Git 동기화
- 민감정보 탐지·마스킹·분류·워터마크·보안 공개 공유·법적 보존
- Canvas·Drawing·격리 Plugin SDK, Tauri·PWA·오프라인 개인 보관함·Web Clipper
- 격리·권한·확인 기반 실행형 Runbook, 운영·오류·OpenTelemetry·기능 플래그·워크스페이스 브랜딩

## 배포

릴리즈 자산은 `madi:v0.1.0` 이미지를 저장한 `madi-v0.1.0.tar.gz` 하나입니다. 기본 플랫폼은 Linux amd64입니다. PostgreSQL은 별도로 준비하며 릴리즈에 제3자 서비스 이미지는 포함하지 않습니다.

```sh
gzip -dc madi-v0.1.0.tar.gz | docker load
```

서비스 실행에는 `POSTGRES_DSN`, `BOOTSTRAP_ADMIN`, `BOOTSTRAP_ADMIN_PASSWORD`, `ENCRYPTION_KEY` 네 환경변수가 필요합니다. 그 밖의 운영 설정은 관리자 화면에서 관리합니다. ENCRYPTION_KEY는 32바이트 무작위 값의 Base64 표현이며 별도 안전한 장소에 백업해야 합니다.

## 범위와 제한

첫 릴리즈는 P0~P3 전체 범위를 포함합니다. 각 기능은 관리 정책·현재 권한을 적용하며 선택 외부 인프라는 별도 연결합니다. 프로토콜 시험을 실제 조직 자격증명 연결 시험으로 확대 해석하지 않습니다. Linux Tauri와 Windows·macOS 실행 검증, HTTP MCP와 stdio 전송을 구분합니다. Notion·Obsidian의 모든 독자적 기능을 무손실 변환한다고 보장하지 않습니다. [전체 기능 범위와 운영 한계](https://hkjang.github.io/madi/manuals/roadmap.html)를 확인하세요.

관리자 백업 ZIP은 같은 서비스 버전과 ENCRYPTION_KEY를 사용하는 환경에서 복원할 수 있습니다. 복원은 현재 데이터를 교체하고 세션을 폐기하므로 먼저 격리 환경에서 시험하세요. ZIP 256MB·압축 해제 1GB·10,000개 항목으로 제한하며 대규모 복구와 PITR에는 PostgreSQL·첨부파일의 같은 시점 백업을 사용합니다. 대규모 처리량과 지연 시간은 별도의 부하 시험 전에는 보장하지 않습니다.

릴리즈 워크플로는 웹·Go 빌드, Go 검사, 이미지 재반입 및 외부 통신이 차단된 Docker 네트워크에서 준비 상태·로그인 기동 검사를 통과한 뒤 이미지를 게시합니다. 실제 운영망의 TLS·DNS·프록시·IdP·AI 호환성은 운영 환경에서 추가로 확인하세요.

Go 호출 경로·가져오는 패키지 및 웹 프로덕션 의존성의 출시 전 취약점 검사는 통과했습니다. 별도 데스크톱 Rust SDK에는 GTK 계열의 정보형 경고 17건이 남아 있으며, 해당 SDK는 서비스 Docker 런타임에 포함되지 않습니다. 현재 확인된 입력 경계와 경고의 한계는 [보안 검증 안내](https://hkjang.github.io/madi/manuals/security-verification.html)에 명시합니다.
