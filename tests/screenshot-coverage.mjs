import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

// This catalogue ties actual application route templates to real successful
// screenshots. Dynamic IDs represent the same page, not fabricated routes.
const evidence = [
  ["/login", "로그인", "login", "identity-directory-login"],
  ["/share/:id", "공개 공유", "public-share-document", "public-share-password", "public-share-mobile"],
  ["/app", "워크스페이스", "workspace", "mobile-workspace", "mobile-menu", "profile-menu"],
  ["/app/documents", "문서 목록", "documents", "document-summary-list"],
  ["/app/documents/:id", "문서 편집·읽기", "document", "editor-source", "block-organizer", "document-history", "document-diff", "document-discussion", "document-rag-index", "document-watermark"],
  ["/app/documents/:id/runbook", "실행 가능한 Runbook", "runbook-document"],
  ["/app/runbook/executions/:id", "Runbook 실행 기록", "runbook-execution", "runbook-mobile"],
  ["/admin/runbook", "Runbook 운영 정책", "runbook-admin"],
  ["/app/search", "통합·AI 검색", "universal-search", "search-filters", "search-code", "natural-search-review", "search-selected-summary", "mobile-universal-search"],
  ["/app/search-history", "개인 검색 기록", "personal-search-history", "search-knowledge-gap"],
  ["/app/ai-history", "개인 AI 대화", "personal-ai-history", "mobile-personal-ai-history"],
  ["/app/git-sync", "Git 연동", "git-sync", "git-sync-preview", "git-sync-confirm", "mobile-git-sync"],
  ["/admin/git-sync", "Git 운영 정책", "admin-git-sync", "mobile-git-policy"],
  ["/admin/operations", "상태·오류·Trace·기능 정책", "admin-operations", "admin-telemetry", "admin-user-features", "mobile-operations"],
  ["/admin/support", "읽기 전용 지원 진단", "support-policy", "support-start", "support-document", "mobile-support"],
  ["/app/workspace-operations", "워크스페이스 브랜딩·기능 정책", "workspace-branding", "workspace-features", "mobile-branding"],
  ["/app/agents", "워크스페이스 AI Agent", "agent-workspace", "agent-settings", "agent-action-confirm"],
  ["/app/agents/runs/:id", "Agent 실행", "agent-run", "mobile-agent-run"],
  ["/admin/information-protection", "정보보호 정책", "admin-information-protection", "information-protection-mobile"],
  ["/app/search-ai-settings", "워크스페이스 검색·RAG 설정", "workspace-search-ai", "mobile-search-ai"],
  ["/admin/search-ai", "서비스 검색·RAG 설정", "admin-search-ai"],
  ["/app/favorites", "즐겨찾기", "favorites"],
  ["/app/trash", "문서 휴지통", "trash"],
  ["/app/graph", "문서 연결 그래프", "graph", "graph-local", "mobile-graph"],
  ["/app/graph-ai", "AI 지식 제안", "graph-ai-consent", "graph-ai-proposals", "graph-ai-confirm", "graph-ai-topic", "mobile-graph-ai"],
  ["/app/knowledge-health", "지식 건강도", "knowledge-health", "knowledge-quality-score", "mobile-knowledge-health"],
  ["/app/documents/:id/knowledge", "문서 수명주기·정책", "document-lifecycle", "document-knowledge-policy", "document-knowledge-history"],
  ["/app/tasks", "할 일·보드·달력", "tasks-list", "tasks-kanban", "tasks-calendar", "task-properties", "mobile-tasks-calendar"],
  ["/app/approvals", "검토·승인함", "approval-inbox", "approval-review"],
  ["/admin/approvals", "승인 정책", "approval-admin", "approval-admin-mobile"],
  ["/app/enterprise", "기업 지식 개요", "enterprise", "enterprise-mobile"],
  ["/app/entities", "엔터티 목록", "entities", "entity-create"],
  ["/app/entities/:id", "엔터티 지식", "entity-profile", "entity-profile-mobile"],
  ["/app/inbox", "빠른 캡처·인박스", "inbox", "inbox-classify", "mobile-inbox"],
  ["/app/templates", "템플릿 라이브러리", "template-library", "template-editor", "template-history", "mobile-templates"],
  ["/app/notification-settings", "개인 알림", "notification-preferences", "notification-delivery-history", "notification-preferences-mobile"],
  ["/admin/notification-channels", "서비스 알림 채널", "admin-notification-channels", "notification-channel-editor"],
  ["/app/databases/*", "문서 데이터베이스", "databases", "database-table", "database-board", "database-calendar", "database-gallery", "database-list", "database-timeline", "database-advanced"],
  ["/app/capture-channels", "이메일·Webhook 수집", "inbound-capture-history", "imap-capture-editor", "captured-private-document", "inbound-capture-mobile"],
  ["/admin/inbound-capture", "외부 수집 정책", "admin-inbound-capture"],
  ["/app/canvases/*", "캔버스·그리기", "canvas-list", "canvas-trash", "canvas", "mobile-canvas"],
  ["/app/import", "가져오기 센터", "migration-center", "migration-folder-preview", "migration-folder-result", "mobile-import"],
  ["/app/export", "내보내기 센터", "export-center", "export-results", "mobile-export"],
  ["/admin/exports", "내보내기 정책", "admin-export-policy", "mobile-export-policy"],
  ["/app/data-sources", "외부 데이터 소스", "data-source-list", "data-source-editor", "data-source-table", "data-source-query", "data-source-results", "text2sql-plan", "text2sql-result"],
  ["/app/connectors", "외부 문서 커넥터", "connectors", "connector-editor", "connector-preview", "connector-results"],
  ["/admin/connectors", "커넥터 정책", "admin-connectors", "admin-connectors-mobile"],
  ["/admin/identity", "인증·디렉터리", "identity-group-mapping", "identity-ldap", "identity-saml", "identity-scim", "mobile-identity"],
  ["/app/plugins/*", "워크스페이스 플러그인", "plugin-list", "plugin-permissions", "plugins", "plugin-block", "mobile-plugins"],
  ["/admin/plugins", "오프라인 플러그인 설치", "admin-plugins"],
  ["/app/migrations", "가져오기 센터 별칭", "migration-center", "migration-preview", "migration-result", "migration-center-mobile", "migration-history-mobile-actions"],
  ["/admin/migration", "관리자 가져오기 센터", "admin-migration"],
  ["/app/members", "워크스페이스 사용자", "members"],
  ["/app/teams", "팀 관리", "teams", "mobile-teams"],
  ["/app/spaces", "공간·권한", "spaces", "space-members", "mobile-spaces"],
  ["/app/organizations", "조직", "organizations"],
  ["/app/workspace-settings", "워크스페이스 설정", "workspace-settings", "mobile-workspace-settings"],
  ["/app/workspace-audit", "워크스페이스 감사", "workspace-audit", "mobile-workspace-audit"],
  ["/app/automations", "자동화", "automations", "automation-editor", "automations-mobile"],
  ["/app/webhooks", "웹훅", "webhooks", "webhook-editor", "webhooks-mobile"],
  ["/app/jobs", "작업 이력", "jobs", "job-detail", "jobs-mobile", "jobs-mobile-actions"],
  ["/app/storage", "워크스페이스 저장소", "workspace-storage", "workspace-storage-mobile"],
  ["/admin/storage", "저장소 제공자", "admin-storage", "storage-local-editor", "storage-s3-editor", "admin-storage-mobile"],
  ["/admin/backup-schedule", "자동 백업", "backup-schedule", "backup-schedule-mobile", "backup-artifacts", "backup-artifacts-mobile"],
  ["/admin/jobs", "작업 큐 정책", "admin-jobs", "admin-jobs-mobile"],
  ["/app/profile", "개인화", "profile-expanded", "keyboard-settings", "profile-dark", "mobile-profile-expanded"],
  ["/app/devices", "오프라인·기기", "devices", "offline-vault", "desktop", "web-clipper", "mobile-devices"],
  ["/app/keys", "개인·서비스 계정 키", "api-keys"],
  ["/admin", "관리자 대시보드", "admin-dashboard", "mobile-admin"],
  ["/admin/users", "서비스 사용자", "admin-users"],
  ["/admin/settings", "서비스 설정", "admin-settings", "admin-settings-oidc", "admin-settings-ai", "admin-settings-security", "admin-settings-workflow", "admin-settings-storage", "admin-settings-history"],
  ["/admin/audit", "감사 로그", "admin-audit"],
  ["/admin/backup", "백업·복원", "admin-backup"],
];
const root = new URL("../", import.meta.url);
const source = await readFile(new URL("web/src/App.tsx", root), "utf8");
const routes = [...source.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1]).filter(r => r !== "*");
assert.equal(new Set(routes).size, routes.length, "Duplicate App route");
const declared = new Set([...routes, "/login"]);
assert.equal(evidence.length, declared.size, "New or removed route needs screenshot coverage mapping");
assert.equal(new Set(evidence.map(e => e[0])).size, evidence.length, "Duplicate evidence route");
const items = [];
for (const [route, title, ...names] of evidence) {
  assert.ok(declared.has(route), `Nonexistent application route: ${route}`);
  const screenshots = [];
  for (const name of names) {
    assert.ok(/^[a-z0-9-]+$/.test(name) && !/fail|error|diagnostic/.test(name), "Diagnostic file cannot be evidence");
    const file = name + ".png";
    const bytes = await readFile(new URL("docs/screenshots/" + file, root));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", file + " is not PNG");
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.ok(width >= 320 && height >= 320, file + " has invalid dimensions");
    screenshots.push({ file, width, height, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  items.push({ route, title, screenshots });
}
const diagnostics = (await readdir(new URL("docs/screenshots/", root))).filter(name => /(?:failure|diagnostic).*\.png$|^failure-.*\.png$/.test(name));
assert.deepEqual(diagnostics, [], "Move diagnostic images outside the published folder");
const result = {
  schema_version: 1,
  checked_at: new Date().toISOString(),
  application_route_source: "web/src/App.tsx",
  declared_routes: routes.length,
  additional_login_entry: true,
  total_covered: items.length,
  note: "실제 성공 화면의 대표 캡처를 라우트별로 연결합니다. 동적 ID와 쿼리 상태는 같은 페이지의 대표 화면으로 검증하며, 기능 동작 통과 기록은 별도 브라우저 회귀 보고서입니다. /app/import와 /app/migrations는 동일한 가져오기 센터입니다.",
  routes: items,
};
if (process.argv.includes("--write")) {
  await writeFile(new URL("docs/screenshots/coverage.json", root), JSON.stringify(result, null, 2) + "\n");
} else {
  const recorded = JSON.parse(await readFile(new URL("docs/screenshots/coverage.json", root), "utf8"));
  assert.deepEqual(recorded.routes, result.routes, "Screenshot coverage changed; verify successful images then regenerate with --write");
  assert.equal(recorded.total_covered, result.total_covered);
}
console.log(`PASS screenshot coverage: ${routes.length} application routes + login, ${items.length} representative mappings, all PNG files exist and hashes match.`);
