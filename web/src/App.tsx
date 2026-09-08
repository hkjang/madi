import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Command,
  Database,
  FileText,
  FolderOpen,
  Home,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Users,
  X,
  Bell,
  PanelLeftClose,
  Import,
  Download,
  CalendarDays,
  History,
  HardDrive,
  Inbox,
} from "lucide-react";
import {
  api,
  ApiError,
  setDateTimezone,
  type Doc,
  type DocSummary,
  type User,
  type Workspace,
} from "./api";
import { AppContext, useApp } from "./context";
import { Badge, Button, ErrorBox, Field, Loading, Modal } from "./ui";
import { HomePage, DocumentList, MembersPage } from "./pages";
const DocumentPage = React.lazy(() => import("./DocumentPage"));
const DatabasesPage = React.lazy(() => import("./DatabasesPage"));
const CanvasPage = React.lazy(() => import("./CanvasPage"));
const PluginsPage = React.lazy(() => import("./PluginsPage"));
const TeamsPage = React.lazy(() => import("./TeamsPage"));
const InboxPage = React.lazy(() => import("./InboxPage"));
const TasksPage = React.lazy(() => import("./TaskPage"));
const SearchPage = React.lazy(() => import("./SearchPage"));
const GraphPage = React.lazy(() => import("./GraphPage"));
const GraphAIPage = React.lazy(() =>
  import("./graph-ai/GraphAIPage").then((m) => ({ default: m.GraphAIPage })),
);
const TemplatesPage = React.lazy(() => import("./templates/TemplatesPage"));
const AIHistoryPage = React.lazy(() => import("./AIHistory"));
const GitSyncPage = React.lazy(() =>
  import("./git/GitSyncPages").then((module) => ({
    default: module.GitSyncPage,
  })),
);
const GitSyncPolicyPage = React.lazy(() =>
  import("./git/GitSyncPages").then((module) => ({
    default: module.GitSyncPolicyPage,
  })),
);
const AgentsPage = React.lazy(() =>
  import("./agents/AgentPages").then((module) => ({
    default: module.AgentsPage,
  })),
);
const AgentRunPage = React.lazy(() =>
  import("./agents/AgentPages").then((module) => ({
    default: module.AgentRunPage,
  })),
);
const ProtectionPage = React.lazy(() => import("./security/ProtectionPage"));
const PublicSharePage = React.lazy(() => import("./security/PublicSharePage"));
const RAGSettingsPage = React.lazy(() =>
  import("./RAGSettingsPage").then((m) => ({ default: m.RAGSettingsPage })),
);
const RunbookAdminPage = React.lazy(() =>
  import("./runbook/RunbookPages").then((m) => ({
    default: m.RunbookAdminPage,
  })),
);
const RunbookDocumentPage = React.lazy(() =>
  import("./runbook/RunbookPages").then((m) => ({
    default: m.RunbookDocumentPage,
  })),
);
const RunbookExecutionPage = React.lazy(() =>
  import("./runbook/RunbookPages").then((m) => ({
    default: m.RunbookExecutionPage,
  })),
);
const EnterprisePage = React.lazy(() =>
  import("./EnterprisePages").then((m) => ({ default: m.EnterprisePage })),
);
const EntityListPage = React.lazy(() =>
  import("./EnterprisePages").then((m) => ({ default: m.EntityListPage })),
);
const EntityPage = React.lazy(() =>
  import("./EnterprisePages").then((m) => ({ default: m.EntityPage })),
);
const IdentityPage = React.lazy(() => import("./IdentityPage"));
const ExportPage = React.lazy(() =>
  import("./TransferPages").then((m) => ({ default: m.ExportPage })),
);
const ExportPolicyPage = React.lazy(() =>
  import("./TransferPages").then((m) => ({ default: m.ExportPolicyPage })),
);
const SearchHistoryPage = React.lazy(() => import("./SearchHistoryPage"));
const WorkspaceAuditPage = React.lazy(
  () => import("./audit/WorkspaceAuditPage"),
);
const OperationsPage = React.lazy(() => import("./operations/OperationsPage"));
const SupportPage = React.lazy(() =>
  import("./support/SupportPage").then((m) => ({ default: m.SupportPage })),
);
const NotificationChannelsPage = React.lazy(() =>
  import("./NotificationDeliveryPages").then((m) => ({
    default: m.NotificationChannelsPage,
  })),
);
const NotificationPreferencesPage = React.lazy(() =>
  import("./NotificationDeliveryPages").then((m) => ({
    default: m.NotificationPreferencesPage,
  })),
);
const InboundCapturePolicyPage = React.lazy(() =>
  import("./InboundCapturePages").then((m) => ({
    default: m.InboundCapturePolicyPage,
  })),
);
const InboundCapturePage = React.lazy(() =>
  import("./InboundCapturePages").then((m) => ({
    default: m.InboundCapturePage,
  })),
);
const ApprovalPolicyPage = React.lazy(() =>
  import("./approval/ApprovalPages").then((m) => ({
    default: m.ApprovalPolicyPage,
  })),
);
const ApprovalInboxPage = React.lazy(() =>
  import("./approval/ApprovalPages").then((m) => ({
    default: m.ApprovalInboxPage,
  })),
);
const SQLSourcePage = React.lazy(() =>
  import("./SQLSourcePages").then((m) => ({ default: m.SQLSourcePage })),
);
const ConnectorPage = React.lazy(() =>
  import("./ConnectorPages").then((m) => ({ default: m.ConnectorPage })),
);
const ConnectorPolicyPage = React.lazy(() =>
  import("./ConnectorPages").then((m) => ({ default: m.ConnectorPolicyPage })),
);
import IdentityLogin from "./IdentityLogin";
import PWAControls from "./pwa/PWAControls";
import { applyPersonalization } from "./personalization/apply";
import { lockOfflineVault } from "./pwa/vault";
const DevicesPage = React.lazy(() => import("./pwa/DevicesPage"));
import { ProfilePage, KeysPage } from "./PersonalPages";
import { StoragePage, BackupSchedulePage } from "./StoragePages";
import { KnowledgeHealthPage, DocumentKnowledgePage } from "./KnowledgePages";
import { MigrationPage } from "./MigrationPages";
import {
  AdminDashboard,
  AdminUsers,
  AdminSettings,
  AdminAudit,
  BackupPage,
} from "./AdminPages";
const AI = React.lazy(() => import("./AI"));
import DocumentTree from "./DocumentTree";
import CommandPalette from "./navigation/CommandPalette";
import { useSidebarState, SidebarResize } from "./navigation/preferences";
import { useAppShortcuts } from "./navigation/shortcuts";
import {
  SpacesPage,
  WorkspaceSettingsPage,
  OrganizationsPage,
} from "./SpacesPages";
import {
  AutomationPage,
  WebhooksPage,
  JobsPage,
  JobsSettingsPage,
} from "./AutomationPages";

