# madi 기업 계정 연동 가이드

서비스 관리자 메뉴의 **기업 계정 연동**(`/admin/identity`)에서 설정합니다. 추가 환경변수는 필요하지 않습니다. 모든 제공자는 기본 비활성화이며 Bootstrap 관리자 로컬 로그인은 유지됩니다.

## 계정 연결과 그룹 권한

기본 정책은 관리자 직접 연결입니다. 기존 사용자와 동일한 이메일의 외부 계정은 자동 합쳐지지 않습니다. 관리자는 사용자, 제공자, 발급자(issuer), 불변 고유 ID를 확인하고 연결합니다.

선택 정책인 ‘검증된 이메일로 일반 사용자만 자동 연결’을 사용해도 관리자, 서비스 계정, 비활성 사용자, 다른 외부 고유 ID에 연결된 계정은 자동 연결되지 않습니다. LDAP/SAML 이메일은 관리자가 신뢰하도록 설정한 디렉터리/IdP의 주장으로 취급합니다. 이메일 소유권 검증 정책은 해당 제공자에서도 적용하세요.

그룹 매핑은 제공자·그룹·대상 워크스페이스·역할로 구성합니다. 매핑 가능한 역할은 조회자, 댓글 작성자, 편집자, 워크스페이스 관리자입니다. 서비스 관리자와 owner는 매핑할 수 없습니다.

- 로그인 때 전달된 그룹을 동기화합니다. 매핑 정책 변경은 저장 시 기존 연결 계정에도 트랜잭션으로 적용합니다.
- 여러 외부 그룹이 겹치면 가장 높은 관리 역할을 적용합니다.
- 기존 수동 멤버십과 관리자가 직접 변경한 멤버십은 외부 그룹보다 우선합니다. 외부 그룹 제거가 수동 권한을 삭제하지 않습니다.
- 연결 해제 시 해당 제공자가 부여한 관리 역할을 정리하고 사용자 로그인 세션을 종료합니다. 개인 API 키는 별도 키 관리에서 폐기할 수 있습니다.
- LDAP 그룹의 주기적 배치 조회는 하지 않습니다. 사용자가 다시 인증할 때 최신 그룹을 수신합니다. 즉시 계정 정지가 필요하면 관리자 사용자 메뉴에서 비활성화하거나 SCIM을 사용하세요.

## Keycloak OIDC

서비스 설정에서 OIDC issuer, client ID, 필요 시 client secret을 입력합니다. OIDC discovery로 인증·토큰·서명키 주소를 확인합니다. 표준 Authorization Code + PKCE S256을 사용하고 state, nonce, issuer, audience, 토큰 서명, 이메일 검증 상태를 검사합니다.

| 항목 | 값 |
| --- | --- |
| Redirect URI | `https://madi.company/api/v1/auth/oidc/callback` |
| 그룹 claim 기본값 | `groups` |
| 중첩 claim 예시 | `realm_access.roles` |
| 명시적 연결 고유 ID | 검증된 ID token의 `sub` |
| 명시적 연결 issuer | realm issuer URL |

Keycloak에서 그룹 mapper를 ID token에 포함하도록 구성하세요. 신규 계정을 자동 생성하려면 OIDC 자동 등록을 켭니다. 공개 인터넷은 필요하지 않지만 madi 서버와 브라우저에서 사내 Keycloak에 접근할 수 있어야 합니다.

## LDAP · Active Directory

`ldaps://` 또는 StartTLS를 사용하는 `ldap://`만 허용합니다. 평문 비밀번호 bind와 TLS 인증서 검사 무시는 지원하지 않습니다. 사내 CA PEM을 관리자 화면에서 저장할 수 있습니다.

| 항목 | OpenLDAP 예시 | Active Directory 예시 |
| --- | --- | --- |
| URL | `ldaps://ldap.company:636` | `ldaps://ad.company:636` |
| Base DN | `dc=company,dc=local` | `DC=company,DC=local` |
| 검색 필터 | `(&(objectClass=person)(uid={username}))` | `(&(objectClass=user)(sAMAccountName={username}))` |
| 고유 ID | `entryUUID` | `objectGUID` |
| 이메일 | `mail` | `mail` |
| 표시 이름 | `displayName` | `displayName` |
| 그룹 | `memberOf` | `memberOf` |

