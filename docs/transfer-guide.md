# 가져오기·내보내기 가이드

`/app/import`는 미리보기 → 확인 → 작업 큐 → 결과 보고서 순서의 가져오기 센터입니다. `/app/migrations`, `/admin/migration`도 같은 기능을 사용합니다. `/app/export`는 개인 내보내기 센터, `/admin/exports`는 관리자 정책입니다.

## 가져오기

| 형식 | 실제 처리 |
| --- | --- |
| Markdown / Obsidian | `.md`, `.markdown`, ZIP 또는 폴더. 트리, YAML 제목·태그·별칭, Wiki Link, Markdown 링크, 로컬 첨부를 가져옵니다. |
| Notion | Markdown/HTML ZIP. HTML을 안전한 Markdown으로 바꾸고 로컬 이미지와 HTML 문서 링크를 복원합니다. CSV는 원본 첨부와 텍스트 속성 데이터베이스를 함께 만듭니다. |
| HTML | 단일 HTML 또는 로컬 첨부를 담은 ZIP/폴더. 외부 이미지를 자동 다운로드하지 않고 스크립트·iframe·SVG 실행을 제외합니다. |
| CSV | UTF-8, 첫 행은 중복 없는 열 이름. 새 데이터베이스의 텍스트 속성과 행을 만듭니다. |
| JSON | `madi-json-vault` 버전 1 보관함 또는 `title`, `markdown`, `tags`, `aliases` 문서 배열. |

1. 형식과 **대상 공간**을 선택합니다. CSV 데이터베이스는 대상 공간의 ACL을 따릅니다. 제한 자료에는 제한 공간을 먼저 지정하세요.
2. 파일 또는 폴더를 선택하고 **미리보기 만들기**를 누릅니다. 미리보기는 문서를 변경하지 않습니다.
3. 문서·폴더·첨부·DB·행 개수와 동명 문서 안내를 확인합니다.
4. `IMPORT`를 입력하고 **확인한 데이터 가져오기**를 누른 뒤 결과를 확인합니다.

파일 업로드 50MB, ZIP 해제 합계 100MB, 항목 5,000개, Markdown 4MB, 문서 트리 20단계까지입니다. 폴더 선택은 원본 합계 48MB까지이며 브라우저의 별도 Worker에서 ZIP을 준비합니다. CSV는 파일당 5,000행·100열, Notion 혼합 ZIP은 CSV DB 20개까지입니다. 큰 저장소는 나누어 옮기세요.

원본은 DB에 암호화하여 최대 7일 보관합니다. 완료·취소·기간 만료 시 원본을 폐기합니다. 기존 동명 문서를 덮어쓰지 않습니다. JSON의 원래 ID는 새 ID로 대응시키며 기존 사용자·문서의 권한을 덮어쓰지 않습니다. JSON 문서는 새 비공개 초안입니다. 일반 Markdown/Obsidian manifest와 Front Matter의 공개 범위는 기존 가져오기 규칙을 따릅니다. 승인 정책이 켜져 있으면 일반 가져오기의 게시·검토·반려 상태도 초안으로 바뀝니다.

문서·CSV·첨부는 현재 쓰기 권한과 민감정보 정책을 적용하며 혼합 가져오기도 한 트랜잭션에서 완료하거나 실패합니다. Notion의 독점 블록·수식·권한 설정을 모두 재현하지는 않습니다. 복잡한 HTML 표·중첩 목록은 Markdown으로 단순화될 수 있습니다. 플러그인 설정과 Canvas 파일을 자동 실행하거나 설치하지 않습니다.

## 내보내기

| 형식 | 보존 범위 |
| --- | --- |
| Markdown 원문 ZIP | 저장된 Markdown/Front Matter **바이트 그대로** 기록합니다. 링크 문자열도 바꾸지 않습니다. 별도 manifest에 문서·첨부 관계를 기록합니다. |
| Markdown 이동용 ZIP | 다른 Markdown 도구를 위해 문서·첨부 링크를 상대 경로로 바꿉니다. 원문 바이트와 다를 수 있습니다. |
| HTML 읽기 전용 ZIP | `index.html`, 개별 HTML과 로컬 첨부. 로컬 스타일만 쓰고 원격 이미지 자동 로딩·스크립트 실행을 차단합니다. |
| JSON 지식 보관함 | `format: "madi-json-vault"`, `version: 1`, `manifest`, `files: [{path,data_base64}]`. Markdown·첨부 바이트와 폴더·관계를 보존합니다. |
| 데이터베이스 CSV | 저장된 속성 값, UTF-8 BOM. 배열은 JSON 텍스트로 기록합니다. 가상 수식·롤업 계산값은 저장값 내보내기에 포함하지 않습니다. 위험한 수식 시작 문자 `= + - @`는 작은따옴표로 이스케이프합니다. |

