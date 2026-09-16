import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  FileText,
  FolderOpen,
  Globe,
  HardDrive,
  History,
  KeyRound,
  LockKeyhole,
  Mail,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Workflow,
} from "lucide-react";
import {
  api,
  bytes,
  date,
  datetime,
  download,
  type User,
  type Settings as SettingsType,
} from "./api";
import { useApp } from "./context";
import {
  Badge,
  Button,
  CopyButton,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeading,
  Toggle,
  roleNames,
} from "./ui";
import { scopeNames } from "./PersonalPages";

const actionNames: Record<string, string> = {
  LOGIN: "로그인",
  LOGOUT: "로그아웃",
  DOCUMENT_CREATE: "문서 생성",
  DOCUMENT_READ: "문서 조회",
  DOCUMENT_UPDATE: "문서 수정",
  DOCUMENT_DELETE: "문서 삭제",
  DOCUMENT_RESTORE: "문서 복원",
  USER_CREATE: "사용자 생성",
  USER_UPDATE: "사용자 변경",
  SETTINGS_UPDATE: "시스템 설정 변경",
  SETTINGS_RESTORE: "시스템 설정 복원",
  MAIL_TEST: "메일 시험 발송",
  FILE_UPLOAD: "파일 업로드",
  FILE_DOWNLOAD: "파일 다운로드",
  DATABASE_CREATE: "데이터베이스 생성",
  DATABASE_QUERY: "데이터베이스 조회",
  AI_QUERY: "AI 질의",
  KEY_CREATE: "API 키 생성",
  KEY_ROTATE: "API 키 회전",
  KEY_REVOKE: "API 키 폐기",
  PERMISSION_CHANGE: "권한 변경",
  BACKUP_CREATE: "백업 생성",
};
export function AdminDashboard() {
  const [stats, setStats] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/admin/stats")
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageHeading
        eyebrow="SERVICE ADMINISTRATION"
        title="운영 대시보드"
        description="조직의 지식과 서비스 상태를 한눈에 확인하세요."
        actions={
          <Link className="button" to="/admin/settings">
            <Settings size={17} /> 서비스 설정
          </Link>
        }
      />
      <ErrorBox error={error} />
      {!stats && !error ? (
        <Loading />
      ) : (
        stats && (
          <>
            <div className="admin-stats">
              {[
                ["사용자", stats.users, "명", Users, "teal"],
                [
                  "워크스페이스",
                  stats.workspaces,
                  "개",
                  FolderOpen,
                  "lavender",
                ],
                ["전체 문서", stats.documents, "개", FileText, "amber"],
                ["데이터베이스", stats.databases, "개", Database, "peach"],
              ].map(([l, v, unit, Icon, color]) => (
                <div className="stat-card" key={String(l)}>
                  <span className={`stat-icon ${color}`}>
                    {typeof Icon !== "string" && typeof Icon !== "number" && (
                      <Icon size={24} />
                    )}
                  </span>
                  <div>
                    <span>{String(l)}</span>
                    <strong>
                      {Number(v || 0).toLocaleString()}
                      <small>{String(unit)}</small>
                    </strong>
                  </div>
                </div>
              ))}
            </div>
            <div className="admin-status-strip">
              <span>
                <span className="status-dot" /> 시스템 데이터 연결됨
              </span>
              <span>
                <HardDrive size={18} /> 첨부파일{" "}
                {bytes(stats.attachments_bytes)}
              </span>
              <span>
                <Sparkles size={18} /> AI 호출 {stats.ai_calls || 0}회
              </span>
            </div>
            <div className="home-columns">
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <Activity size={19} />
                    <h2>최근 활동</h2>
                  </div>
                  <Link to="/admin/audit">
                    모든 로그 <ChevronRight size={16} />
                  </Link>
                </div>
                {stats.recent_activity?.length ? (
                  stats.recent_activity.slice(0, 8).map((a: any, i: number) => (
                    <div className="activity-item" key={a.id || i}>
                      <span className="activity-dot" />
                      <div>
                        <strong>{actionNames[a.action] || a.action}</strong>
                        <small>
                          {a.user_name || "시스템"} · {a.resource || "서비스"}
                        </small>
                      </div>
                      <time>{date(a.created_at)}</time>
                    </div>
                  ))
                ) : (
                  <Empty
                    title="최근 활동이 없습니다"
                    text="서비스의 주요 활동이 이곳에 표시됩니다."
                  />
                )}
              </section>
              <section className="panel padded">
                <h2>
                  <ShieldCheck size={21} /> 지식 건강 상태
                </h2>
                <p className="muted">팀의 지식을 더 유용하게 관리하세요.</p>
                {stats.health && Object.keys(stats.health).length ? (
                  Object.entries(stats.health).map(([k, v]) => (
                    <div className="health-row" key={k}>
                      <span>
                        {{
                          orphan_pages: "연결되지 않은 문서",
                          broken_links: "연결이 끊긴 링크",
                          no_tags: "태그 없는 문서",
                          stale_pages: "오래된 문서",
                          missing_owner: "소유자 없는 문서",
                          review_pending: "검토 대기",
                          private_documents: "개인 문서",
                          trash_documents: "휴지통 문서",
                          untagged_documents: "태그 없는 문서",
                        }[k] || k}
                      </span>
                      <strong>{String(v)}</strong>
                    </div>
                  ))
                ) : (
                  <p className="muted">진단 데이터가 아직 없습니다.</p>
                )}
                <Link className="button full" to="/app/graph">
                  지식 그래프 살펴보기
                  <ArrowUpRight size={17} />
                </Link>
              </section>
            </div>
            <div className="admin-shortcuts">
              <Link to="/admin/users">
                <UserPlus size={25} />
                <div>
                  <strong>사용자 관리</strong>
                  <small>계정과 서비스 권한 관리</small>
                </div>
                <ArrowRight size={19} />
              </Link>
              <Link to="/admin/settings?tab=ai">
                <Sparkles size={25} />
                <div>
                  <strong>AI 연결 설정</strong>
                  <small>사내 LLM과 연결하세요</small>
                </div>
                <ArrowRight size={19} />
              </Link>
              <Link to="/admin/backup">
                <HardDrive size={25} />
                <div>
                  <strong>백업 다운로드</strong>
                  <small>소중한 지식을 안전하게</small>
                </div>
                <ArrowRight size={19} />
              </Link>
            </div>
          </>
        )
      )}
    </>
  );
}