검색용 Bind DN은 읽기 전용 디렉터리 계정을 권장합니다. 사용자 검색 결과가 정확히 하나일 때 그 DN으로 사용자 비밀번호 bind를 검증합니다. 검색 계정 비밀번호만 서버 암호화 저장하며 사용자 디렉터리 비밀번호는 저장하지 않습니다. 검색 필터의 `{username}`은 정확히 한 번 포함되어야 하며 사용자의 입력값을 LDAP 필터 규칙으로 이스케이프합니다.

명시적 연결 issuer는 `디렉터리URL|BaseDN`입니다. AD objectGUID는 원시 바이트를 URL-safe Base64, padding 없이 인코딩한 값입니다. AD `memberOf` 매핑은 그룹 DN 전체를 사용하며 중첩 그룹을 별도 재귀 검색하지 않습니다.

## SAML

먼저 서비스 URL을 HTTPS로 설정하고 정상 TLS 역방향 프록시를 배치합니다. SAML POST callback의 브라우저 상태 쿠키는 `Secure; HttpOnly; SameSite=None`입니다. HTTP 환경에서는 SAML을 활성화할 수 없습니다.

1. SAML 탭에서 SP 서명 인증서를 생성합니다. RSA 2048비트 키를 생성하고 개인키는 `ENCRYPTION_KEY`로 암호화합니다.
2. SP Metadata를 다운로드해 IdP에 등록합니다.
3. IdP Metadata XML을 입력합니다. 현재 유효한 인증서와 HTTPS HTTP-Redirect SSO 주소가 필요합니다.
4. 이메일, 표시 이름, 그룹 attribute를 매핑합니다. 기본 이름은 `email`, `displayName`, `groups`입니다.
5. SAML 사용을 켜고 저장한 후 로그인 화면에서 회사 계정으로 인증합니다.

| 항목 | URL |
| --- | --- |
| Entity ID / SP Metadata | `https://madi.company/api/v1/auth/saml/metadata` |
| ACS (응답 수신) | `https://madi.company/api/v1/auth/saml/acs` |
| 로그인 시작 | `https://madi.company/api/v1/auth/saml/start` |

AuthnRequest는 RSA-SHA256 서명된 HTTP-Redirect입니다. 응답은 서명된 HTTP-POST assertion을 사용합니다. SHA-1/MD5 서명, 잘못된 issuer/audience/destination, 만료 또는 미래 assertion, 잘못된 InResponseTo, 재사용 assertion, 다른 브라우저의 RelayState는 거부합니다. 오차 허용은 라이브러리의 180초이며 인증 응답 발급 지연 검사는 기본 90초입니다.

지원 범위는 SP 시작 로그인, signed plaintext assertion over HTTPS입니다. 암호화 assertion, Artifact, IdP 시작 로그인, Single Logout는 제공하지 않습니다. Keycloak 클라이언트에서는 assertion 서명과 RSA-SHA256을 사용하고 assertion 암호화는 끄세요. Metadata는 지원하지 않는 암호화 키 용도를 광고하지 않습니다.

SP 인증서 유효기간은 1년입니다. 회전 후 IdP에 새 Metadata를 즉시 등록해야 합니다. 기존 인증 요청은 무효화되므로 진행 중인 사용자는 다시 로그인합니다. 원격 Metadata 자동 갱신은 하지 않으며, IdP 서명 인증서가 만료되기 전에 관리자 화면에서 Metadata를 갱신하세요.

## SCIM 2.0

SCIM 기본 URL은 `https://madi.company/api/v1/scim/v2`입니다. 일반 세션이나 개인 키로는 접근할 수 없습니다.