function Login({
  info,
  onLogin,
}: {
  info: Record<string, any>;
  onLogin: (u: User) => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const location = useLocation();
  return (
    <div className="login-page">
      <div className="login-story">
        <Link to="/login" className="brand large">
          <img src="/favicon.svg" alt="" />
          madi<span>지식이 연결되는 곳</span>
        </Link>
        <div className="login-copy">
          <div className="eyebrow">
            <span className="status-dot" /> YOUR TEAM'S KNOWLEDGE, CONNECTED
          </div>
          <h1>
            생각을 기록하고,
            <br />
            지식을 연결하세요.
          </h1>
          <p>
            흩어진 문서가 팀의 자산이 되는 곳.
            <br />
            사람과 아이디어, AI가 함께하는 지식 워크스페이스.
          </p>
          <div className="login-graph" aria-hidden="true">
            <div className="graph-line l1" />
            <div className="graph-line l2" />
            <div className="graph-line l3" />
            <div className="idea-card c1">
              <BookOpen />
              <span>우리 팀의 위키</span>
              <small>함께 쌓아가는 지식</small>
            </div>
            <div className="idea-card c2">
              <Network />
              <span>연결되는 아이디어</span>
              <small>문서에서 새로운 발견으로</small>
            </div>
            <div className="idea-card c3">
              <Sparkles />
              <span>AI와 함께하는 작업</span>
              <small>지식의 다음 가능성</small>
            </div>
            <div className="graph-core">
              <img src="/favicon.svg" alt="" />
            </div>
          </div>
        </div>
        <footer>
          <ShieldCheck size={17} /> 우리 조직의 지식은, 우리 조직 안에.
        </footer>
      </div>
      <div className="login-form-wrap">
        <div className="login-form">
          <span className="eyebrow">WELCOME TO MADI</span>
          <h2>다시 만나 반가워요</h2>
          <p className="muted">계정에 로그인하고 생각을 이어가세요.</p>
          <ErrorBox
            error={error || new URLSearchParams(location.search).get("error")}
          />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                onLogin(
                  await api<User>("/auth/login", "POST", { email, password }),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="이메일">
              <input
                type="text"
                name="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                autoFocus
              />
            </Field>
            <Field label="비밀번호">
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호를 입력하세요"
                required
              />
            </Field>
            <Button variant="primary full" disabled={busy}>
              {busy ? "로그인 중…" : "로그인"}
              <ArrowRight size={18} />
            </Button>
          </form>
          {info.oidc_enabled && (
            <>
              <div className="divider-label">또는</div>
              <a className="button full" href="/api/v1/auth/oidc/start">
                <ShieldCheck size={18} /> 회사 계정으로 로그인
              </a>
            </>
          )}
          <IdentityLogin info={info} onLogin={onLogin} />
          <p className="login-help">
            계정 문의는 조직의 madi 관리자에게 요청하세요.
          </p>
          <div className="login-version">
            <img src="/favicon.svg" alt="" />
            <span>
              {info.name || "madi"}{" "}
              <b>v{String(info.version || "0.1.0").replace(/^v/, "")}</b>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const app = useApp();
  const {
    user,
    workspace,
    workspaces,
    documents,
    setWorkspace,
    createDocument,
    publicInfo,
    notify,
  } = app;
  const location = useLocation(),
    navigate = useNavigate();
  const admin = location.pathname.startsWith("/admin");
  const [presentation, setPresentation] = useState<Record<string, any>>({});
  useEffect(() => {
    let active = true;
    if (admin || !workspace) {
      setPresentation({});
      return;
    }
    let pending = false;
    const refreshPresentation = () => {
      if (pending) return;
      pending = true;
      void api(`/workspaces/${workspace.id}/presentation`)
        .then((value) => {
          if (active) setPresentation(value);
        })
        .catch(() => {
          if (active) setPresentation({});
        })
        .finally(() => {
          pending = false;
        });
    };
    refreshPresentation();
    const timer = window.setInterval(refreshPresentation, 10000);
    window.addEventListener("madi:presentation-refresh", refreshPresentation);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener(
        "madi:presentation-refresh",
        refreshPresentation,
      );
    };
  }, [admin, workspace?.id, location.pathname, user.id]);
  useEffect(() => {
    const root = document.documentElement;
    if (presentation.theme_primary)
      root.style.setProperty("--primary", presentation.theme_primary);
    else root.style.removeProperty("--primary");
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) favicon.href = presentation.favicon_url || "/favicon.svg";
    return () => {
      root.style.removeProperty("--primary");
      if (favicon) favicon.href = "/favicon.svg";
    };
  }, [presentation]);
  const [mobile, setMobile] = useState(false),
    [command, setCommand] = useState(false),
    [ai, setAI] = useState(false),
    [newDoc, setNewDoc] = useState(false),
    [title, setTitle] = useState(""),
    [newWorkspace, setNewWorkspace] = useState(false),
    [wsName, setWsName] = useState(""),
    [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useSidebarState();
  useEffect(() => {
    setMobile(false);
    if (
      location.pathname.startsWith("/app") ||
      location.pathname.startsWith("/admin")
    ) {
      localStorage.setItem(
        "madi.last_path",
        location.pathname + location.search,
      );
      const t = setTimeout(
        () =>
          api("/profile", "PUT", {
            expected_user_id: user.id,
            preferences: {
              last_path: location.pathname + location.search,
            },
          }).catch(() => {}),
        1200,
      );
      return () => clearTimeout(t);
    }
  }, [location.pathname, location.search, user.id]);
  useAppShortcuts({
    palette: () => setCommand((v) => !v),
    quickOpen: () => setCommand(true),
    search: () => navigate("/app/search"),
    create: () => setNewDoc(true),
    ai: () => setAI(true),
  });
  const routes = admin
    ? [
        ["/admin", "운영 대시보드", LayoutDashboard],
        ["/admin/users", "사용자 관리", Users],
        ["/admin/settings", "서비스 설정", Settings],
        ["/admin/search-ai", "AI 검색 설정", Search],
        ["/admin/git-sync", "Git 동기화 정책", History],
        ["/admin/operations", "서비스 운영", Settings],
        ["/admin/support", "읽기 전용 지원 진단", ShieldCheck],
        ["/admin/information-protection", "정보보호 정책", ShieldCheck],
        ["/admin/audit", "감사 로그", History],
        ["/admin/backup", "백업 및 복원", HardDrive],
        ["/admin/storage", "파일 저장소", HardDrive],
        ["/admin/backup-schedule", "예약 백업", CalendarDays],
        ["/admin/jobs", "작업 처리 설정", CheckCircle2],
        ["/admin/migration", "데이터 이관", Import],
        ["/admin/exports", "내보내기 정책", Import],
        ["/admin/plugins", "플러그인 관리", Boxes],
        ["/admin/identity", "기업 계정 연동", ShieldCheck],
        ["/admin/approvals", "검토·승인 정책", CheckCircle2],
        ["/admin/notification-channels", "외부 알림 채널", Bell],
        ["/admin/inbound-capture", "메일·웹훅 수집 정책", Inbox],
        ["/admin/runbook", "격리 실행 런북", ShieldCheck],
        ["/admin/connectors", "커넥터 연결 정책", Network],
      ]
    : [
        ["/app", "홈", Home],
        ["/app/search", "검색", Search],
        ["/app/ai-history", "내 AI 대화", History],
        ["/app/search-history", "내 검색 기록", History],
        ["/app/agents", "워크스페이스 Agent", Sparkles],
        ["/app/git-sync", "Git 동기화", History],
        ["/app/documents", "모든 문서", FileText],
        ["/app/favorites", "즐겨찾기", Star],
        ["/app/graph", "지식 그래프", Network],
        ["/app/graph-ai", "AI 그래프 제안", Sparkles],
        ["/app/databases", "데이터베이스", Database],
        ["/app/tasks", "할 일과 일정", CheckCircle2],
        ["/app/spaces", "공간", FolderOpen],
        ["/app/canvases", "캔버스", Boxes],
        ["/app/knowledge-health", "지식 품질 관리", ShieldCheck],
      ];
  const currentLabel =
    routes.find(
      (r) =>
        r[0] === location.pathname ||
        (!["/app", "/admin"].includes(String(r[0])) &&
          location.pathname.startsWith(String(r[0]) + "/")),
    )?.[1] ||
    (location.pathname.includes("/documents/")
      ? "문서"
      : location.pathname.includes("/keys")
        ? "API 키"
        : location.pathname.includes("/profile")
          ? "개인 설정"
          : location.pathname.includes("/templates")
            ? "템플릿"
            : location.pathname.includes("/trash")
              ? "휴지통"
              : location.pathname.includes("/import")
                ? "가져오기 / 내보내기"
                : location.pathname.includes("/members")
                  ? "멤버 관리"
                  : "워크스페이스");
  return (
    <div
      className={`app-layout ${mobile ? "mobile-open" : ""} ${collapsed ? "sidebar-collapsed" : ""}`}
      style={
        {
          "--sidebar-width": `${user.preferences?.sidebar_width || 268}px`,
        } as React.CSSProperties
      }
    >
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="메뉴 닫기"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className="sidebar">
        <SidebarResize />
        <Link to="/app" className="brand">
          <img src={presentation.logo_url || "/favicon.svg"} alt="" />
          <span>{presentation.site_name || publicInfo.name || "madi"}</span>
          <small>{admin ? "ADMIN" : "WORKSPACE"}</small>
        </Link>
        {admin ? (
          <div className="workspace-switch admin-label">
            <ShieldCheck size={22} />
            <div>
              <strong>서비스 관리</strong>
              <small>조직의 지식을 안전하게</small>
            </div>
          </div>
        ) : (
          <div className="workspace-switch">
            <span className="workspace-avatar">
              {workspace?.name?.slice(0, 1) || "M"}
            </span>
            <div>
              <label className="sr-only" htmlFor="workspace">
                워크스페이스 선택
              </label>
              <select
                id="workspace"
                value={workspace?.id || ""}
                onChange={(e) => {
                  setWorkspace(e.target.value);
                  navigate("/app");
                }}
              >
                {workspaces.length ? (
                  workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))
                ) : (
                  <option value="">워크스페이스 선택</option>
                )}
              </select>
              <small>함께 연결하는 지식 공간</small>
            </div>
            <button
              className="icon-button"
              title="워크스페이스 만들기"
              aria-label="워크스페이스 만들기"
              onClick={() => setNewWorkspace(true)}
            >
              <Plus size={17} />
            </button>
          </div>
        )}
        <div className="sidebar-scroll">
          <div className="sidebar-section-label">
            {admin ? "관리 콘솔" : "워크스페이스"}
          </div>
          <nav>
            {routes
              .filter(([path]) => {
                const feature = (
                  {
                    "/app/canvases": "canvas",
                    "/app/agents": "workspace-agents",
                    "/app/graph-ai": "ai-graph",
                  } as Record<string, string>
                )[String(path)];
                return (
                  !feature || presentation.feature_flags?.[feature] !== false
                );
              })
              .map(([path, label, Icon]) => (
                <NavLink
                  end={path === "/app" || path === "/admin"}
                  key={String(path)}
                  to={String(path)}
                >
                  {typeof Icon !== "string" && <Icon size={19} />}
                  <span>{String(label)}</span>
                  {path === "/app/search" && <kbd>⌘ K</kbd>}
                </NavLink>
              ))}
          </nav>
          {!admin && (
            <>
              <div className="sidebar-section-label section-spaced">
                <span>내 문서</span>
                <button
                  className="icon-button"
                  aria-label="새 문서"
                  onClick={() => setNewDoc(true)}
                >
                  <Plus size={16} />
                </button>
              </div>
              <DocumentTree />
              <div className="sidebar-section-label section-spaced">도구</div>
              <nav>
                <NavLink to="/app/inbox">
                  <Inbox size={18} />내 수집함
                </NavLink>
                {publicInfo.approval_enabled && (
                  <NavLink to="/app/approvals">
                    <CheckCircle2 size={18} />
                    검토·승인함
                  </NavLink>
                )}
                <NavLink to="/app/templates">
                  <Boxes size={18} />
                  템플릿
                </NavLink>
                <NavLink to="/app/import">
                  <Import size={18} />
                  데이터 가져오기
                </NavLink>
                <NavLink to="/app/export">
                  <Import size={18} />
                  데이터 내보내기
                </NavLink>
                <NavLink to="/app/migrations">
                  <Import size={18} />
                  데이터 이관 센터
                </NavLink>
                {presentation.feature_flags?.plugins !== false && (
                  <NavLink to="/app/plugins">
                    <Boxes size={18} />
                    플러그인
                  </NavLink>
                )}
                <NavLink to="/app/connectors">
                  <Network size={18} />
                  외부 지식 커넥터
                </NavLink>
                <NavLink to="/app/data-sources">
                  <Database size={18} />
                  외부 데이터 소스
                </NavLink>
                <NavLink to="/app/members">
                  <Users size={18} />
                  워크스페이스 멤버
                </NavLink>
                <NavLink to="/app/teams">
                  <Users size={18} />
                  팀과 멘션 그룹
                </NavLink>
                <NavLink to="/app/enterprise">
                  <Network size={18} />
                  기업 지식 탐색
                </NavLink>
                <NavLink to="/app/entities">
                  <Boxes size={18} />
                  엔터티 사전
                </NavLink>
                <NavLink to="/app/organizations">
                  <Users size={18} />
                  조직
                </NavLink>
                <NavLink to="/app/automations">
                  <Boxes size={18} />
                  자동화
                </NavLink>
                <NavLink to="/app/jobs">
                  <CheckCircle2 size={18} />
                  작업 이력
                </NavLink>
                {workspace &&
                  ["owner", "admin"].includes(workspace.role) &&
                  user.role !== "viewer" && (
                    <NavLink to="/app/webhooks">
                      <Network size={18} />
                      Webhook
                    </NavLink>
                  )}
                {workspace &&
                  ["owner", "admin"].includes(workspace.role) &&
                  user.role !== "viewer" && (
                    <NavLink to="/app/workspace-settings">
                      <Settings size={18} />
                      워크스페이스 설정
                    </NavLink>
                  )}
                {workspace &&
                  ["owner", "admin"].includes(workspace.role) &&
                  user.role !== "viewer" && (
                    <NavLink to="/app/workspace-audit">
                      <History size={18} />
                      워크스페이스 감사
                    </NavLink>
                  )}
                {workspace &&
                  ["owner", "admin"].includes(workspace.role) &&
                  user.role !== "viewer" && (
                    <NavLink to="/app/workspace-operations">
                      <Settings size={18} />팀 운영 설정
                    </NavLink>
                  )}
                {workspace &&
                  ["owner", "admin"].includes(workspace.role) &&
                  user.role !== "viewer" && (
                    <NavLink to="/app/search-ai-settings">
                      <Search size={18} />
                      AI 검색 설정
                    </NavLink>
                  )}
                {workspace &&
                  ["owner", "admin"].includes(workspace.role) &&
                  user.role !== "viewer" && (
                    <NavLink to="/app/storage">
                      <HardDrive size={18} />
                      저장소 설정
                    </NavLink>
                  )}
                <NavLink to="/app/trash">
                  <Trash2 size={18} />
                  휴지통
                </NavLink>
              </nav>
            </>
          )}
        </div>
        <div className="sidebar-bottom">
          {!admin && (
            <button className="ai-launch" onClick={() => setAI(true)}>
              <Sparkles size={20} />
              <span>
                지식에 AI를 더하세요
                <small>문서 요약부터 새로운 아이디어까지</small>
              </span>
              <ChevronRight size={16} />
            </button>
          )}
          {user.role === "admin" && (
            <Link className="admin-link" to={admin ? "/app" : "/admin"}>
              {admin ? <Home size={17} /> : <ShieldCheck size={17} />}{" "}
              {admin ? "워크스페이스로 돌아가기" : "서비스 관리자"}
              <ArrowRight size={16} />
            </Link>
          )}
          <Dropdown.Root>
            <Dropdown.Trigger className="profile-trigger">
              <span className="avatar">{user.name?.slice(0, 1) || "M"}</span>
              <span>
                <strong>{user.name || user.email}</strong>
                <small>{user.email}</small>
              </span>
              <ChevronDown size={16} />
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content
                className="dropdown"
                side="top"
                align="start"
                sideOffset={8}
              >
                <div className="dropdown-user">
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                </div>
                <Dropdown.Item onSelect={() => navigate("/app/profile")}>
                  <Settings size={17} /> 개인 설정
                </Dropdown.Item>
                <Dropdown.Item onSelect={() => navigate("/app/keys")}>
                  <KeyRound size={17} /> 내 API 키
                </Dropdown.Item>
                <Dropdown.Item
                  onSelect={() => navigate("/app/notification-settings")}
                >
                  <Bell size={17} /> 알림 수신 설정
                </Dropdown.Item>
                <Dropdown.Item onSelect={() => navigate("/app/devices")}>
                  <HardDrive size={17} />
                  기기·오프라인 보관함
                </Dropdown.Item>
                <Dropdown.Item
                  onSelect={() => navigate("/app/capture-channels")}
                >
                  <Inbox size={17} /> 메일·웹훅 수집 연결
                </Dropdown.Item>
                <Dropdown.Separator />
                <div className="menu-version">
                  madi{" "}
                  <Badge>
                    v{String(publicInfo.version || "0.1.0").replace(/^v/, "")}
                  </Badge>
                  <Dropdown.Item asChild>
                    <a href="/licenses.txt" target="_blank" rel="noopener noreferrer"
                      style={{ marginLeft: "auto", fontSize: "13px", padding: "4px" }}>
                      오픈소스 고지
                    </a>
                  </Dropdown.Item>
                </div>
                <Dropdown.Separator />
                <Dropdown.Item
                  onSelect={async () => {
                    try {
                      lockOfflineVault();
                      await api("/auth/logout", "POST");
                      window.location.assign("/login");
                    } catch (e) {
                      notify((e as Error).message, "error");
                    }
                  }}
                >
                  <LogOut size={17} /> 로그아웃
                </Dropdown.Item>
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-toggle"
              aria-label="메뉴 열기"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <button
              className="icon-button desktop-toggle"
              aria-label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
              onClick={() => setCollapsed(!collapsed)}
            >
              <PanelLeftClose size={19} />
            </button>
            <span>
              {admin ? "서비스 관리" : workspace?.name || "워크스페이스"}
            </span>
            <ChevronRight size={14} />
            <strong>{String(currentLabel)}</strong>
          </div>
          <div className="topbar-actions">
            <button className="top-search" onClick={() => setCommand(true)}>
              <Search size={16} />
              <span>무엇을 찾고 있나요?</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button"
              title="AI 도우미"
              aria-label="AI 도우미"
              onClick={() => setAI(true)}
            >
              <Sparkles size={20} />
            </button>
            <span className="top-avatar">{user.name?.slice(0, 1)}</span>
          </div>
        </header>
        <div className="page-content">
          <React.Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/app" element={<HomePage />} />
              <Route path="/app/documents" element={<DocumentList />} />
              <Route
                path="/app/documents/:id/runbook"
                element={<RunbookDocumentPage key={location.pathname} />}
              />
              <Route
                path="/app/runbook/executions/:id"
                element={<RunbookExecutionPage key={location.pathname} />}
              />
              <Route
                path="/admin/runbook"
                element={
                  user.role === "admin" ? (
                    <RunbookAdminPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route path="/app/search" element={<SearchPage />} />
              <Route
                path="/app/search-history"
                element={<SearchHistoryPage />}
              />
              <Route path="/app/ai-history" element={<AIHistoryPage />} />
              <Route path="/app/git-sync" element={<GitSyncPage />} />
              <Route path="/admin/git-sync" element={<GitSyncPolicyPage />} />
              <Route
                path="/admin/operations"
                element={
                  user.role === "admin" ? (
                    <OperationsPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/admin/support"
                element={
                  user.role === "admin" ? (
                    <SupportPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/app/workspace-operations"
                element={<OperationsPage workspaceMode key={workspace?.id} />}
              />
              <Route path="/app/agents" element={<AgentsPage />} />
              <Route path="/app/agents/runs/:id" element={<AgentRunPage />} />
              <Route
                path="/admin/information-protection"
                element={
                  user.role === "admin" ? (
                    <ProtectionPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/app/search-ai-settings"
                element={<RAGSettingsPage key={workspace?.id} workspaceMode />}
              />
              <Route
                path="/admin/search-ai"
                element={
                  user.role === "admin" ? (
                    <RAGSettingsPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/app/favorites"
                element={<DocumentList mode="favorites" />}
              />
              <Route
                path="/app/trash"
                element={<DocumentList mode="trash" />}
              />
              <Route
                path="/app/documents/:id"
                element={<DocumentPage onAI={() => setAI(true)} />}
              />
              <Route path="/app/graph" element={<GraphPage />} />
              <Route path="/app/graph-ai" element={<GraphAIPage />} />
              <Route
                path="/app/knowledge-health"
                element={<KnowledgeHealthPage key={workspace?.id} />}
              />
              <Route
                path="/app/documents/:id/knowledge"
                element={<DocumentKnowledgePage key={location.pathname} />}
              />
              <Route
                path="/app/tasks"
                element={<TasksPage key={workspace?.id} />}
              />
              <Route
                path="/app/approvals"
                element={<ApprovalInboxPage key={workspace?.id} />}
              />
              <Route
                path="/admin/approvals"
                element={
                  user.role === "admin" ? (
                    <ApprovalPolicyPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/app/enterprise"
                element={<EnterprisePage key={workspace?.id} />}
              />
              <Route
                path="/app/entities"
                element={<EntityListPage key={workspace?.id} />}
              />
              <Route
                path="/app/entities/:id"
                element={<EntityPage key={location.pathname} />}
              />
              <Route
                path="/app/inbox"
                element={<InboxPage key={workspace?.id} />}
              />
              <Route path="/app/templates" element={<TemplatesPage />} />
              <Route
                path="/app/notification-settings"
                element={<NotificationPreferencesPage />}
              />
              <Route
                path="/admin/notification-channels"
                element={
                  user.role === "admin" ? (
                    <NotificationChannelsPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route path="/app/databases/*" element={<DatabasesPage />} />
              <Route
                path="/app/capture-channels"
                element={<InboundCapturePage />}
              />
              <Route
                path="/admin/inbound-capture"
                element={
                  user.role === "admin" ? (
                    <InboundCapturePolicyPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/app/canvases/*"
                element={<CanvasPage key={workspace?.id} />}
              />
              <Route
                path="/app/import"
                element={<MigrationPage key={workspace?.id} />}
              />
              <Route
                path="/app/export"
                element={<ExportPage key={workspace?.id} />}
              />
              <Route
                path="/admin/exports"
                element={
                  user.role === "admin" ? (
                    <ExportPolicyPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/app/data-sources"
                element={<SQLSourcePage key={workspace?.id} />}
              />
              <Route
                path="/app/connectors"
                element={<ConnectorPage key={workspace?.id} />}
              />
              <Route
                path="/admin/connectors"
                element={
                  user.role === "admin" ? (
                    <ConnectorPolicyPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/admin/identity"
                element={
                  user.role === "admin" ? (
                    <IdentityPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/app/plugins/*"
                element={<PluginsPage key={workspace?.id} />}
              />
              <Route
                path="/admin/plugins"
                element={
                  user.role === "admin" ? (
                    <PluginsPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/app/migrations"
                element={<MigrationPage key={workspace?.id} />}
              />
              <Route
                path="/admin/migration"
                element={
                  user.role === "admin" ? (
                    <MigrationPage key={workspace?.id} />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route path="/app/members" element={<MembersPage />} />
              <Route
                path="/app/teams"
                element={<TeamsPage key={workspace?.id} />}
              />
              <Route
                path="/app/spaces"
                element={<SpacesPage key={workspace?.id} />}
              />
              <Route
                path="/app/organizations"
                element={<OrganizationsPage />}
              />
              <Route
                path="/app/workspace-settings"
                element={<WorkspaceSettingsPage key={workspace?.id} />}
              />
              <Route
                path="/app/workspace-audit"
                element={<WorkspaceAuditPage key={workspace?.id} />}
              />
              <Route path="/app/automations" element={<AutomationPage />} />
              <Route path="/app/webhooks" element={<WebhooksPage />} />
              <Route path="/app/jobs" element={<JobsPage />} />
              <Route
                path="/app/storage"
                element={<StoragePage key={workspace?.id} />}
              />
              <Route
                path="/admin/storage"
                element={
                  user.role === "admin" ? (
                    <StoragePage admin />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/admin/backup-schedule"
                element={
                  user.role === "admin" ? (
                    <BackupSchedulePage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/admin/jobs"
                element={
                  user.role === "admin" ? (
                    <JobsSettingsPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route path="/app/profile" element={<ProfilePage />} />
              <Route path="/app/devices" element={<DevicesPage />} />
              <Route path="/app/keys" element={<KeysPage />} />
              <Route
                path="/admin"
                element={
                  user.role === "admin" ? (
                    <AdminDashboard />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/admin/users"
                element={
                  user.role === "admin" ? (
                    <AdminUsers />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/admin/settings"
                element={
                  user.role === "admin" ? (
                    <AdminSettings />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/admin/audit"
                element={
                  user.role === "admin" ? (
                    <AdminAudit />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route
                path="/admin/backup"
                element={
                  user.role === "admin" ? (
                    <BackupPage />
                  ) : (
                    <Navigate to="/app" />
                  )
                }
              />
              <Route path="*" element={<Navigate to="/app" replace />} />
            </Routes>
          </React.Suspense>
        </div>
      </main>
      <Modal open={newDoc} onOpenChange={setNewDoc} title="새 문서 만들기">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const doc = await createDocument(title);
            setBusy(false);
            if (doc) {
              setTitle("");
              setNewDoc(false);
              navigate(`/app/documents/${doc.id}`);
            }
          }}
        >
          <Field label="문서 제목">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="어떤 생각을 기록할까요?"
              required
              autoFocus
            />
          </Field>
          <div className="modal-actions">
            <Button type="button" onClick={() => setNewDoc(false)}>
              취소
            </Button>
            <Button variant="primary" disabled={busy}>
              문서 만들기
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={newWorkspace}
        onOpenChange={setNewWorkspace}
        title="워크스페이스 만들기"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const w = await api<Workspace>("/workspaces", "POST", {
                name: wsName,
              });
              await app.reload();
              setWorkspace(w.id);
              setNewWorkspace(false);
              setWsName("");
              navigate("/app");
              notify("워크스페이스를 만들었습니다.");
            } catch (e) {
              notify((e as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="워크스페이스 이름">
            <input
              value={wsName}
              onChange={(e) => setWsName(e.target.value)}
              required
              placeholder="예: AI 플랫폼팀"
            />
          </Field>
          <div className="modal-actions">
            <Button variant="primary" disabled={busy}>
              만들기
            </Button>
          </div>
        </form>
      </Modal>
      <CommandPalette
        open={command}
        onOpenChange={setCommand}
        onCreate={() => setNewDoc(true)}
        onAI={() => setAI(true)}
      />
      {ai && (
        <React.Suspense fallback={<Loading />}>
          <AI
            open={ai}
            onClose={() => setAI(false)}
            documentId={
              location.pathname.match(/\/app\/documents\/([^/]+)$/)?.[1]
            }
          />
        </React.Suspense>
      )}
    </div>
  );
}

export default function App() {
  const location = useLocation();
  if (location.pathname.startsWith("/share/")) {
    return (
      <React.Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/share/:id" element={<PublicSharePage />} />
        </Routes>
      </React.Suspense>
    );
  }
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const [user, setUser] = useState<User | null>(null),
    [info, setInfo] = useState<Record<string, any>>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [workspaceId, setWorkspaceId] = useState(
      localStorage.getItem("madi.workspace") || "",
    ),
    [documents, setDocuments] = useState<DocSummary[]>([]),
    [toast, setToast] = useState<{ text: string; type: string } | null>(null);
  const location = useLocation(),
    navigate = useNavigate();
  const workspaceRef = useRef(workspaceId),
    reloadSequence = useRef(0);
  workspaceRef.current = workspaceId;
  const notify = useCallback((text: string, type = "success") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => {
    Promise.all([
      api("/public").then(setInfo),
      api<User>("/auth/me")
        .then(setUser)
        .catch((e) => {
          if (!(e instanceof ApiError && e.status === 401)) throw e;
        }),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    document.documentElement.dataset.theme =
      user.preferences?.theme === "dark" ? "dark" : "light";
    document.documentElement.style.fontSize = `${user.preferences?.font_size || 16}px`;
    setDateTimezone(user.preferences?.timezone);
    applyPersonalization(user.preferences || {});
  }, [user]);
  const reload = useCallback(async () => {
    if (!user) return;
    const sequence = ++reloadSequence.current;
    const ws = await api<Workspace[]>("/workspaces");
    if (
      sequence !== reloadSequence.current ||
      workspaceId !== workspaceRef.current
    )
      return;
    setWorkspaces(ws);
    const id = ws.some((w) => w.id === workspaceId)
      ? workspaceId
      : ws[0]?.id || "";
    if (id !== workspaceId) {
      workspaceRef.current = id;
      setWorkspaceId(id);
    }
    if (id) {
      const items = await api<DocSummary[]>(`/documents?workspace_id=${id}`);
      if (sequence === reloadSequence.current && workspaceRef.current === id)
        setDocuments(items);
    } else setDocuments([]);
  }, [user?.id, workspaceId]);
  useEffect(() => {
    reload().catch((e) => notify(e.message, "error"));
  }, [reload]);
  const setWorkspace = (id: string) => {
    if (id === workspaceRef.current) return;
    workspaceRef.current = id;
    setDocuments([]);
    setWorkspaceId(id);
    localStorage.setItem("madi.workspace", id);
  };
  const createDocument = async (
    title = "제목 없는 문서",
    markdown = "",
    extra = {},
  ) => {
    if (!workspaceId) {
      notify("먼저 워크스페이스를 만들어 주세요.", "error");
      return;
    }
    try {
      const d = await api<Doc>("/documents", "POST", {
        workspace_id: workspaceId,
        title,
        markdown,
        ...extra,
      });
      await reload();
      notify("새 문서를 만들었습니다.");
      return d;
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };
  if (loading)
    return (
      <div className="app-loading">
        <img src="/favicon.svg" alt="madi" />
        <Loading />
      </div>
    );
  if (error)
    return (
      <div className="app-loading">
        <ErrorBox error={error} />
        <Button onClick={() => window.location.reload()}>다시 시도</Button>
      </div>
    );
  if (!user)
    return (
      <Login
        info={info}
        onLogin={(u) => {
          setUser(u);
          const saved =
            u.preferences?.last_path ||
            localStorage.getItem("madi.last_path") ||
            "/app";
          navigate(
            location.pathname === "/login" || location.pathname === "/"
              ? saved.startsWith("/app") ||
                (u.role === "admin" && saved.startsWith("/admin"))
                ? saved
                : "/app"
              : location.pathname,
            { replace: true },
          );
        }}
      />
    );
  if (location.pathname === "/" || location.pathname === "/login")
    return <Navigate to="/app" replace />;
  return (
    <AppContext.Provider
      value={{
        user,
        setUser,
        publicInfo: info,
        refreshPublic: async () => {
          setInfo(await api("/public"));
        },
        workspaces,
        workspace: workspaces.find((w) => w.id === workspaceId) || null,
        setWorkspace,
        documents,
        reload,
        createDocument,
        notify,
      }}
    >
      <Shell />
      <PWAControls />
      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          {toast.type === "error" ? (
            <X size={18} />
          ) : (
            <CheckCircle2 size={18} />
          )}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            onClick={() => setToast(null)}
            aria-label="알림 닫기"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