export function AdminUsers() {
  const { user, notify } = useApp();
  const [items, setItems] = useState<User[]>([]),
    [query, setQuery] = useState(""),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<User | null>(null),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState("editor"),
    [kind, setKind] = useState("user"),
    [disabled, setDisabled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = () =>
    api<User[]>("/admin/users")
      .then(setItems)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const edit = (u?: User) => {
    setEditing(u || null);
    setEmail(u?.email || "");
    setName(u?.name || "");
    setPassword("");
    setRole(u?.role || "editor");
    setKind(u?.kind || "user");
    setDisabled(u?.disabled || false);
    setOpen(true);
  };
  const filtered = items.filter((u) =>
    (u.name + " " + u.email).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="PEOPLE & PERMISSIONS"
        title="사용자 관리"
        description="사용자와 서비스 계정의 접근을 관리하세요."
        actions={
          <Button variant="primary" onClick={() => edit()}>
            <UserPlus size={18} /> 사용자 추가
          </Button>
        }
      />
      <div className="filter-bar">
        <div className="search-field">
          <Search size={19} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 또는 이메일 검색…"
            aria-label="사용자 검색"
          />
        </div>
        <Badge>전체 {items.length}명</Badge>
        <Badge tone="green">
          활성 {items.filter((u) => !u.disabled).length}명
        </Badge>
      </div>
      <ErrorBox error={error} />
      <div className="panel table-scroll">
        <table className="data-table user-table">
          <thead>
            <tr>
              <th>사용자</th>
              <th>역할</th>
              <th>계정 유형</th>
              <th>상태</th>
              <th>생성일</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="table-user">
                    <span className="avatar">
                      {u.kind === "service" ? (
                        <Bot size={21} />
                      ) : (
                        u.name.slice(0, 1)
                      )}
                    </span>
                    <div>
                      <strong>{u.name}</strong>
                      <small>{u.email}</small>
                    </div>
                    {u.id === user.id && <Badge>나</Badge>}
                  </div>
                </td>
                <td>
                  <Badge>{roleNames[u.role]}</Badge>
                </td>
                <td>{u.kind === "service" ? "서비스 계정" : "사용자"}</td>
                <td>
                  <Badge tone={u.disabled ? "" : "green"}>
                    {u.disabled ? "비활성" : "활성"}
                  </Badge>
                </td>
                <td>{date(u.created_at)}</td>
                <td>
                  <div className="button-row">
                    <Button onClick={() => edit(u)}>관리</Button>
                    {u.kind === "service" && (
                      <Link className="button" to={`/app/keys?user_id=${u.id}`}>
                        <KeyRound size={15} /> 키
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <Empty
            title="사용자가 없습니다"
            text="사용자를 추가하거나 다른 이름으로 검색해 보세요."
          />
        )}
      </div>
      <div className="notice subtle">
        <Bot size={20} />
        <span>
          서비스 계정은 웹 로그인 없이 API 키로만 접근합니다. 워크스페이스
          멤버에 추가한 후 사용할 키를 발급하세요.
        </span>
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={editing ? "사용자 관리" : "새 사용자 추가"}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api(
                "/admin/users" + (editing ? "/" + editing.id : ""),
                editing ? "PUT" : "POST",
                editing
                  ? { name, role, disabled }
                  : { email, name, password, role, kind },
              );
              setOpen(false);
              load();
              notify(
                editing
                  ? "사용자 정보를 변경했습니다."
                  : "사용자를 추가했습니다.",
              );
            } catch (e) {
              notify((e as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="이름">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field label="이메일">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              readOnly={!!editing}
            />
          </Field>
          {!editing && (
            <>
              <Field label="계정 유형">
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="user">사용자 · 웹 로그인 허용</option>
                  <option value="service">서비스 계정 · API 키 전용</option>
                </select>
              </Field>
              {kind === "user" && (
                <Field label="초기 비밀번호" hint="12자 이상으로 입력하세요.">
                  <input
                    type="password"
                    minLength={12}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </Field>
              )}
            </>
          )}
          <Field label="서비스 역할">
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="viewer">뷰어</option>
              <option value="editor">편집자</option>
              <option value="admin">서비스 관리자</option>
            </select>
          </Field>
          {editing && (
            <Toggle
              checked={!disabled}
              onChange={(v) => setDisabled(!v)}
              label="계정 활성화"
              description="비활성화하면 로그인과 API 키 접근을 차단합니다."
            />
          )}
          <div className="modal-actions">
            <Button type="button" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button variant="primary" disabled={busy}>
              저장
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

const settingTabs = [
  ["general", "일반", Globe],
  ["auth", "인증 / SSO", LockKeyhole],
  ["ai", "AI 서비스", Sparkles],
  ["security", "보안 / API 키", ShieldCheck],
  ["workflow", "검토 / 승인", Workflow],
  ["storage", "저장소 / 보존", HardDrive],
  ["mail", "메일 알림", Mail],
  ["history", "설정 변경 이력", History],
];
const mailEventSwitches: [string, string, string][] = [
  [
    "mail.notify_approval_request",
    "검토 요청 도착",
    "내 차례가 된 검토자에게 보냅니다.",
  ],
  [
    "mail.notify_approval_decision",
    "검토 결과",
    "승인·반려 결과를 요청자와 소유자에게 보냅니다.",
  ],
  [
    "mail.notify_access_request",
    "문서 접근 권한 요청·처리",
    "소유자에게 요청 도착을, 요청자에게 처리 결과를 보냅니다.",
  ],
  [
    "mail.notify_task_assigned",
    "할 일 담당 지정",
    "담당자로 지정된 사람에게 보냅니다.",
  ],
  [
    "mail.notify_runbook",
    "격리 작업 완료·실패",
    "오래 걸리는 격리 실행이 끝났을 때 실행한 사람에게 보냅니다.",
  ],
  [
    "mail.notify_review_due",
    "문서 검토 주기 경과",
    "검토 기한이 지난 문서를 담당자에게 묶어서 보냅니다.",
  ],
];
const mailEventNames: Record<string, string> = {
  "approval.requested": "검토 요청",
  "approval.decided": "검토 결과",
  "access_request.created": "접근 요청 도착",
  "access_request.decided": "접근 요청 처리",
  "task.assigned": "할 일 지정",
  "runbook.finished": "격리 작업 종료",
  "document.review_due": "검토 주기 경과",
  test: "시험 발송",
};
const mailStatusNames: Record<string, [string, string]> = {
  queued: ["대기", "light"],
  sent: ["보냄", "green"],
  failed: ["실패", "red"],
};

function MailDeliveryPanel({ settings }: { settings: SettingsType }) {
  const { notify } = useApp();
  const [recipient, setRecipient] = useState(""),
    [sending, setSending] = useState(false),
    [result, setResult] = useState<{ ok: boolean; text: string } | null>(null),
    [page, setPage] = useState<{ items: any[]; summary: any } | null>(null),
    [error, setError] = useState("");
  const load = () =>
    api<{ items: any[]; summary: any }>("/admin/mail/deliveries?limit=50")
      .then(setPage)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const status = page?.summary?.status || {};
  return (
    <>
      <section className="panel padded">
        <div className="settings-section-title">
          <Send size={24} />
          <div>
            <h2>시험 발송</h2>
            <p>
              저장된 설정으로 실제 한 통을 보내고 릴레이의 응답을 바로
              확인합니다. 메일 알림이 꺼져 있어도 시험은 보낼 수 있습니다.
            </p>
          </div>
        </div>
        {!settings["mail.smtp_host"] && (
          <div className="notice subtle">
            <Mail size={19} />
            <span>먼저 릴레이 주소를 입력하고 설정을 저장하세요.</span>
          </div>
        )}
        <Field
          label="받는 주소"
          hint="비워 두면 현재 관리자 계정의 이메일로 보냅니다."
        >
          <div className="input-with-button">
            <input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="ops@company.internal"
            />
            <Button
              type="button"
              variant="primary"
              disabled={sending || !settings["mail.smtp_host"]}
              onClick={async () => {
                setSending(true);
                setResult(null);
                try {
                  const v = await api<{ sent: boolean; recipient: string }>(
                    "/admin/mail/test",
                    "POST",
                    { recipient },
                  );
                  setResult({
                    ok: true,
                    text: `${v.recipient} 로 보냈습니다. 받은편지함을 확인하세요.`,
                  });
                } catch (e) {
                  setResult({ ok: false, text: (e as Error).message });
                } finally {
                  setSending(false);
                  load();
                }
              }}
            >
              <Send size={16} /> {sending ? "보내는 중…" : "시험 발송"}
            </Button>
          </div>
        </Field>
        {result && (
          <div className={result.ok ? "notice" : "notice error"}>
            {result.ok ? <CheckCircle2 size={19} /> : <Mail size={19} />}
            <span>{result.text}</span>
          </div>
        )}
      </section>
      <section className="panel padded">
        <div className="settings-section-title">
          <History size={24} />
          <div>
            <h2>발송 기록</h2>
            <p>
              언제 어떤 이벤트로 누구에게 무엇을 보냈고 되었는지 남깁니다.
              본문은 기록하지 않습니다.
            </p>
          </div>
        </div>
        <div className="filter-bar">
          <Badge tone="green">보냄 {status.sent || 0}</Badge>
          <Badge tone="red">실패 {status.failed || 0}</Badge>
          <Badge tone="light">대기 {status.queued || 0}</Badge>
          <Button
            type="button"
            onClick={() => {
              load();
              notify("발송 기록을 새로고침했습니다.");
            }}
          >
            <RefreshCw size={16} /> 새로고침
          </Button>
        </div>
        <ErrorBox error={error} />
        {page && page.items.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>이벤트</th>
                  <th>받는 사람</th>
                  <th>제목</th>
                  <th>상태</th>
                  <th>오류</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((d) => (
                  <tr key={d.id}>
                    <td>{datetime(d.created_at)}</td>
                    <td>
                      <Badge>{mailEventNames[d.event] || d.event}</Badge>
                    </td>
                    <td>
                      <code>{d.recipient}</code>
                    </td>
                    <td>
                      {d.subject}
                      {d.notifications > 1 && (
                        <small className="muted">
                          {" "}
                          · 알림 {d.notifications}건 묶음
                        </small>
                      )}
                    </td>
                    <td>
                      <Badge tone={(mailStatusNames[d.status] || ["", ""])[1]}>
                        {(mailStatusNames[d.status] || [d.status])[0]}
                        {d.attempts > 1 ? ` (${d.attempts}회)` : ""}
                      </Badge>
                    </td>
                    <td>
                      <small>{d.error_message || "—"}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="발송 기록이 없습니다"
            text="메일 알림을 켜고 이벤트가 발생하거나 시험 발송을 하면 이곳에 남습니다."
          />
        )}
      </section>
    </>
  );
}
export function AdminSettings() {
  const { notify, refreshPublic } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "general";
  const [settings, setSettings] = useState<SettingsType | null>(null),
    [changes, setChanges] = useState<SettingsType>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<any[]>([]);
  const load = () =>
    api<SettingsType>("/admin/settings")
      .then((v) => {
        setSettings(v);
        setChanges({});
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (tab === "history")
      api<any[]>("/admin/settings/history")
        .then(setHistory)
        .catch((e) => setError(e.message));
  }, [tab]);
  const v = (key: string, fallback: any = "") =>
    changes[key] ?? settings?.[key] ?? fallback;
  const set = (key: string, value: any) =>
    setChanges({ ...changes, [key]: value });
  const input = (key: string, label: string, type = "text", hint?: string) => (
    <Field label={label} hint={hint}>
      <input
        type={type}
        value={v(key)}
        onChange={(e) =>
          set(key, type === "number" ? Number(e.target.value) : e.target.value)
        }
        placeholder={
          type === "password" && settings?.[key + "_configured"]
            ? "저장된 비밀 값이 있습니다. 변경할 때만 입력하세요."
            : undefined
        }
        autoComplete={type === "password" ? "new-password" : undefined}
      />
    </Field>
  );
  return (
    <>
      <PageHeading
        eyebrow="SET UP YOUR WORKSPACE"
        title="서비스 설정"
        description="서비스 운영에 필요한 설정을 한곳에서 관리하세요."
      />
      <div className="admin-settings-layout">
        <nav className="settings-nav">
          {settingTabs.map(([id, label, Icon]) => (
            <button
              key={String(id)}
              className={tab === id ? "active" : ""}
              onClick={() => setParams({ tab: String(id) })}
            >
              {typeof Icon !== "string" && <Icon size={18} />}
              <span>{String(label)}</span>
              <ChevronRight size={15} />
            </button>
          ))}
        </nav>
        <div className="admin-settings-content">
          <ErrorBox error={error} />
          {!settings ? (
            <Loading />
          ) : tab === "history" ? (
            <section className="panel padded">
              <h2>
                <History size={21} /> 설정 변경 이력
              </h2>
              <p className="muted">
                관리 설정의 이전 상태를 확인하고 복원할 수 있습니다.
              </p>
              {history.length ? (
                history.map((h) => (
                  <div className="history-setting" key={h.id}>
                    <div>
                      <strong>{datetime(h.created_at)}</strong>
                      <small>
                        {h.user_name || h.actor_name || "관리자"} ·{" "}
                        {h.id?.slice(0, 8)}
                      </small>
                      {h.changed_keys && (
                        <small>{h.changed_keys.join(", ")}</small>
                      )}
                    </div>
                    <Button
                      onClick={async () => {
                        if (
                          !window.confirm(
                            "이 시점의 시스템 설정으로 복원할까요? 인증 및 AI 설정도 변경될 수 있습니다.",
                          )
                        )
                          return;
                        try {
                          await api(
                            "/admin/settings/history/" + h.id + "/restore",
                            "POST",
                          );
                          await load();
                          notify("이전 설정으로 복원했습니다.");
                        } catch (e) {
                          notify((e as Error).message, "error");
                        }
                      }}
                    >
                      복원
                    </Button>
                  </div>
                ))
              ) : (
                <Empty
                  title="설정 변경 이력이 없습니다"
                  text="설정을 변경하면 이곳에 기록됩니다."
                />
              )}
            </section>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const payload = { ...changes };
                  for (const key of ["oidc_client_secret", "ai_api_key"])
                    if (payload[key] === "") delete payload[key];
                  const updated = await api<SettingsType>(
                    "/admin/settings",
                    "PUT",
                    payload,
                  );
                  setSettings(updated);
                  setChanges({});
                  await refreshPublic();
                  notify("서비스 설정을 저장했습니다.");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <section className="panel padded">
                {tab === "general" && (
                  <>
                    <div className="settings-section-title">
                      <Globe size={24} />
                      <div>
                        <h2>일반 설정</h2>
                        <p>서비스의 이름과 외부 접근 주소를 설정하세요.</p>
                      </div>
                    </div>
                    {input(
                      "site_name",
                      "서비스 이름",
                      "text",
                      "로그인 화면에 표시되는 서비스 이름입니다.",
                    )}
                    {input(
                      "site_url",
                      "서비스 URL",
                      "url",
                      "SSO 콜백에 사용합니다. 예: https://madi.company.internal",
                    )}
                    <div className="notice subtle">
                      <Users size={19} />
                      <span>
                        계정은 사용자 관리에서 생성하거나 OIDC 자동 등록으로
                        추가합니다.
                      </span>
                    </div>
                  </>
                )}
                {tab === "auth" && (
                  <>
                    <div className="settings-section-title">
                      <LockKeyhole size={24} />
                      <div>
                        <h2>Keycloak OIDC</h2>
                        <p>
                          Issuer URL과 클라이언트 정보로 회사 계정을 연결하세요.
                        </p>
                      </div>
                    </div>
                    <Toggle
                      checked={v("oidc_enabled", false)}
                      onChange={(x) => set("oidc_enabled", x)}
                      label="SSO 로그인 사용"
                      description="로그인 화면에 회사 계정 로그인 버튼이 표시됩니다."
                    />
                    {input(
                      "oidc_issuer",
                      "Issuer URL",
                      "url",
                      "예: https://sso.company.internal/realms/company",
                    )}
                    {input("oidc_client_id", "Client ID")}
                    {input("oidc_client_secret", "Client Secret", "password")}
                    <Toggle
                      checked={v("oidc_require_verified_email", false)}
                      onChange={(x) => set("oidc_require_verified_email", x)}
                      label="SSO 이메일 검증 필수"
                      description="기본은 꺼짐입니다. 꺼두면 Keycloak의 이메일 미검증 계정도 로그인할 수 있습니다. 토큰 검증과 기존 계정 연결 보호는 유지됩니다."
                    />
                    <Toggle
                      checked={v("oidc_auto_register", false)}
                      onChange={(x) => set("oidc_auto_register", x)}
                      label="처음 로그인한 사용자 자동 등록"
                      description="SSO 인증을 마친 신규 계정으로 madi 사용자를 생성합니다. 같은 이메일의 기존 계정은 별도 연결 정책을 따릅니다."
                    />
                    <Toggle
                      checked={v("oidc_auto_login", false)}
                      onChange={(x) => set("oidc_auto_login", x)}
                      label="자동 로그인 (silent SSO)"
                      description="기본은 꺼짐입니다. 켜면 Keycloak에 이미 로그인한 사용자는 로그인 화면 없이 바로 본 화면으로 들어갑니다. 세션이 없으면 로그인 화면을 보여 주고 같은 탭에서 다시 시도하지 않습니다."
                    />
                    <Field label="Keycloak에 등록할 Redirect URI">
                      <div className="input-with-button">
                        <input
                          readOnly
                          value={
                            String(
                              v("site_url") || window.location.origin,
                            ).replace(/\/$/, "") + "/api/v1/auth/oidc/callback"
                          }
                        />
                        <CopyButton
                          value={
                            String(
                              v("site_url") || window.location.origin,
                            ).replace(/\/$/, "") + "/api/v1/auth/oidc/callback"
                          }
                        />
                      </div>
                    </Field>
                    <div className="notice">
                      <ShieldCheck size={20} />
                      <span>
                        Keycloak 클라이언트의 Client authentication과 Standard
                        flow를 활성화하세요. 설정 저장 후 회사 계정 로그인을
                        확인하세요.
                      </span>
                    </div>
                  </>
                )}
                {tab === "ai" && (
                  <>
                    <div className="settings-section-title">
                      <Sparkles size={24} />
                      <div>
                        <h2>AI 서비스 연결</h2>
                        <p>OpenAI 호환 API로 사내 LLM과 연결합니다.</p>
                      </div>
                    </div>
                    <Toggle
                      checked={v("ai_enabled", false)}
                      onChange={(x) => set("ai_enabled", x)}
                      label="AI 도우미 사용"
                      description="문서 요약, 작성 지원과 워크스페이스 질의를 활성화합니다."
                    />
                    {input(
                      "ai_base_url",
                      "API Base URL",
                      "url",
                      "vLLM / Ollama / 사내 Gateway의 OpenAI 호환 URL. 예: http://llm.internal:8000/v1",
                    )}
                    {input("ai_api_key", "API Key", "password")}
                    {input(
                      "ai_model",
                      "모델 이름",
                      "text",
                      "서버에 배포된 모델 식별자를 정확히 입력하세요.",
                    )}
                    <Field
                      label="최대 출력 토큰"
                      hint="1~262,144 토큰 (256K). 실제 지원 한도는 연결한 모델에 따라 다릅니다."
                    >
                      <input
                        type="number"
                        min={1}
                        max={262144}
                        value={v("ai_max_tokens", 4096)}
                        onChange={(e) =>
                          set("ai_max_tokens", Number(e.target.value))
                        }
                        required
                      />
                    </Field>
                    <Field label="시스템 프롬프트">
                      <textarea
                        rows={5}
                        value={v("ai_system_prompt")}
                        onChange={(e) =>
                          set("ai_system_prompt", e.target.value)
                        }
                        placeholder="AI 도우미의 기본 응답 원칙을 설정하세요."
                      />
                    </Field>
                    <div className="notice">
                      <Sparkles size={19} />
                      <span>
                        AI 응답은 기본 스트리밍으로 전달합니다. 검색과 출처는
                        요청자의 문서 접근 권한을 따릅니다.
                      </span>
                    </div>
                  </>
                )}
                {tab === "security" && (
                  <>
                    <div className="settings-section-title">
                      <ShieldCheck size={24} />
                      <div>
                        <h2>보안 및 API 키 정책</h2>
                        <p>세션과 API 키의 기본 정책을 설정하세요.</p>
                      </div>
                    </div>
                    <div className="form-grid">
                      <Field label="세션 유효시간 (시간)">
                        <input
                          type="number"
                          min={1}
                          max={720}
                          value={v("session_hours", 24)}
                          onChange={(e) =>
                            set("session_hours", Number(e.target.value))
                          }
                          required
                        />
                      </Field>
                      <Field label="API 키 기본 유효기간 (일)">
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={v("default_key_days", 90)}
                          onChange={(e) =>
                            set("default_key_days", Number(e.target.value))
                          }
                          required
                        />
                      </Field>
                    </div>
                    <fieldset className="scope-fieldset">
                      <legend>API 키에 허용할 권한</legend>
                      <p className="muted">
                        허용 목록에서 제외한 권한은 기존 키에서도 사용할 수
                        없습니다.
                      </p>
                      <div className="scope-grid">
                        {Object.entries(scopeNames).map(([scope, label]) => (
                          <label key={scope}>
                            <input
                              type="checkbox"
                              checked={v(
                                "allowed_key_scopes",
                                Object.keys(scopeNames),
                              ).includes(scope)}
                              onChange={(e) =>
                                set(
                                  "allowed_key_scopes",
                                  e.target.checked
                                    ? [
                                        ...v(
                                          "allowed_key_scopes",
                                          Object.keys(scopeNames),
                                        ),
                                        scope,
                                      ]
                                    : v(
                                        "allowed_key_scopes",
                                        Object.keys(scopeNames),
                                      ).filter((s: string) => s !== scope),
                                )
                              }
                            />
                            <span>
                              {label}
                              <small>{scope}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="notice subtle">
                      <KeyRound size={19} />
                      <span>
                        개인별 키 생성, 권한 변경, 회전 및 폐기는 개인 설정의
                        API 키에서 관리합니다.
                      </span>
                    </div>
                  </>
                )}
                {tab === "workflow" && (
                  <>
                    <div className="settings-section-title">
                      <Workflow size={24} />
                      <div>
                        <h2>문서 검토 및 승인</h2>
                        <p>조직에 필요한 경우 검토 프로세스를 활성화하세요.</p>
                      </div>
                    </div>
                    <Toggle
                      checked={v("approval_enabled", false)}
                      onChange={(x) => set("approval_enabled", x)}
                      label="검토 및 승인 프로세스 사용"
                      description="기본적으로 꺼져 있습니다. 켜면 문서에 검토 요청, 승인, 반려 기능이 표시됩니다."
                    />
                    {v("approval_enabled", false) ? (
                      <>
                        <Field label="검토자 역할">
                          <select
                            value={v("reviewer_role", "admin")}
                            onChange={(e) =>
                              set("reviewer_role", e.target.value)
                            }
                          >
                            <option value="admin">관리자</option>
                            <option value="editor">편집자 이상</option>
                          </select>
                        </Field>
                        <div className="workflow-preview">
                          <span>문서 작성</span>
                          <ArrowRight size={18} />
                          <span>검토 요청</span>
                          <ArrowRight size={18} />
                          <span>승인 · 게시</span>
                        </div>
                        <div className="notice">
                          <Workflow size={20} />
                          <span>
                            설정한 역할의 검토자가 승인하거나 반려합니다. 반려한
                            문서는 내용을 수정한 후 다시 검토를 요청할 수
                            있습니다.
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="workflow-disabled">
                        <CheckCircle2 size={34} />
                        <h3>자유롭게 기록하고 공유하세요</h3>
                        <p>현재 검토와 승인 과정이 생략되어 있습니다.</p>
                      </div>
                    )}
                  </>
                )}
                {tab === "storage" && (
                  <>
                    <div className="settings-section-title">
                      <HardDrive size={24} />
                      <div>
                        <h2>저장소 및 보존 정책</h2>
                        <p>첨부파일 경로와 휴지통 보존기간을 관리하세요.</p>
                      </div>
                    </div>
                    {input(
                      "storage_path",
                      "첨부파일 저장 경로",
                      "text",
                      "컨테이너의 영속 볼륨 경로를 사용하세요. 기존 파일을 자동 이동하지 않습니다.",
                    )}
                    <Field label="휴지통 보존기간 (일)">
                      <input
                        type="number"
                        min={1}
                        max={3650}
                        value={v("trash_retention_days", 30)}
                        onChange={(e) =>
                          set("trash_retention_days", Number(e.target.value))
                        }
                        required
                      />
                    </Field>
                    <div className="notice">
                      <HardDrive size={20} />
                      <span>
                        백업은 PostgreSQL, 첨부파일, 암호화된 설정을 함께
                        보관해야 합니다. ENCRYPTION_KEY는 별도로 안전하게
                        보관하세요.
                      </span>
                    </div>
                    <Link to="/admin/backup" className="button">
                      백업 관리로 이동
                      <ArrowRight size={17} />
                    </Link>
                  </>
                )}
                {tab === "mail" && (
                  <>
                    <div className="settings-section-title">
                      <Mail size={24} />
                      <div>
                        <h2>메일 알림 (SMTP 릴레이)</h2>
                        <p>
                          사람이 기다리는 일만 사내 릴레이로 보냅니다. 기본은
                          꺼짐이며, 포트 25·인증 없음·TLS 없음 릴레이가
                          기본값입니다.
                        </p>
                      </div>
                    </div>
                    <Toggle
                      checked={v("mail.enabled", false)}
                      onChange={(x) => set("mail.enabled", x)}
                      label="메일 알림 사용"
                      description="켜면 아래 이벤트가 생길 때 배경에서 메일을 보냅니다. 릴레이가 응답하지 않아도 사용자의 요청은 평소처럼 처리됩니다."
                    />
                    {input(
                      "mail.smtp_host",
                      "릴레이 주소 (mail.smtp_host)",
                      "text",
                      "예: relay.company.internal 또는 postra 주소. 포트는 아래에 따로 입력합니다.",
                    )}
                    <div className="form-grid">
                      {input(
                        "mail.smtp_port",
                        "포트 (mail.smtp_port)",
                        "number",
                      )}
                      <Field
                        label="보안 (mail.security)"
                        hint="auto는 서버가 STARTTLS를 알리면 사용하고, 아니면 평문으로 보냅니다."
                      >
                        <select
                          value={v("mail.security", "auto")}
                          onChange={(e) => set("mail.security", e.target.value)}
                        >
                          <option value="auto">auto (서버에 맞춤)</option>
                          <option value="none">none (평문)</option>
                          <option value="starttls">starttls</option>
                          <option value="tls">
                            tls (암묵적 TLS, 보통 465)
                          </option>
                        </select>
                      </Field>
                    </div>
                    <Toggle
                      checked={v("mail.skip_tls_verify", false)}
                      onChange={(x) => set("mail.skip_tls_verify", x)}
                      label="TLS 인증서 검증 생략 (mail.skip_tls_verify)"
                      description="사내 사설 인증서를 쓰는 릴레이에서만 켜세요."
                    />
                    <div className="form-grid">
                      {input(
                        "mail.username",
                        "사용자 이름 (mail.username)",
                        "text",
                        "인증 없는 릴레이는 비워 둡니다.",
                      )}
                      {input(
                        "mail.password",
                        "비밀번호 (mail.password)",
                        "password",
                        "저장 뒤에는 '설정됨'만 표시되고 되읽히지 않습니다.",
                      )}
                    </div>
                    <div className="form-grid">
                      {input(
                        "mail.from_address",
                        "보내는 주소 (mail.from_address)",
                        "text",
                        "비우면 madi@<릴레이 주소>를 씁니다.",
                      )}
                      {input(
                        "mail.from_name",
                        "보내는 이름 (mail.from_name)",
                        "text",
                        "비우면 서비스 이름을 씁니다.",
                      )}
                    </div>
                    {input(
                      "mail.base_url",
                      "메일 링크 주소 (mail.base_url)",
                      "text",
                      "메일 속 링크가 가리킬 이 서비스의 주소. 비우면 서비스 URL을 씁니다.",
                    )}
                    <Field label="제한 시간 (mail.timeout_seconds)">
                      <input
                        type="number"
                        min={1}
                        max={120}
                        value={v("mail.timeout_seconds", 10)}
                        onChange={(e) =>
                          set("mail.timeout_seconds", Number(e.target.value))
                        }
                      />
                    </Field>
                    <div className="settings-section-title">
                      <Send size={24} />
                      <div>
                        <h2>보낼 이벤트</h2>
                        <p>
                          자기가 한 일은 자기에게 보내지 않고, 한 사람에게 같은
                          종류가 여러 건 생기면 한 통으로 묶습니다.
                        </p>
                      </div>
                    </div>
                    {mailEventSwitches.map(([key, label, description]) => (
                      <Toggle
                        key={key}
                        checked={v(key, true)}
                        onChange={(x) => set(key, x)}
                        label={label}
                        description={description}
                      />
                    ))}
                    <div className="notice">
                      <Mail size={20} />
                      <span>
                        저장한 뒤 아래 시험 발송으로 릴레이 응답을 확인하세요.
                        기존 알림 채널(개인 선택형)과 별개로 동작합니다.
                      </span>
                    </div>
                  </>
                )}
              </section>
              <div className="settings-save">
                <span>
                  {Object.keys(changes).length
                    ? "저장하지 않은 변경사항이 있습니다."
                    : "변경사항은 저장 후 적용됩니다."}
                </span>
                <Button
                  variant="primary"
                  disabled={busy || !Object.keys(changes).length}
                >
                  <Save size={17} />
                  {busy ? "저장 중…" : "설정 저장"}
                </Button>
              </div>
            </form>
          )}
          {settings && tab === "mail" && (
            <MailDeliveryPanel settings={settings} />
          )}
        </div>
      </div>
    </>
  );
}

export function AdminAudit() {
  const [items, setItems] = useState<any[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<any>(null);
  const load = () =>
    api<any[]>("/admin/audit")
      .then(setItems)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const filtered = items.filter((a) =>
    [a.action, actionNames[a.action], a.user_name, a.resource, a.ip]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="TRANSPARENCY & TRUST"
        title="감사 로그"
        description="서비스의 주요 활동과 보안 이벤트를 확인하세요."
        actions={
          <Button onClick={load}>
            <RefreshCw size={17} /> 새로고침
          </Button>
        }
      />
      <div className="filter-bar">
        <div className="search-field">
          <Search size={19} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="활동, 사용자, 리소스, IP 검색…"
            aria-label="감사 로그 검색"
          />
        </div>
        <Badge>{filtered.length}개 이벤트</Badge>
      </div>
      <ErrorBox error={error} />
      <div className="panel table-scroll">
        <table className="data-table audit-table">
          <thead>
            <tr>
              <th>시간</th>
              <th>사용자</th>
              <th>활동</th>
              <th>리소스</th>
              <th>IP 주소</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id}>
                <td>{datetime(a.created_at)}</td>
                <td>{a.user_name || "시스템"}</td>
                <td>
                  <Badge>{actionNames[a.action] || a.action}</Badge>
                </td>
                <td>
                  <code>{a.resource || "—"}</code>
                </td>
                <td>
                  <code>{a.ip || "—"}</code>
                </td>
                <td>
                  <Button onClick={() => setSelected(a)}>상세</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <Empty
            title="감사 이벤트가 없습니다"
            text="주요 작업이 실행되면 이곳에 활동이 기록됩니다."
          />
        )}
      </div>
      <Modal
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
        title="감사 이벤트 상세"
        wide
      >
        {selected && (
          <>
            <div className="audit-detail">
              <strong>{actionNames[selected.action] || selected.action}</strong>
              <span>
                {datetime(selected.created_at)} ·{" "}
                {selected.user_name || "시스템"}
              </span>
            </div>
            <pre className="code-example">
              {JSON.stringify(selected.details || {}, null, 2)}
            </pre>
          </>
        )}
      </Modal>
    </>
  );
}

export function BackupPage() {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [restoreOpen, setRestoreOpen] = useState(false),
    [restoreBusy, setRestoreBusy] = useState(false),
    [restoreError, setRestoreError] = useState("");
  return (
    <>
      <PageHeading
        eyebrow="KEEP YOUR KNOWLEDGE SAFE"
        title="백업 및 복원"
        description="소중한 지식을 안전하게 보관하고 운영 연속성을 확보하세요."
      />
      <div className="two-columns">
        <section className="panel padded">
          <span className="feature-icon teal">
            <HardDrive size={29} />
          </span>
          <h2>서비스 백업 다운로드</h2>
          <p className="muted">
            문서, 계정, 데이터베이스, 첨부파일과 암호화된 설정의 논리 백업을
            ZIP으로 다운로드합니다.
          </p>
          <div className="backup-items">
            {["PostgreSQL 데이터", "첨부파일", "암호화된 서비스 설정"].map(
              (s) => (
                <span key={s}>
                  <CheckCircle2 size={18} />
                  {s}
                </span>
              ),
            )}
          </div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await download(
                  "/admin/backup",
                  `madi-backup-${new Date().toLocaleDateString("sv-SE")}.zip`,
                );
                notify("백업을 다운로드했습니다.");
              } catch (e) {
                notify((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <ArrowDownToLine size={18} />
            {busy ? "백업 생성 중…" : "백업 다운로드"}
          </Button>
          <div className="notice">
            <KeyRound size={20} />
            <span>
              ENCRYPTION_KEY는 백업에 포함되지 않습니다. 비밀 값 복원에
              필요하므로 별도 보관하세요.
            </span>
          </div>
        </section>
        <section className="panel padded">
          <span className="feature-icon lavender">
            <History size={29} />
          </span>
          <h2>복원 절차</h2>
          <p className="muted">
            배포 패키지의 운영 가이드에 따라 격리된 환경에서 복원을 검증하세요.
          </p>
          <ol className="restore-steps">
            <li>
              <span>1</span>
              <div>
                <strong>현재 서비스를 백업하고 중지</strong>
                <p>데이터 변경을 멈추고 최신 백업을 확보합니다.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>데이터와 첨부파일 복원</strong>
                <p>동일 버전의 madi와 별도 PostgreSQL에 복원합니다.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>암호화 키와 접속 설정 적용</strong>
                <p>기존 ENCRYPTION_KEY와 복원한 DB 연결 정보를 사용합니다.</p>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>서비스 상태 검증 후 전환</strong>
                <p>로그인, 문서, 첨부파일과 AI / SSO 연결을 확인합니다.</p>
              </div>
            </li>
          </ol>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (restoreFile && confirmation === "RESTORE")
                setRestoreOpen(true);
            }}
          >
            <Field label="복원할 madi 백업 ZIP">
              <input
                type="file"
                accept=".zip"
                required
                onChange={(e) => {
                  setRestoreFile(e.target.files?.[0] || null);
                  setRestoreError("");
                }}
              />
            </Field>
            <Field
              label="확인 문구"
              hint="현재 서비스 데이터를 대체하는 작업입니다. RESTORE를 정확히 입력하세요."
            >
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="RESTORE"
                autoComplete="off"
                required
                pattern="RESTORE"
              />
            </Field>
            <Button
              variant="danger"
              disabled={
                !restoreFile || confirmation !== "RESTORE" || restoreBusy
              }
            >
              백업 복원 검토
            </Button>
          </form>
          <ErrorBox error={restoreError} />
        </section>
      </div>
      <Modal
        open={restoreOpen}
        onOpenChange={(v) => {
          if (!restoreBusy) setRestoreOpen(v);
        }}
        title="서비스 데이터를 복원할까요?"
        description="현재 데이터베이스 내용과 첨부파일 연결을 백업 내용으로 대체하고 모든 로그인 세션을 만료시킵니다."
      >
        <div className="notice error">
          <HardDrive size={20} />
          <span>
            <strong>{restoreFile?.name}</strong>
            <br />
            백업과 동일한 서비스 버전 및 ENCRYPTION_KEY가 필요합니다. 복원 전
            현재 데이터를 별도로 백업했는지 확인하세요.
          </span>
        </div>
        <ErrorBox error={restoreError} />
        <div className="modal-actions">
          <Button disabled={restoreBusy} onClick={() => setRestoreOpen(false)}>
            취소
          </Button>
          <Button
            variant="danger"
            disabled={restoreBusy}
            onClick={async () => {
              if (!restoreFile) return;
              setRestoreBusy(true);
              setRestoreError("");
              const data = new FormData();
              data.append("file", restoreFile);
              data.append("confirmation", confirmation);
              try {
                const result = await api("/admin/restore", "POST", data);
                setRestoreOpen(false);
                notify(
                  result.message ||
                    "복원을 완료했습니다. 다시 로그인해 주세요.",
                );
                window.location.assign(
                  result.relogin_required ? "/login" : "/admin/backup",
                );
              } catch (e) {
                setRestoreError((e as Error).message);
              } finally {
                setRestoreBusy(false);
              }
            }}
          >
            {restoreBusy ? "복원 중…" : "확인, 서비스 데이터 복원"}
          </Button>
        </div>
      </Modal>
      <div className="notice subtle">
        <ShieldCheck size={20} />
        <span>
          정기 운영 백업은 배포 디렉터리의 백업 스크립트와 스케줄러를 이용해
          PostgreSQL과 영속 볼륨을 함께 보관하세요.
        </span>
      </div>
    </>
  );
}
