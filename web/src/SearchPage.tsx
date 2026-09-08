import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Search,
  SlidersHorizontal,
  ShieldCheck,
  RefreshCw,
  ArrowRight,
  FileText,
  Database,
  MessageSquare,
  Paperclip,
  Hash,
  CheckSquare,
  Code2,
  Layers,
  Users,
} from "lucide-react";
import { api, datetime } from "./api";
import { useApp } from "./context";
import {
  Badge,
  Button,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeading,
} from "./ui";
import "./search.css";
import NaturalSearch from "./NaturalSearch";
const SearchAI = lazy(() => import("./AI"));

const kinds: Record<string, { label: string; icon: typeof Search }> = {
  document: { label: "문서", icon: FileText },
  block: { label: "블록", icon: Layers },
  code: { label: "코드", icon: Code2 },
  task: { label: "할 일", icon: CheckSquare },
  file: { label: "파일", icon: Paperclip },
  comment: { label: "댓글", icon: MessageSquare },
  tag: { label: "태그", icon: Hash },
  database: { label: "데이터베이스", icon: Database },
  row: { label: "데이터 행", icon: Database },
  user: { label: "사용자", icon: Users },
  ai_conversation: { label: "내 AI 대화", icon: MessageSquare },
};
type Result = {
  kind: string;
  id: string;
  title: string;
  snippet: string;
  url: string;
  updated_at: string;
  document_id: string;
  score: number;
  metadata: Record<string, any>;
};
type SearchResponse = {
  results: Result[];
  has_more: boolean;
  next_offset: number;
  available_types: string[];
  ranking: string;
  history_status?: string;
};
function Excerpt({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  return index < 0 ? (
    <>{text}</>
  ) : (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}
export default function SearchPage() {
  const { workspace, documents } = useApp();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<{ id: string; version: number }[]>(
      [],
    ),
    [summary, setSummary] = useState(false);
  const [query, setQuery] = useState(params.get("q") || "");
  const [data, setData] = useState<SearchResponse | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0),
    [filters, setFilters] = useState(false);
  const [spaces, setSpaces] = useState<Record<string, any>[]>([]),
    [members, setMembers] = useState<Record<string, any>[]>([]),
    [index, setIndex] = useState<Record<string, any> | null>(null);
  const generation = useRef(0),
    input = useRef<HTMLInputElement>(null);
  const term = params.get("q") || "",
    kind = params.get("type") || "",
    offset = Number(params.get("offset")) || 0;
  const queryString = params.toString();
  useEffect(() => setQuery(term), [term]);
  useEffect(() => {
    setSelected([]);
    setSummary(false);
  }, [workspace?.id, queryString, refresh]);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    setSpaces([]);
    setMembers([]);
    setIndex(null);
    if (!workspace) return;
    let active = true;
    void api<Record<string, any>[]>(`/spaces?workspace_id=${workspace.id}`)
      .then((v) => active && setSpaces(v))
      .catch(() => {});
    void api<Record<string, any>[]>(`/workspaces/${workspace.id}/members`)
      .then((v) => active && setMembers(v))
      .catch(() => {});
    void api<Record<string, any>>(
      `/search/index-status?workspace_id=${workspace.id}`,
    )
      .then((v) => active && setIndex(v))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [workspace?.id, refresh]);
  useEffect(() => {
    const run = ++generation.current;
    setData(null);
    setError("");
    setLoading(true);
    if (!workspace) {
      setLoading(false);
      return;
    }
    const request = new URLSearchParams(queryString);
    request.set("workspace_id", workspace.id);
    request.set("limit", "40");
    void api<SearchResponse>(`/search?${request}`)
      .then((v) => {
        if (run === generation.current) setData(v);
      })
      .catch((e) => {
        if (run === generation.current) setError(e.message);
      })
      .finally(() => {
        if (run === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [workspace?.id, queryString, refresh]);
  const change = (key: string, value: string) =>
    setParams((old) => {
      const next = new URLSearchParams(window.location.search);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== "offset") next.delete("offset");
      return next;
    });
  const activeFilters = [
    "space_id",
    "author_id",
    "tag",
    "status",
    "from",
    "to",
    "has_attachment",
  ].filter((k) => params.get(k));
  const tags = [...new Set(documents.flatMap((d) => d.tags || []))].sort();
  const statusNames: Record<string, string> = {
    draft: "초안",
    review: "검토 중",
    published: "게시됨",
    rejected: "반려됨",
    stale: "검토 필요",
    archived: "보관됨",
  };
  const choices = (
    key: string,
    items: { id: string; name: string }[],
    all: string,
  ) => (
    <select
      aria-label={all}
      value={params.get(key) || ""}
      onChange={(e) => change(key, e.target.value)}
    >
      <option value="">{all}</option>
      {params.get(key) && !items.some((i) => i.id === params.get(key)) && (
        <option value={params.get(key)!}>
          현재 필터 · 접근 범위 확인 필요
        </option>
      )}
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
        </option>
      ))}
    </select>
  );
  return (
    <section className="universal-search">
      <PageHeading
        eyebrow="지식 탐색"
        title="통합 검색"
        description="문서와 블록, 할 일부터 댓글·파일·데이터베이스까지. 지금 접근할 수 있는 지식만 찾습니다."
        actions={
          <>
            <NaturalSearch
              initialQuery={query}
              onApply={(proposed) => {
                const next = new URLSearchParams(proposed);
                for (const name of ["space_id", "author_id"]) {
                  const v = new URLSearchParams(window.location.search).get(
                    name,
                  );
                  if (v) next.set(name, v);
                }
                setParams(next);
              }}
            />
            <Button onClick={() => setRefresh((v) => v + 1)} disabled={loading}>
              <RefreshCw size={17} />
              결과 새로고침
            </Button>
          </>
        }
      />
      <form
        className="universal-search-box"
        onSubmit={(e) => {
          e.preventDefault();
          change("q", query.trim());
        }}
      >
        <Search size={24} aria-hidden="true" />
        <input
          ref={input}
          aria-label="통합 검색어"
          value={query}
          maxLength={500}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="어떤 지식을 찾고 계신가요?"
        />
        <Button type="submit" variant="primary">
          검색
        </Button>
      </form>
      <div className="search-kind-tabs" role="group" aria-label="검색 종류">
        <button
          className={!kind ? "active" : ""}
          aria-pressed={!kind}
          onClick={() => change("type", "")}
        >
          전체
        </button>
        {Object.entries(kinds).map(([key, { label, icon: Icon }]) => (
          <button
            key={key}
            className={kind === key ? "active" : ""}
            aria-pressed={kind === key}
            onClick={() => change("type", key)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      <div className="search-refinements">
        <Button
          onClick={() => setFilters((v) => !v)}
          aria-expanded={filters}
          aria-controls="search-filters"
        >
          <SlidersHorizontal size={17} />
          상세 필터
          {activeFilters.length > 0 && <Badge>{activeFilters.length}</Badge>}
        </Button>
        <select
          aria-label="검색 정렬"
          value={params.get("sort") || "relevance"}
          onChange={(e) => change("sort", e.target.value)}
        >
          <option value="relevance">관련성 높은 순</option>
          <option value="newest">최근 수정 순</option>
          <option value="oldest">오래된 순</option>
          <option value="title">제목 순</option>
        </select>
        {activeFilters.length > 0 && (
          <Button
            onClick={() =>
              setParams((old) => {
                const next = new URLSearchParams(old);
                for (const key of activeFilters) next.delete(key);
                next.delete("offset");
                return next;
              })
            }
          >
            필터 초기화
          </Button>
        )}
      </div>
      {filters && (
        <div id="search-filters" className="panel search-filter-grid">
          <Field label="공간">
            {choices(
              "space_id",
              spaces.map((v) => ({ id: v.id, name: v.name })),
              "모든 공간",
            )}
          </Field>
          <Field label="문서 소유자">
            {choices(
              "author_id",
              members.map((v) => ({
                id: v.user_id || v.id,
                name: v.name || v.email,
              })),
              "모든 소유자",
            )}
          </Field>
          <Field label="태그">
            {choices(
              "tag",
              tags.map((v) => ({ id: v, name: `#${v}` })),
              "모든 태그",
            )}
          </Field>
          <Field label="문서 상태">
            {choices(
              "status",
              Object.entries(statusNames).map(([id, name]) => ({ id, name })),
              "모든 상태",
            )}
          </Field>
          <Field label="수정일 시작 (UTC)">
            <input
              type="date"
              aria-label="수정일 시작"
              value={params.get("from") || ""}
              onChange={(e) => change("from", e.target.value)}
            />
          </Field>
          <Field label="수정일 종료 (UTC)">
            <input
              type="date"
              aria-label="수정일 종료"
              value={params.get("to") || ""}
              onChange={(e) => change("to", e.target.value)}
            />
          </Field>
          <label className="search-attachment-filter">
            <input
              type="checkbox"
              checked={params.get("has_attachment") === "1"}
              onChange={(e) =>
                change("has_attachment", e.target.checked ? "1" : "")
              }
            />
            첨부파일이 있는 문서만
          </label>
          <p className="search-filter-note">
            소유자·태그·상태·첨부 필터는 문서 기반 결과에 적용됩니다.
            데이터베이스 날짜는 생성일 기준이며, 조건이 적용되지 않는 종류는
            결과에서 제외됩니다.
          </p>
        </div>
      )}
      <ErrorBox error={error} />
      {data && (
        <p className="muted">
          {data.history_status === "saved"
            ? "내 개인 검색 기록에 저장했습니다."
            : data.history_status === "protection_blocked"
              ? "정보보호 정책으로 검색어 기록을 저장하지 않았습니다."
              : data.history_status === "unavailable"
                ? "검색 결과는 조회했지만 개인 기록 저장은 일시적으로 실패했습니다."
                : ""}{" "}
          <Link to="/app/search-history">내 검색 기록 · 저장 동의 설정</Link>
        </p>
      )}
      {!!selected.length && (
        <div className="panel padded">
          <span>문서 {selected.length}/10개 선택 · 관련 원문 조각만 참조</span>
          <div className="modal-actions">
            <Button onClick={() => setSelected([])}>선택 해제</Button>
            <Button variant="primary" onClick={() => setSummary(true)}>
              선택 문서 AI 요약
            </Button>
          </div>
        </div>
      )}
      {summary && (
        <Suspense fallback={<Loading />}>
          <SearchAI
            open
            onClose={() => setSummary(false)}
            selectedDocuments={selected}
          />
        </Suspense>
      )}
      <div className="search-results-header">
        <span aria-live="polite">
          {loading
            ? "지식을 찾고 있습니다…"
            : data?.results.length
              ? `${offset + 1}–${offset + data.results.length}번째 결과`
              : "검색 결과 0개"}
        </span>
        <span>
          <ShieldCheck size={15} />
          현재 권한 적용
        </span>
      </div>
      {loading ? (
        <Loading />
      ) : data?.results.length ? (
        <div className="universal-results">
          {data.results.map((result) => {
            const entry = kinds[result.kind] || kinds.document,
              Icon = entry.icon;
            return (
              <article
                key={`${result.kind}:${result.id}`}
                className="search-result"
              >
                <div className="search-result-icon">
                  <Icon size={21} />
                  {result.kind === "document" && result.metadata.version && (
                    <input
                      type="checkbox"
                      aria-label={`${result.title} 요약에 선택`}
                      checked={selected.some((v) => v.id === result.id)}
                      disabled={
                        selected.length >= 10 &&
                        !selected.some((v) => v.id === result.id)
                      }
                      onChange={(e) =>
                        setSelected((old) =>
                          e.target.checked
                            ? [
                                ...old,
                                {
                                  id: result.id,
                                  version: result.metadata.version,
                                },
                              ]
                            : old.filter((v) => v.id !== result.id),
                        )
                      }
                    />
                  )}
                </div>
                <div className="search-result-body">
                  <div className="search-result-meta">
                    <Badge>{entry.label}</Badge>
                    <time dateTime={result.updated_at}>
                      {datetime(result.updated_at)}
                    </time>
                    {result.metadata.start_line && (
                      <span>{result.metadata.start_line}행</span>
                    )}
                  </div>
                  <Link
                    to={
                      result.kind === "tag"
                        ? `/app/search?type=document&tag=${encodeURIComponent(result.title)}`
                        : result.url
                    }
                    className="search-result-title"
                  >
                    <Excerpt text={result.title} query={term} />
                    <ArrowRight size={17} />
                  </Link>
                  <p
                    className={
                      result.kind === "code" ? "search-code-excerpt" : ""
                    }
                  >
                    <Excerpt text={result.snippet} query={term} />
                  </p>
                  {result.metadata.tags?.length > 0 && (
                    <div className="search-result-tags">
                      {result.metadata.tags.map((tag: string) => (
                        <button key={tag} onClick={() => change("tag", tag)}>
                          #{tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        !error && (
          <Empty
            title="찾는 지식이 아직 보이지 않아요"
            text="검색어를 짧게 바꾸거나 필터를 해제해 보세요. 접근 권한이 없는 문서는 검색되지 않습니다."
          />
        )
      )}
      {data && (offset > 0 || data.has_more) && (
        <div className="search-pagination">
          <Button
            disabled={offset === 0}
            onClick={() => change("offset", String(Math.max(0, offset - 40)))}
          >
            이전 결과
          </Button>
          <Button
            disabled={!data.has_more}
            onClick={() => change("offset", String(data.next_offset))}
          >
            다음 결과
          </Button>
        </div>
      )}
      <footer className="search-index-note">
        {index && (
          <span>
            내 접근 범위의 로컬 색인 {index.indexed}/{index.documents}개 문서
            {index.pending > 0 ? ` · ${index.pending}개 갱신 대기` : ""}
          </span>
        )}
        <p>
          문서 내용은 외부로 전송하지 않습니다. 파일은 이름·형식으로 검색하며,
          변경 전 버전의 블록·코드는 표시하지 않습니다.
        </p>
        {data && (
          <details>
            <summary>검색 순위 안내</summary>
            <p>{data.ranking}</p>
          </details>
        )}
      </footer>
    </section>
  );
}