문서를 직접 선택하고 결과 생성 버튼을 누릅니다. 문서 1,000개, 파일 5,000개, CSV 10,000행, 원본/결과 최대 100MB 범위에서 처리합니다. 관리자는 최대 크기를 1~100MB로 줄일 수 있습니다. JSON은 base64 때문에 ZIP보다 크며 다시 가져올 때는 업로드 50MB 한도도 적용됩니다.

문서 화면의 단일 Markdown 다운로드도 현재 정본을 제공합니다. **PDF는 문서의 인쇄 메뉴에서 브라우저 ‘PDF로 저장’을 사용합니다. 서버 PDF 생성 작업이 아닙니다.**

내보내기는 PostgreSQL 작업 큐에서 수행합니다. 결과는 ENCRYPTION_KEY로 암호화해 24시간 보관합니다. 개인당 대기 작업 5개·준비 결과 합계 200MB까지이며 취소 버튼으로 폐기할 수 있습니다. 원본 버전·첨부·권한·저장소 연결 설정이 달라지면 생성/다운로드 검사를 통과하지 못합니다. 원래 세션 만료, API 키 삭제·회전·스코프 축소, 플러그인 승인 폐기, 관리자 정책 변경 시 다시 생성하세요.

이미 내려받은 사본에는 후속 권한 변경·삭제·만료를 강제 적용할 수 없습니다. 사본을 별도로 안전하게 보관하고 폐기하세요.

## 관리자와 복원

`/admin/exports`에서 사용 여부와 최대 크기를 설정합니다. 정책 변경은 이전 결과의 정책 지문을 바꾸므로 재생성이 필요합니다. 변경과 다운로드는 감사 기록을 남깁니다.

내보내기 결과는 **다시 만들 수 있는 임시 파일이며 서비스 백업이 아닙니다**. 논리 백업에는 설정·이력을 포함하지만 임시 암호화 Blob은 제외합니다. 복원하면 대기·실행 작업 취소, 준비 결과 만료, Blob 삭제, 기능 중지를 수행합니다. 관리자가 현재 정책을 확인한 뒤 다시 켜세요. 전체 복구는 PostgreSQL·첨부·설정·별도로 보관한 ENCRYPTION_KEY가 필요합니다.

## API

`POST /api/v1/migrations?workspace_id=UUID&space_id=UUID&format=markdown|obsidian|notion|html|csv|json`은 multipart `file`을 받습니다. `GET /migrations/{id}`로 미리보기를 확인하고 `POST /migrations/{id}/run`에 `{"confirmation":"IMPORT"}`를 보냅니다. `DELETE /migrations/{id}`는 미완료 작업을 취소합니다. 문서 쓰기 scope, CSV는 DB 쓰기 scope도 필요합니다.

```json
{"workspace_id":"UUID","format":"markdown","document_ids":["UUID"]}
```

위 값을 `POST /api/v1/exports`로 보냅니다. CSV는 `format: "csv"`, `database_id: "UUID"`를 사용합니다. `GET /exports/{id}`에서 `status: "ready"`를 확인하고 `/exports/{id}/download`로 받습니다. `DELETE /exports/{id}`는 작업·임시 파일을 폐기합니다. 문서 형식은 `document:read`, CSV는 `database:read`와 현재 실제 ACL이 필요합니다. 원래 키와 다른 키로 기존 결과를 받지 못합니다. 원문 지문 변경은 `409`, 취소·접근 불가·폐기 자료는 `404` 또는 `410`입니다.

직접 `/api/v1/import`, `/api/v1/export`는 호환용으로 남아 있습니다. 새 화면과 자동화에는 작업 기반 API를 사용하세요. 기계 판독 명세는 `/api/v1/openapi.json`입니다.
