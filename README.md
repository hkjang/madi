# madi

**사람과 AI가 함께 쓰는, 우리 조직의 지식 공간.**

madi는 Markdown 문서와 위키 링크, 문서 데이터베이스, 지식 그래프, AI 및 MCP를 연결하는 한국어 중심의 자체 호스팅 지식관리 서비스입니다. Go 서버 한 개가 React 화면을 함께 제공하며, 외부 PostgreSQL과 영구 파일 볼륨으로 운영합니다. 서비스 화면과 실행에 필요한 자산은 이미지에 포함합니다.

- 제품 소개와 화면: [hkjang.github.io/madi](https://hkjang.github.io/madi/)
- 배포 이미지: [GitHub Releases](https://github.com/hkjang/madi/releases)
- [사용자 가이드](docs/user-guide.md) · [관리자 가이드](docs/admin-guide.md) · [오프라인 운영](docs/offline-guide.md) · [REST API와 MCP](docs/api-guide.md)
- 전체 기능 범위와 운영 한계: [릴리즈 노트](RELEASE_NOTES.md), [P0~P3 범위](docs/roadmap.md), [상세 매뉴얼](https://hkjang.github.io/madi/manuals.html)
- [UI 선택과 접근성](docs/ui-guide.md) · [포함된 오픈소스 고지](web/public/licenses.txt)

## 빠른 시작

Docker와 별도 PostgreSQL 인스턴스를 준비합니다. 폐쇄망에서는 Docker 자체와 PostgreSQL 인프라도 미리 반입되어 있어야 합니다. 서비스 릴리즈 파일은 `madi-v0.1.0.tar.gz` 하나입니다.

```sh
gzip -dc madi-v0.1.0.tar.gz | docker load
cp .env.example .env
# .env의 네 값을 실제 운영 값으로 수정합니다.
docker compose up -d
```

`http://서버주소:8080`에서 초기 관리자 계정으로 로그인합니다. 운영 환경에서는 사내 TLS 프록시 뒤에 배치한 뒤 관리자 시스템 설정에 실제 HTTPS 서비스 URL을 입력하세요. 사용자는 `/app`, 서비스 관리자는 `/admin`을 사용합니다.

| 환경변수 | 용도 |
| --- | --- |
| `POSTGRES_DSN` | PostgreSQL 연결 문자열 |
| `BOOTSTRAP_ADMIN` | 최초 관리자 이메일 |
| `BOOTSTRAP_ADMIN_PASSWORD` | 최초 관리자 비밀번호 |
| `ENCRYPTION_KEY` | 32바이트 무작위 키를 Base64로 인코딩한 값 |

`openssl rand -base64 32`로 암호화 키를 생성할 수 있습니다. 키를 분실하면 DB에 암호화된 연동 비밀을 복호화할 수 없습니다. 최초 관리자 설정은 기존 계정의 비밀번호를 재설정하는 수단이 아닙니다. 서비스 이름, URL, OIDC, AI, 키 정책, 승인 여부 등의 운영 설정은 관리자 화면에서 관리합니다.

## 제품 구성

- Markdown 원문과 블록 ID·다중 선택·이동, 위키 링크·백링크, 검색·그래프, 버전 이력과 휴지통
- 워크스페이스별 역할과 문서 공유, 문서 트리, 데이터베이스 표·보드·캘린더와 할 일
- 로컬 계정과 Keycloak OIDC, 서비스 계정, 범위를 제한한 개인 API 키와 키 회전
- OpenAI 호환 API를 사용하는 스트리밍 AI, 사용자 권한을 적용하는 REST API·OpenAPI 목록과 MCP
- 한국어 반응형 UI, 개인화, 관리자 설정과 감사기록, 로그인·프로필 메뉴의 버전 표시
- 작업 큐 기반 Markdown/Obsidian/Notion/HTML/CSV/JSON·폴더 가져오기와 원문/이동용 ZIP·HTML·JSON·CSV 내보내기, 관리자 논리 백업·복원, Docker와 Kubernetes 배포 예제 ([입출력 가이드](docs/transfer-guide.md))

첫 릴리즈는 **P0~P3 전체 범위**를 대상으로 합니다. Yjs 실시간 협업, 동기화·임베드 블록, 6개 DB 보기·관계·수식·롤업, 할 일·토론·알림·자동화, 동의 기반 하이브리드 RAG와 그래프 AI, 기업 인증·커넥터·외부 SQL, Canvas·Plugin·기기, Git 동기화, 선택적 다단계 승인, 격리된 Runbook과 Workspace Agent를 함께 제공합니다. 실제 운영 연결·모델 한도·플랫폼별 검증·대규모 성능 경계는 [기능 가이드](docs/roadmap.md)에 구분합니다. 개발 중 검증 상태는 [전체 검증 기록](FULL_SCOPE.md)에서 확인하며 모든 범위 검증 전에는 첫 릴리즈를 게시하지 않습니다.

## 로컬 개발

Go 1.26.8 이상, Node.js 22 이상과 PostgreSQL이 필요합니다. 보안 수정이 적용된 패치 버전으로 빌드하세요.

```sh
cd web
npm ci
npm run build
cd ..
# 네 필수 환경변수를 현재 셸에 안전하게 주입합니다.
go run ./cmd/madi
```

Go 바이너리에 `web/dist`를 임베드하므로 Go 빌드와 검사 전에 웹 빌드를 실행합니다.

```sh
go test ./...
go vet ./...
bash scripts/release-image.sh
bash scripts/verify-image.sh madi:v0.1.0
```

`verify-image.sh`는 테스트용 PostgreSQL 이미지를 먼저 준비한 뒤 외부 통신이 차단된 Docker 네트워크에서 서비스의 준비 상태, 로그인 화면, 공개 메타데이터와 초기 관리자 로그인을 확인합니다. 테스트용 PostgreSQL은 릴리즈에 포함되지 않습니다.

## 릴리즈

`VERSION`의 값은 `0.1.0`, Git 태그는 `v0.1.0`, 이미지 태그는 `madi:v0.1.0`, 이미지 압축 파일은 `madi-v0.1.0.tar.gz` 형식입니다. 태그 push 시 릴리즈 워크플로가 빌드·검사·이미지 재반입·오프라인 기동 검증을 수행하고 서비스 이미지 압축 파일만 릴리즈 자산으로 첨부합니다. GitHub가 자동 제공하는 소스 코드 아카이브는 플랫폼 기본 항목입니다.

`main`의 `docs/` 변경은 GitHub Pages 워크플로로 배포합니다. 저장소 Pages 소스는 GitHub Actions로 설정해야 합니다.
