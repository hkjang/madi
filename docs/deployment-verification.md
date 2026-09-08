# 서비스 이미지 검증 기록과 재현 절차

이미지 생성만으로 폐쇄망 배포 성공을 판단하지 않습니다. 압축 파일을 다시 불러온 뒤 외부 통신이 차단된 Docker 내부 네트워크에서 실제 데이터 왕복을 확인합니다. PostgreSQL은 검증 인프라이며 서비스 릴리즈 아카이브에 포함하지 않습니다.

## 자동 검증

```sh
# 인터넷 연결 빌드 환경에서 실행합니다. 외부 GitHub 게시 작업은 하지 않습니다.
bash scripts/release-image.sh
gzip -t dist/madi-v0.1.0.tar.gz
gzip -dc dist/madi-v0.1.0.tar.gz | docker load
bash scripts/verify-image.sh madi:v0.1.0
```

`release-image.sh`는 `VERSION`을 검증하여 `madi:v버전` 하나를 저장합니다. 임시 아카이브 압축 검증 후에만 `dist/madi-v버전.tar.gz`로 교체하며 SHA-256을 출력합니다. GitHub 업로드는 별도의 태그 릴리즈 작업에서 모든 검증이 통과한 뒤 수행합니다. 사용자 첨부 릴리즈 자산은 서비스 이미지 압축 파일 하나입니다.

검증 도구에는 Docker, Go, Bash, OpenSSL, gzip이 필요합니다. Go로 만든 작은 검증 클라이언트는 **별도 테스트 컨테이너에만** 읽기 전용 마운트되며 서비스 이미지에 추가되지 않습니다. 검증용 PostgreSQL 이미지는 연결망에서 미리 준비할 수 있습니다. 스크립트는 생성한 컨테이너·전용 네트워크·익명 볼륨만 정리하고 기존 서비스에는 접근하지 않습니다.

## 확인 항목

- 서비스에 전달하는 설정은 네 개: `POSTGRES_DSN`, `BOOTSTRAP_ADMIN`, `BOOTSTRAP_ADMIN_PASSWORD`, `ENCRYPTION_KEY`.
- `--internal` 네트워크, UID/GID 10001, 읽기 전용 루트, 전체 capability 제거, 권한 상승 금지.
- 서비스 CPU 2개·메모리 4GiB 제한과 최대 2GiB 임시 공간.
- readiness, 버전 정보, 로그인 화면과 번들 JavaScript·CSS·한국어 폰트 로드.
- Bootstrap 관리자 로그인, 워크스페이스·문서 생성/수정, 첨부파일 바이트 일치.
- 실제 PostgreSQL 작업 큐가 생성한 Markdown 내보내기와 원문 바이트 일치.
- 전체 논리 백업 후 문서 변경→복원, 문서·첨부 복구, 이전 로그인 쿠키 무효화.
- 복원 후 자동 작업 정책이 중지되어 과거 외부 작업을 자동 재실행하지 않는지 확인.

복원된 관리자 계정이 현재 요청자와 일치하면 응답에서 새 세션을 발급할 수 있습니다. 검증은 새 세션과 별개로 **복원 이전 쿠키가 401로 거부되는지** 확인합니다.

## PostgreSQL 운영 백업 별도 검증

논리 ZIP 복원과 별도로 현재 전체 스키마의 `pg_dump`·`pg_restore` 경로도 검증합니다. 운영 DB와 분리된 `_test` 데이터베이스 URI, 데이터베이스 생성 권한, 해당 PostgreSQL 서버 버전 이상인 `pg_dump` 클라이언트가 필요합니다.

```sh
MADI_TEST_POSTGRES_DSN='postgres://tester@127.0.0.1:5432/madi_test?sslmode=disable' \
  MADI_NATIVE_BACKUP_FULL=1 \
  go test ./internal/server -run '^TestNativeBackupCurrentFullSchema$' -count=1 -v
```