1. 관리자 사용자 메뉴에서 서비스 계정을 생성합니다. 서비스 계정은 비밀번호 로그인할 수 없습니다.
2. 동기화할 워크스페이스에 서비스 계정을 멤버로 추가합니다.
3. SCIM 탭에서 SCIM 사용과 `identity:provision` 권한 발급 허용을 모두 켜고 저장합니다.
4. 서비스 계정과 워크스페이스를 선택해 키를 발급합니다. 만료일·허용 IP·분당 요청 제한을 설정하세요.
5. IdP/디렉터리 동기화 클라이언트에서 `Authorization: Bearer madi_...`를 설정합니다.

지원 리소스는 `Users`, `Groups`, `ServiceProviderConfig`, `Schemas`, `ResourceTypes`입니다. Users/Groups의 POST, GET, PUT, PATCH, DELETE를 지원합니다. JSON은 SCIM 표준의 camelCase이며 `application/scim+json`을 사용합니다.

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "directory.worker",
  "displayName": "디렉터리 사용자",
  "emails": [{"value": "worker@company.com", "primary": true}],
  "active": true
}
```

키마다 워크스페이스가 고정됩니다. 다른 워크스페이스의 SCIM ID 조회·변경 및 그룹 구성은 거부합니다. 그룹 매핑도 키의 워크스페이스 안에서만 적용합니다. SCIM 신규 사용자에게 기본 조회자 멤버십을 부여하고 명시적 그룹 매핑으로 추가 역할을 적용합니다. 기존 로컬 사용자 이메일을 SCIM 계정으로 자동 편입하지 않습니다. 서비스 관리자로 수동 승격한 사용자는 SCIM으로 수정·삭제할 수 없습니다.

`active:false`는 해당 SCIM 소유 사용자 로그인을 비활성화하고 세션과 외부 관리 멤버십을 정리합니다. DELETE는 SCIM 목록에서 제외하고 계정을 비활성화하지만 문서와 소유권은 보존합니다. 삭제된 사용자의 이메일과 사용자명은 즉시 재사용되지 않습니다.

PATCH 예시:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [{"op": "replace", "path": "active", "value": false}]
}
```

- `userName/displayName/externalId/id eq "값"` 단일 동등 필터를 지원합니다. Users는 userName, Groups는 displayName을 사용합니다.
- `startIndex`는 1부터, `count`는 기본 100/최대 200입니다.
- ETag를 반환하며 PUT/PATCH/DELETE에서 `If-Match`를 보내면 오래된 버전은 412로 거부합니다.
- 그룹 PATCH는 members 전체 add/replace/remove와 `members[value eq "UUID"]` remove를 지원합니다. 중첩 그룹은 지원하지 않습니다.
- 요청은 2MB, PATCH 작업은 100개, 그룹 멤버는 1,000개까지입니다.
- Bulk, 서버 정렬, 암호 변경, Enterprise schema 확장, 복합 필터는 지원하지 않습니다. 미지원 PATCH 경로는 오류를 반환합니다.
- 키 권한 정책에서 `identity:provision`을 제거하면 기존 키에서도 즉시 차단됩니다. 키 회전은 이전 비밀을 즉시 무효화합니다.

## 검증 기록과 운영 경계

자동 테스트는 실제 TLS LDAP 서버, RSA-SHA256 서명 SAML 응답, OIDC 서명 토큰, PostgreSQL 트랜잭션을 사용합니다. 정상 로그인뿐 아니라 잘못된 인증서/서명, 잘못된 audience, 만료, state·assertion 재사용, 관리자 계정 자동 연결, 워크스페이스 격리, SCIM 비활성화와 ETag 충돌을 검증합니다. 브라우저 테스트는 한국어 LDAP 로그인, 관리자 그룹 select 저장, 새로고침 상태, SCIM 키 발급·회전 및 모바일 너비를 검증합니다.

특정 조직의 실제 IdP·AD 제품 버전과의 연동은 배포 환경에서 별도 수용 테스트가 필요합니다. 지원하지 않는 프로토콜 옵션을 활성화하지 마세요. 서버와 IdP의 NTP 시간 동기화, TLS 체인, DNS 접근성과 CA 만료를 운영 점검에 포함하세요.