이 opt-in 시험은 임의 이름의 두 데이터베이스를 만들고 현재 전체 migration을 적용합니다. 서비스 작업자를 시작하지 않은 상태에서 운영 백업 스크립트로 저장·복원하여 Markdown·첨부 바이트·암호화 설정의 일치를 검사합니다. 복원 세션 제거, Git·커넥터·알림·IMAP·Runbook·공개 링크·내보내기·지원 진단·OTLP 실행 정책 중지와 검색 재색인 대기도 확인합니다. 종료 시 해당 시험이 생성한 두 DB만 삭제하며 기존 서비스에는 접근하지 않습니다. 2026-09-08 PostgreSQL 18.6의 전체 스키마에서 통과했습니다.

운영 스크립트의 자동 첨부 백업 대상은 기본 로컬 저장소입니다. 추가 로컬 provider나 S3/MinIO 객체가 있으면 불완전한 백업을 만들지 않고 거부합니다. 이 경우 모든 provider 루트·버킷·접두사를 포함하는 조직의 일관된 스냅샷 절차를 사용하거나, 크기 제한 내에서 모든 provider 파일을 모으는 madi 논리 백업을 사용하세요. `ENCRYPTION_KEY`는 두 백업 방식 모두 별도 비밀 저장소에 보관합니다.

## 실제 실행 환경

2026-09-08 WSL2 Linux/amd64, CPU 4개·메모리 약 15.6GiB의 공유 개발 호스트에서 Docker 29.8.0 rootless/overlay2와 PostgreSQL 17 컨테이너로 위 항목을 실행했습니다. 초기 `v0.1.0` 후보는 약 65MiB 이미지였으며, JavaScript 2개·폰트 124개와 전체 데이터 복구 시험이 통과했습니다. 최종 릴리즈의 크기·해시는 최종 소스 재빌드 결과를 사용해야 합니다.

최종 화면 수정과 Go 1.26.8 보안 패치를 포함한 **로컬 검증 후보**는 다음과 같습니다. `madi:v0.1.0` 한 개만 포함한 아카이브를 만들고 기존 검증 이미지를 삭제한 뒤 다시 불러와 위 전체 시험을 재통과했습니다.

| 항목 | 로컬 검증 후보 |
| --- | --- |
| 웹 번들 | `main-B2_oEw5_.js` |
| 이미지 크기 | 69,347,594 bytes |
| 아카이브 | `madi-v0.1.0.tar.gz` |
| 아카이브 크기 | 25,699,223 bytes |
| SHA-256 | `6a4aa2539cc1fefe6f827c0df666dd68b5734f15396ade1c7a1c169730ef3dde` |

**이 해시를 실제 GitHub 릴리즈 파일의 해시로 간주하면 안 됩니다.** 릴리즈 작업은 검증한 소스를 다시 빌드하므로 이미지 생성 메타데이터 등에 따라 압축 파일 해시가 달라질 수 있습니다. 워크플로는 이미지 재반입과 폐쇄망 시험을 통과한 실제 게시 파일의 크기·SHA-256을 릴리즈 노트 본문에 자동 기록합니다. 운영망 반입 시에는 해당 릴리즈 본문의 값을 대조하세요. 체크섬 파일이나 PostgreSQL 이미지를 추가 릴리즈 자산으로 첨부하지 않습니다.

기존 개발 호스트 Docker Desktop의 API 오류 때문에 검증 전용 rootless 엔진을 사용했으며, 기존 데몬·컨테이너·WSL은 재시작하지 않았습니다. 공식 패키지를 전용 경로에 추출하고 해시를 대조했으며, namespace 초기화에 사용한 두 UID 매핑 helper의 setuid 비트는 초기화 후 해제했습니다. 이는 해당 개발 호스트의 검증 절차일 뿐, 운영 서비스에 rootless helper나 추가 환경변수를 요구하지 않습니다. 설치 조건은 [Docker rootless 문서](https://docs.docker.com/engine/security/rootless/)를 참고하고, 수동 정적 엔진은 자동 보안 업데이트가 없는 테스트용 선택임에 유의하세요. [Docker 정적 바이너리 안내](https://docs.docker.com/engine/install/binaries/).

이 결과는 단일 복제본 기능·복구 검증입니다. 대규모 성능, 실제 사내 인증서 체인, 조직별 Keycloak/AD·외부 시스템 제품 버전의 수용 시험을 대체하지 않습니다. [규모 측정 가이드](scale-verification.md)에서 부하 시험의 별도 결과와 제한을 확인하세요.
