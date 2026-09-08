import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import AttachmentList from "./AttachmentList";
import DocumentProtection from "./security/DocumentProtection";
import PublicShareManager from "./security/PublicShareManager";
import BlockOrganizer from "./editor/BlockOrganizer";
import DocumentPresentation from "./editor/DocumentPresentation";
import { reconcileSavedDocument } from "./editor/saveSnapshot";
import { resolveEditorMode } from "./editor/mode";
const DocumentRAGIndex = lazy(() => import("./DocumentRAGIndex"));
const DocumentHistory = lazy(() => import("./history/DocumentHistory"));
import { MoveDocumentModal } from "./navigation/DocumentActions";
import { copyText } from "./navigation/clipboard";
import ApprovalPanel from "./approval/ApprovalPanel";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import {
  PortableTable,
  PortableParagraph,
  PortableHeading,
  unsupportedMarkdownReason,
} from "./editor/schema";
import { advancedNodes } from "./editor/nodes";
import {
  VisualCodeBlock,
  VisualInlineMath,
  VisualBlockMath,
  VisualSyncedEmbed,
  VisualBookmark,
} from "./editor/NodeViews";
import { MarkdownContent } from "./editor/MarkdownContent";
import { AdvancedToolbar } from "./editor/AdvancedToolbar";
import "./editor/style.css";
import Placeholder from "@tiptap/extension-placeholder";
import { UniqueID } from "@tiptap/extension-unique-id";
import Collaboration, { isChangeOrigin } from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import {
  MadiCollaborationProvider,
  type CollaborationSnapshot,
} from "./collaboration/provider";
import "./collaboration/style.css";
import type { Editor, JSONContent } from "@tiptap/core";
import {
  ArrowDownToLine,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Bold,
  Check,
  CheckCheck,
  CheckSquare,
  ChevronDown,
  Code,
  Code2,
  Columns2,
  Copy,
  Eye,
  FileText,
  Focus,
  Heading1,
  History,
  Italic,
  Link2,
  List,
  ListOrdered,
  MoreHorizontal,
  Paperclip,
  Quote,
  Redo,
  Save,
  Share2,
  Sparkles,
  Star,
  Table2,
  Trash2,
  Undo,
  X,
} from "lucide-react";
import {
  api,
  date,
  datetime,
  downloadText,
  type Doc,
  type DocSummary,
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
  statusNames,
  DocIcon,
} from "./ui";
import DiscussionPanel from "./DiscussionPanel";

function splitFrontMatter(value: string) {
  const match = value.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/);
  return match
    ? { front: match[1], body: value.slice(match[1].length) }
    : { front: "", body: value };
}
export function MarkdownView({
  markdown,
  documents,
  metadata,
}: {
  markdown: string;
  documents: DocSummary[];
  metadata?: Doc["block_metadata"];
}) {
  return (
    <MarkdownContent
      markdown={markdown}
      documents={documents}
      metadata={metadata}
    />
  );
}

type BlockEditorProps = {
  documentId: string;
  markdown: string;
  onChange: (v: string) => void;
  metadata: Doc["block_metadata"];
  onMetadata: (v: NonNullable<Doc["block_metadata"]>) => void;
  onProvider: (provider: MadiCollaborationProvider | null) => void;
  onSnapshot: (
    snapshot: CollaborationSnapshot,
    provider: MadiCollaborationProvider,
  ) => void;
};
function BlockEditor(props: BlockEditorProps) {
  const [provider, setProvider] = useState<MadiCollaborationProvider | null>(
    null,
  );
  const unsupported = unsupportedMarkdownReason(props.markdown);
  useEffect(() => {
    if (unsupported) return;
    const value = new MadiCollaborationProvider(props.documentId);
    setProvider(value);
    return () => {
      setTimeout(() => value.destroy(), 0);
    };
  }, [props.documentId]);
  if (unsupported && !provider)
    return (
      <div className="unsupported-markdown">
        <strong>원문 보존 모드</strong>
        <p>{unsupported}</p>
        <p>
          상단에서 Markdown 모드를 선택하면 원문을 그대로 편집할 수 있습니다.
        </p>
        <MarkdownContent markdown={props.markdown} />
      </div>
    );
  return provider ? (
    <NativeBlockEditor {...props} provider={provider} />
  ) : (
    <Loading />
  );
}
function NativeBlockEditor({
  documentId,
  markdown,
  onChange,
  metadata,
  onMetadata,
  onProvider,
  onSnapshot,
  provider,
}: BlockEditorProps & { provider: MadiCollaborationProvider }) {
  const { user } = useApp();
  const callbacks = useRef({ onProvider, onSnapshot, onChange, onMetadata });
  callbacks.current = { onProvider, onSnapshot, onChange, onMetadata };
  const [, setConnectionRevision] = useState(0);
  const original = useRef(markdown);
  const front = useRef(splitFrontMatter(markdown).front);
  const ready = useRef(false);
  const collect = (editor: Editor) => {
    const blocks: { id: string; type: string; text: string }[] = [];
    editor.state.doc.descendants((node) => {
      if (node.isBlock && node.attrs.id)
        blocks.push({
          id: node.attrs.id,
          type: node.type.name,
          text: Array.from(node.textContent).slice(0, 200).join(""),
        });
    });
    onMetadata({ blocks });
  };
  const [manage, setManage] = useState(false),
    [revision, setRevision] = useState(0);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        codeBlock: false,
        paragraph: false,
        heading: false,
      }),
      PortableParagraph,
      PortableHeading,
      VisualCodeBlock,
      Collaboration.configure({
        document: provider.document,
        field: "content",
      }),
      CollaborationCaret.configure({
        provider,
        user: { name: "사용자", color: "#0f766e" },
      }),
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
      PortableTable,
      TableCell,
      TableHeader,
      TableRow,
      Image,
      TextAlign.configure({ types: ["paragraph", "heading"] }),
      ...advancedNodes.filter(
        (extension) =>
          !["inlineMath", "blockMath", "syncedEmbed", "bookmark"].includes(
            extension.name,
          ),
      ),
      VisualInlineMath,
      VisualBlockMath,
      VisualSyncedEmbed,
      VisualBookmark,
      UniqueID.configure({
        types: "all",
        generateID: () => crypto.randomUUID(),
        filterTransaction: (transaction) => !isChangeOrigin(transaction),
      }),
      Placeholder.configure({
        placeholder: "생각을 기록하세요. / 를 입력해 블록을 추가할 수 있어요.",
      }),
    ],
    editable: false,
    editorProps: {
      attributes: { class: "tiptap-content", "aria-label": "블록 문서 편집기" },
    },
    onCreate: ({ editor }) => {
      ready.current = true;
    },
    onUpdate: ({ editor }) => {
      if (!ready.current) return;
      collect(editor);
      setRevision((v) => v + 1);
      const value = front.current + editor.getMarkdown();
      original.current = value;
      callbacks.current.onChange(value);
    },
  });
  useEffect(() => {
    if (editor)
      editor.view.dom.setAttribute(
        "spellcheck",
        String(user.preferences?.spell_check !== false),
      );
  }, [editor, user.preferences?.spell_check]);
  useEffect(() => {
    if (!editor) return;
    const seed = (snapshot: CollaborationSnapshot) => {
      const reason = unsupportedMarkdownReason(snapshot.markdown);
      if (reason) {
        provider.rejectUnsupported(reason);
        return;
      }
      const parts = splitFrontMatter(snapshot.markdown);
      front.current = parts.front;
      editor.commands.setContent(parts.body, { contentType: "markdown" });
      let index = 0;
      const transaction = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        if (!node.isBlock) return;
        const stored = metadata?.blocks?.[index++];
        if (
          stored &&
          stored.type === node.type.name &&
          stored.text === Array.from(node.textContent).slice(0, 200).join("")
        )
          transaction.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            id: stored.id,
          });
      });
      editor.view.dispatch(transaction);
      provider.seedFromCurrentDocument();
    };
    const snapshot = (value: CollaborationSnapshot) => {
      front.current = splitFrontMatter(value.markdown).front;
      callbacks.current.onSnapshot(value, provider);
    };
    const update = () => {
      editor.setEditable(
        provider.status === "connected" && !!provider.snapshot?.canWrite,
      );
      if (provider.snapshot)
        callbacks.current.onSnapshot(provider.snapshot, provider);
      setConnectionRevision((v) => v + 1);
      const anchor = decodeURIComponent(window.location.hash.slice(1));
      if (anchor.startsWith("^"))
        requestAnimationFrame(() =>
          editor.view.dom
            .querySelector(`[data-id="${CSS.escape(anchor.slice(1))}"]`)
            ?.scrollIntoView({ block: "center" }),
        );
    };
    const insert = (value: string) => {
      if (editor.isEditable)
        editor
          .chain()
          .focus()
          .insertContentAt(editor.state.doc.content.size, value, {
            contentType: "markdown",
          })
          .run();
    };
    provider
      .on("seed", seed)
      .on("snapshot", snapshot)
      .on("change", update)
      .on("presence", update)
      .on("insert", insert);
    callbacks.current.onProvider(provider);
    provider.connect();
    return () => {
      provider
        .off("seed", seed)
        .off("snapshot", snapshot)
        .off("change", update)
        .off("presence", update)
        .off("insert", insert);
      callbacks.current.onProvider(null);
    };
  }, [editor, provider]);
  const [slash, setSlash] = useState(false);
  if (!editor) return <Loading />;
  const insert = (value: string) => {
    editor
      .chain()
      .focus()
      .insertContent(value, { contentType: "markdown" })
      .run();
    setSlash(false);
  };
  return (
    <>
      <div
        className="collaboration-bar"
        data-state={provider.status}
        aria-live="polite"
      >
        <span>
          {
            {
              connecting: "공동 편집 연결 중…",
              syncing: "편집 상태 동기화 중…",
              connected: provider.hasUnsavedChanges
                ? "공동 편집 · 저장 중…"
                : "공동 편집 · 모든 변경 저장됨",
              disconnected: "연결 재시도 중 · 로컬 초안 보관",
              conflict: "문서 기준 변경 · 초안 확인 필요",
              error: "공동 편집 연결 확인 필요",
            }[provider.status]
          }
        </span>
        <div className="collaboration-peers">
          {[...provider.awareness.getStates()].map(
            ([client, state]) =>
              state.user && (
                <span
                  key={client}
                  style={{ background: state.user.color }}
                  title={state.user.name}
                >
                  {state.user.name?.slice(0, 1)}
                </span>
              ),
          )}
        </div>
      </div>
      {(provider.status === "error" || provider.status === "conflict") && (
        <div className="collaboration-recovery">
          <span>{provider.error}</span>
          <Button
            onClick={() =>
              downloadText(
                "madi-복구-초안.md",
                front.current + editor.getMarkdown(),
              )
            }
          >
            현재 초안 다운로드
          </Button>
          <Button
            onClick={() => {
              if (
                window.confirm(
                  "현재 초안을 다운로드했나요? 최신 서버 문서로 다시 연결합니다.",
                )
              )
                window.location.reload();
            }}
          >
            최신 문서 다시 연결
          </Button>
        </div>
      )}
      <div className="editor-toolbar">
        <button
          title="굵게"
          aria-label="굵게"
          className={editor.isActive("bold") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={17} />
        </button>
        <button
          title="기울임"
          aria-label="기울임"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={17} />
        </button>
        <span />
        <select
          aria-label="블록 유형"
          value=""
          onChange={(e) => {
            if (e.target.value === "p")
              editor.chain().focus().setParagraph().run();
            else
              editor
                .chain()
                .focus()
                .toggleHeading({ level: Number(e.target.value) as 1 | 2 | 3 })
                .run();
          }}
        >
          <option value="" disabled>
            텍스트 / 제목
          </option>
          <option value="p">본문</option>
          <option value="1">제목 1</option>
          <option value="2">제목 2</option>
          <option value="3">제목 3</option>
        </select>
        <span />
        <button
          title="글머리 목록"
          aria-label="글머리 목록"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={18} />
        </button>
        <button
          title="번호 목록"
          aria-label="번호 목록"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={18} />
        </button>
        <button
          title="체크리스트"
          aria-label="체크리스트"
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <CheckSquare size={17} />
        </button>
        <button
          title="인용"
          aria-label="인용"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={17} />
        </button>
        <button
          title="코드 블록"
          aria-label="코드 블록"
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Code2 size={18} />
        </button>
        <button
          title="표 삽입"
          aria-label="표 삽입"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          <Table2 size={17} />
        </button>
        <span />
        <button
          title="실행 취소"
          aria-label="실행 취소"
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo size={17} />
        </button>
        <button
          title="다시 실행"
          aria-label="다시 실행"
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo size={17} />
        </button>
        <span />
        <button
          title="블록 정리"
          aria-label="블록 정리"
          onClick={() => setManage(true)}
        >
          <GripVertical size={18} />
        </button>
      </div>
      <div
        onKeyDown={(e) => {
          if (e.key === "/") setSlash(true);
          if (e.key === "Escape") setSlash(false);
        }}
      >
        <AdvancedToolbar editor={editor} documentId={documentId} />
        <EditorContent editor={editor} />
      </div>
      {slash && (
        <div className="slash-menu">
          <strong>블록 추가</strong>
          {[
            ["제목", "\n## 제목\n"],
            ["할 일", "\n- [ ] 할 일\n"],
            ["코드", "\n```text\n코드\n```\n"],
            ["표", "\n| 제목 | 내용 |\n| --- | --- |\n| 항목 | 값 |\n"],
            ["구분선", "\n---\n"],
            ["위키 링크", "[[문서 제목]]"],
            ["콜아웃", "> [!NOTE] 참고\n> 내용을 입력하세요.\n"],
            ["수식", "$$\nE=mc^2\n$$\n"],
            [
              "다이어그램",
              "```mermaid\nflowchart LR\n  A[아이디어] --> B[지식]\n```\n",
            ],
          ].map(([label, value]) => (
            <button
              key={label}
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .deleteRange({
                    from: Math.max(0, editor.state.selection.from - 1),
                    to: editor.state.selection.from,
                  })
                  .run();
                insert(value);
              }}
            >
              {label}
            </button>
          ))}
          <button onClick={() => setSlash(false)}>닫기</button>
        </div>
      )}
      <BlockOrganizer
        editor={editor}
        documentID={documentId}
        open={manage}
        onOpenChange={setManage}
      />
    </>
  );
}

export default function DocumentPage({ onAI }: { onAI: () => void }) {
  const { id } = useParams();
  const [modeParams, setModeParams] = useSearchParams();
  const sourceLine = /^\d{1,7}$/.test(modeParams.get("line") || "")
    ? Number(modeParams.get("line"))
    : 0;
  const sourceInput = useRef<HTMLTextAreaElement>(null),
    appliedSourceLocation = useRef("");
  const {
    documents,
    reload,
    notify,
    user,
    publicInfo,
    workspace,
    setWorkspace,
    createDocument,
  } = useApp();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Doc | null>(null),
    [markdown, setMarkdown] = useState(""),
    [title, setTitle] = useState(""),
    [tags, setTags] = useState(""),
    [mode, setMode] = useState(
      resolveEditorMode(
        modeParams.get("mode"),
        user.preferences?.editor_mode,
        sourceLine,
      ),
    ),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(false),
    [saved, setSaved] = useState(false),
    [history, setHistory] = useState(false),
    [backlinks, setBacklinks] = useState<Doc[]>([]),
    [share, setShare] = useState(false),
    [visibility, setVisibility] = useState("workspace"),
    [parent, setParent] = useState(""),
    [aliases, setAliases] = useState(""),
    [shares, setShares] = useState<any[]>([]),
    [shareEmail, setShareEmail] = useState(""),
    [shareRole, setShareRole] = useState("viewer");
  const [pendingDraft, setPendingDraft] = useState<any>(null);
  const [moveDoc, setMoveDoc] = useState<Doc | null>(null);
  const [ragIndexOpen, setRAGIndexOpen] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const favoritePending = useRef(false),
    actionPending = useRef(false),
    sharePending = useRef(false),
    shareRevision = useRef(0),
    shareReadSequence = useRef(0),
    activeUser = useRef(user.id);
  activeUser.current = user.id;
  const changeShare = (open: boolean) => {
    shareRevision.current++;
    setShare(open);
  };
  const focus = modeParams.get("view") === "focus";
  const setFocus = (value: boolean) =>
    setModeParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set("view", "focus");
      else next.delete("view");
      return next;
    });
  const [attachmentRevision, setAttachmentRevision] = useState(0);
  const collaboration = useRef<MadiCollaborationProvider | null>(null);
  const currentDocument = useRef(doc);
  currentDocument.current = doc;
  const fileInput = useRef<HTMLInputElement>(null),
    activeRoute = useRef(id),
    loadSequence = useRef(0),
    blockMetadata = useRef<NonNullable<Doc["block_metadata"]>>({ blocks: [] }),
    latest = useRef({ markdown, title, tags }),
    savingRef = useRef(false);
  latest.current = { markdown, title, tags };
  const canWrite = doc?.can_write ?? false;
  useEffect(() => setHistory(false), [id]);
  useEffect(() => {
    setMode(
      resolveEditorMode(
        modeParams.get("mode"),
        user.preferences?.editor_mode,
        sourceLine,
      ),
    );
  }, [id, modeParams.get("mode"), sourceLine]);
  useEffect(() => {
    if (!sourceLine || mode !== "source") appliedSourceLocation.current = "";
    if (
      mode !== "source" ||
      !doc ||
      doc.id !== id ||
      !sourceLine ||
      !sourceInput.current
    )
      return;
    const key = `${id}:${sourceLine}`;
    if (appliedSourceLocation.current === key) return;
    const lines = markdown.split("\n"),
      line = Math.min(lines.length, Math.max(1, sourceLine));
    const offset = lines
      .slice(0, line - 1)
      .reduce((total, value) => total + value.length + 1, 0);
    const input = sourceInput.current;
    appliedSourceLocation.current = key;
    input.focus({ preventScroll: true });
    input.setSelectionRange(offset, offset + lines[line - 1].length);
    input.scrollTop = Math.max(
      0,
      (line - 3) * (parseFloat(getComputedStyle(input).lineHeight) || 30),
    );
    input.scrollIntoView({ block: "center" });
  }, [id, doc?.id, mode, sourceLine, markdown]);
  activeRoute.current = id;
  // Route ID alone is insufficient for A → B → A. Invalidate every async UI
  // completion on reload, unmount, identity change, or navigation generation.
  const actionGuard = () => {
    const route = id,
      sequence = loadSequence.current,
      actor = user.id;
    return () =>
      activeRoute.current === route &&
      sequence === loadSequence.current &&
      activeUser.current === actor;
  };
  const draftKey = (documentId: string) =>
    `madi.draft.${user.id}.${documentId}`;
  const load = useCallback(async () => {
    if (!id || activeRoute.current !== id) return;
    const sequence = ++loadSequence.current;
    savingRef.current = false;
    setSaving(false);
    setError("");
    try {
      const d = await api<Doc>("/documents/" + id);
      if (activeRoute.current !== id || sequence !== loadSequence.current)
        return;
      if (workspace?.id !== d.workspace_id) setWorkspace(d.workspace_id);
      setDoc(d);
      blockMetadata.current = d.block_metadata || { blocks: [] };
      setMarkdown(d.markdown);
      setTitle(d.title);
      setTags((d.tags || []).join(", "));
      setAliases((d.aliases || []).join(", "));
      setVisibility(d.visibility);
      setParent(d.parent_id || "");
      setDirty(false);
      setPendingDraft(null);
      try {
        const draft = JSON.parse(
          sessionStorage.getItem(draftKey(id)) || "null",
        );
        if (
          draft &&
          (draft.markdown !== d.markdown ||
            draft.title !== d.title ||
            draft.tags !== (d.tags || []).join(", "))
        )
          setPendingDraft(draft);
      } catch {}
      await Promise.allSettled([
        api<Doc[]>(`/documents/${id}/backlinks`).then((v) => {
          if (activeRoute.current === id && sequence === loadSequence.current)
            setBacklinks(v);
        }),
      ]);
    } catch (e) {
      if (activeRoute.current === id && sequence === loadSequence.current)
        setError((e as Error).message);
    }
  }, [id, user.id]);
  useEffect(() => {
    setDoc(null);
    setRAGIndexOpen(false);
    setMoveDoc(null);
    shareRevision.current++;
    setShare(false);
    setShares([]);
    setShareEmail("");
    setShareRole("viewer");
    setFavoriteBusy(false);
    setActionBusy(false);
    setShareBusy(false);
    favoritePending.current =
      actionPending.current =
      sharePending.current =
        false;
    setDirty(false);
    setSaving(false);
    savingRef.current = false;
    setBacklinks([]);
    load();
    return () => {
      loadSequence.current++;
    };
  }, [load]);
  useEffect(() => {
    let active = true;
    const current = actionGuard();
    const sequence = ++shareReadSequence.current;
    setShares([]);
    if (share && id && canWrite)
      api<any[]>(`/documents/${id}/shares`)
        .then((value) => {
          if (active && current() && sequence === shareReadSequence.current)
            setShares(value);
        })
        .catch((e) => {
          if (active && current()) notify(e.message, "error");
        });
    return () => {
      active = false;
    };
  }, [share, id, canWrite]);
  const save = useCallback(
    async (silent = false) => {
      if (
        !doc ||
        !doc.can_write ||
        doc.id !== activeRoute.current ||
        savingRef.current
      )
        return false;
      const sequence = loadSequence.current;
      savingRef.current = true;
      setSaving(true);
      const snapshot = { ...latest.current };
      try {
        const live = collaboration.current;
        if (live) {
          await live.waitForSaved();
          if (
            activeRoute.current !== doc.id ||
            sequence !== loadSequence.current
          )
            return true;
          if (
            snapshot.title === doc.title &&
            snapshot.tags === (doc.tags || []).join(", ")
          ) {
            setDirty(live.hasUnsavedChanges);
            setSaved(true);
            if (!silent) notify("공동 편집 변경 내용을 저장했습니다.");
            return true;
          }
        }
        const d = await api<
          Doc & {
            protection?: {
              changed: boolean;
              mode: string;
              findings?: unknown[];
            };
          }
        >(`/documents/${doc.id}`, "PUT", {
          title: snapshot.title,
          ...(!live
            ? {
                markdown: snapshot.markdown,
                block_metadata: blockMetadata.current,
              }
            : {}),
          tags: snapshot.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          version: live?.snapshot?.version || doc.version,
        });
        try {
          const draft = JSON.parse(
            sessionStorage.getItem(draftKey(doc.id)) || "null",
          );
          if (
            draft &&
            draft.markdown === snapshot.markdown &&
            draft.title === snapshot.title &&
            draft.tags === snapshot.tags
          )
            sessionStorage.removeItem(draftKey(doc.id));
        } catch {}
        if (activeRoute.current !== doc.id || sequence !== loadSequence.current)
          return true;
        // A newer CRDT acknowledgement can arrive while this REST save is in
        // flight. Never regress the server version or replace newer typing.
        const existing = currentDocument.current;
        const canonical =
          existing?.id === d.id && existing.version > d.version ? existing : d;
        const reconciled = reconcileSavedDocument(
          snapshot,
          latest.current,
          canonical,
          !!live?.hasUnsavedChanges,
        );
        latest.current = reconciled.values;
        currentDocument.current = canonical;
        setDoc(canonical);
        setTitle(reconciled.values.title);
        setTags(reconciled.values.tags);
        setMarkdown(reconciled.values.markdown);
        if (reconciled.applyMetadata)
          blockMetadata.current = canonical.block_metadata || { blocks: [] };
        setDirty(reconciled.dirty);
        setSaved(true);
        setError("");
        if (d.protection?.changed)
          notify(
            reconciled.dirty
              ? "보안 정책에 따라 저장본의 민감정보를 마스킹했습니다. 저장 중 추가한 내용은 초안으로 유지합니다."
              : "보안 정책에 따라 민감정보를 마스킹한 문서를 저장했습니다.",
          );
        else if (d.protection?.mode === "warn" && d.protection.findings?.length)
          notify(
            "민감정보가 탐지되었습니다. 문서의 공개 범위와 내용을 확인하세요.",
          );
        else if (!silent) notify("문서를 저장했습니다.");
        await reload();
        return true;
      } catch (e) {
        if (activeRoute.current === doc.id && sequence === loadSequence.current)
          setError((e as Error).message);
        return false;
      } finally {
        if (
          activeRoute.current === doc.id &&
          sequence === loadSequence.current
        ) {
          savingRef.current = false;
          setSaving(false);
        }
      }
    },
    [doc, notify, reload],
  );
  useEffect(() => {
    if (!dirty || error) return;
    const t = setTimeout(() => save(true), 1800);
    return () => clearTimeout(t);
  }, [dirty, markdown, title, tags, save, error]);
  useEffect(() => {
    if (!dirty || !doc || doc.id !== id) return;
    try {
      sessionStorage.setItem(
        draftKey(doc.id),
        JSON.stringify({
          markdown,
          title,
          tags,
          version: doc.version,
          block_metadata: blockMetadata.current,
          saved_at: new Date().toISOString(),
        }),
      );
    } catch {
      setError(
        "브라우저 임시 저장 공간이 부족합니다. 문서를 저장한 후 이동하세요.",
      );
    }
  }, [dirty, markdown, title, tags, id, doc?.version]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [save]);
  const changeMarkdown = (v: string) => {
    if (mode === "source") blockMetadata.current = { blocks: [] };
    setMarkdown(v);
    setDirty(
      collaboration.current
        ? collaboration.current.hasUnsavedChanges ||
            latest.current.title !== currentDocument.current?.title ||
            latest.current.tags !==
              (currentDocument.current?.tags || []).join(", ")
        : true,
    );
    setSaved(false);
  };
  const collaborationSnapshot = (
    snapshot: CollaborationSnapshot,
    live: MadiCollaborationProvider,
  ) => {
    const previous = currentDocument.current;
    if (
      !previous ||
      previous.id !== live.documentId ||
      activeRoute.current !== live.documentId ||
      previous.version > snapshot.version
    )
      return;
    if (latest.current.title === previous.title) setTitle(snapshot.title);
    if (latest.current.tags === (previous.tags || []).join(", "))
      setTags(snapshot.tags.join(", "));
    setDoc((value) =>
      value?.id === live.documentId
        ? {
            ...value,
            version: snapshot.version,
            markdown: snapshot.markdown,
            can_write: snapshot.canWrite,
            title: snapshot.title,
            tags: snapshot.tags,
            status: snapshot.documentStatus,
          }
        : value,
    );
    if (!live.hasUnsavedChanges) setMarkdown(snapshot.markdown);
    const metadataDirty =
      latest.current.title !== previous.title ||
      latest.current.tags !== (previous.tags || []).join(", ");
    setDirty(live.hasUnsavedChanges || metadataDirty);
    setSaved(!live.hasUnsavedChanges);
  };
  const switchMode = async (value: string) => {
    const target = resolveEditorMode(value, undefined);
    if (target === mode) return;
    const current = actionGuard();
    try {
      if (collaboration.current) await collaboration.current.waitForSaved();
      if (!current()) return;
      if (dirty && !(await save(true))) return;
      if (!current()) return;
      // Source mode is an explicit optimistic REST editing session. Native CRDT
      // binding is unmounted before its first source edit; any remote session is
      // safely reset by the server's epoch barrier when source Markdown saves.
      // A mode switch is not a document reload. An in-flight GET here used to
      // replace typing made immediately after clicking an already active mode.
      // REST save and CRDT acknowledgements already reconcile the canonical
      // snapshot. Preserve newer input if it arrived while save was in flight.
      if (target === "edit") {
        const canonical = currentDocument.current;
        if (
          canonical &&
          (latest.current.markdown !== canonical.markdown ||
            latest.current.title !== canonical.title ||
            latest.current.tags !== (canonical.tags || []).join(", "))
        ) {
          notify(
            "저장 중 새로 입력한 내용이 남아 있습니다. 저장이 끝난 뒤 블록 편집기로 전환하세요.",
          );
          return;
        }
      }
      setMode(target);
      setModeParams({ mode: value });
    } catch (e) {
      if (current()) setError((e as Error).message);
    }
  };
  useEffect(() => {
    const handler = (event: Event) => {
      const action = (event as CustomEvent).detail?.action;
      if (
        !doc ||
        ![
          "save",
          "focus",
          "duplicate",
          "move",
          "export",
          "print",
          "copy",
          "present",
        ].includes(action)
      )
        return;
      const current = actionGuard();
      void (async () => {
        if (action === "focus") {
          setFocus(!focus);
          return;
        }
        if (action === "copy") {
          await copyText(`${window.location.origin}/app/documents/${doc.id}`);
          if (current()) notify("문서 링크를 복사했습니다.");
          return;
        }
        if (action === "save") {
          if (!canWrite) throw new Error("읽기 전용 문서입니다.");
          await save();
          return;
        }
        if (collaboration.current) await collaboration.current.waitForSaved();
        if (!current()) return;
        if (dirty && !(await save(true))) return;
        if (!current()) return;
        const fresh = await api<Doc>("/documents/" + doc.id);
        if (!current()) return;
        if (action === "export")
          downloadText(fresh.title + ".md", fresh.markdown);
        else if (action === "duplicate") {
          const copy = await createDocument(
            fresh.title + " 사본",
            fresh.markdown,
            { visibility: "private", tags: fresh.tags, block_metadata: {} },
          );
          if (copy && current()) navigate("/app/documents/" + copy.id);
        } else if (action === "move") {
          if (!fresh.can_write)
            throw new Error("문서를 이동할 권한이 없습니다.");
          setMoveDoc(fresh);
        } else if (action === "present" || action === "print") {
          setMode("preview");
          setModeParams((current) => {
            const next = new URLSearchParams(current);
            next.set("mode", "preview");
            if (action === "present") {
              next.set("view", "presentation");
              next.set("slide", "0");
            } else {
              next.delete("view");
              next.delete("slide");
            }
            return next;
          });
          if (action === "print") {
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            if (current()) window.print();
          }
        }
      })().catch((e) => {
        if (current()) notify(e.message, "error");
      });
    };
    window.addEventListener("madi-document-command", handler);
    return () => window.removeEventListener("madi-document-command", handler);
  }, [doc, dirty, save, focus, createDocument, navigate, canWrite]);
  const upload = async (file: File) => {
    if (!doc || !canWrite) return;
    const current = actionGuard();
    const data = new FormData();
    data.append("file", file);
    try {
      const a = await api(`/attachments?document_id=${doc.id}`, "POST", data);
      if (!current()) return;
      const insertion = `\n\n${file.type.startsWith("image/") ? "!" : ""}[${a.name.replace(/[\[\]]/g, "")}](${a.url})\n`;
      setAttachmentRevision((n) => n + 1);
      if (collaboration.current)
        collaboration.current.insertMarkdown(insertion);
      else changeMarkdown(latest.current.markdown + insertion);
      notify("파일을 첨부했습니다.");
    } catch (e) {
      if (current()) notify((e as Error).message, "error");
    }
  };
  if (!doc || doc.id !== id)
    return error ? <ErrorBox error={error} /> : <Loading />;
  const headings = [...markdown.matchAll(/^(#{1,3})\s+(.+)$/gm)].map(
    (m, i) => ({ level: m[1].length, text: m[2], id: i }),
  );
  return (
    <div className={`document-page ${focus ? "focus-mode" : ""}`}>
      {ragIndexOpen && (
        <Suspense fallback={<Loading />}>
          <DocumentRAGIndex
            documentID={doc.id}
            onClose={() => setRAGIndexOpen(false)}
          />
        </Suspense>
      )}
      <MoveDocumentModal doc={moveDoc} close={() => setMoveDoc(null)} />
      {modeParams.get("view") === "presentation" && (
        <DocumentPresentation
          title={title}
          source={markdown}
          documents={documents}
          slide={Number(modeParams.get("slide") || 0)}
          onSlide={(value) =>
            setModeParams(
              (current) => {
                const next = new URLSearchParams(current);
                next.set("slide", String(value));
                return next;
              },
              { replace: true },
            )
          }
          close={() =>
            setModeParams((current) => {
              const next = new URLSearchParams(current);
              next.delete("view");
              next.delete("slide");
              return next;
            })
          }
        />
      )}
      <div className="document-actionbar">
        <Link to="/app/documents">
          <FileText size={16} /> 문서
        </Link>
        <div>
          <span className="save-state">
            {saving ? (
              "저장 중…"
            ) : dirty ? (
              "저장되지 않은 변경"
            ) : (
              <>
                <CheckCheck size={15} /> 저장됨
              </>
            )}
          </span>
          <button
            className="icon-button"
            title="즐겨찾기"
            aria-label="즐겨찾기"
            aria-pressed={!!doc.is_favorite}
            disabled={favoriteBusy}
            onClick={async () => {
              if (favoritePending.current) return;
              const current = actionGuard();
              favoritePending.current = true;
              setFavoriteBusy(true);
              try {
                const result = await api<Doc>(
                  `/documents/${id}/favorite`,
                  "POST",
                );
                if (!current()) return;
                setDoc((value) =>
                  value?.id === result.id
                    ? { ...value, is_favorite: result.is_favorite }
                    : value,
                );
                await reload();
              } catch (e) {
                if (current()) notify((e as Error).message, "error");
              } finally {
                if (current()) {
                  favoritePending.current = false;
                  setFavoriteBusy(false);
                }
              }
            }}
          >
            <Star size={19} fill={doc.is_favorite ? "currentColor" : "none"} />
          </button>
          <Button
            onClick={() => {
              setVisibility(doc.visibility);
              setParent(doc.parent_id || "");
              setAliases((doc.aliases || []).join(", "));
              changeShare(true);
            }}
          >
            <Share2 size={16} /> 공유
          </Button>
          <Button
            variant="primary"
            disabled={saving || !dirty || !canWrite}
            onClick={() => save()}
          >
            <Save size={16} /> 저장
          </Button>
        </div>
      </div>
      <ErrorBox error={error} />
      {pendingDraft && canWrite && (
        <div className="notice">
          <History size={20} />
          <div>
            <strong>이전에 저장하지 못한 내용이 있습니다.</strong>
            <p>
              이 탭에 임시 보관된 내용을 복구할 수 있습니다. 서버 문서를 확인한
              후 선택하세요.
            </p>
            <div className="button-row">
              <Button
                onClick={() => {
                  if (collaboration.current) {
                    downloadText("madi-임시-복구.md", pendingDraft.markdown);
                    notify(
                      "공동 편집 중에는 복구 초안을 다운로드하여 확인한 뒤 필요한 내용을 붙여넣으세요.",
                    );
                    return;
                  }
                  setMarkdown(pendingDraft.markdown);
                  setTitle(pendingDraft.title);
                  setTags(pendingDraft.tags);
                  blockMetadata.current = pendingDraft.block_metadata || {
                    blocks: [],
                  };
                  setPendingDraft(null);
                  setDirty(true);
                  notify("임시 내용을 복구했습니다. 자동 저장으로 이어집니다.");
                }}
              >
                임시 내용 복구
              </Button>
              <Button
                onClick={() => {
                  sessionStorage.removeItem(draftKey(doc.id));
                  setPendingDraft(null);
                }}
              >
                서버 내용 유지
              </Button>
            </div>
          </div>
        </div>
      )}
      {error && <Button onClick={load}>서버 문서 다시 불러오기</Button>}
      {!canWrite && (
        <div className="notice subtle">
          <Eye size={19} />
          <span>
            읽기 전용 문서입니다. 편집 권한이 필요한 경우 문서 소유자에게
            요청하세요.
          </span>
        </div>
      )}
      <div className="document-layout">
        <article className="document-main">
          <div className="doc-cover">
            <span>
              <DocIcon icon={doc.icon} size={38} />
            </span>
            <div className="cover-pattern" />
          </div>
          <div className="document-body">
            <div className="doc-overline">
              <Badge tone={doc.status === "published" ? "green" : ""}>
                {statusNames[doc.status] || doc.status}
              </Badge>
              <span>{date(doc.updated_at)} 업데이트</span>
              <span>버전 {doc.version}</span>
            </div>
            <input
              className="document-title"
              aria-label="문서 제목"
              value={title}
              readOnly={!canWrite}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              placeholder="제목 없는 문서"
            />
            <div className="document-metadata">
              <span>#</span>
              <input
                aria-label="문서 태그"
                value={tags}
                readOnly={!canWrite}
                onChange={(e) => {
                  setTags(e.target.value);
                  setDirty(true);
                }}
                placeholder="태그 추가 (쉼표로 구분)"
              />
              <button
                className="text-button"
                onClick={() => {
                  setVisibility(doc.visibility);
                  setParent(doc.parent_id || "");
                  setAliases((doc.aliases || []).join(", "));
                  setShare(true);
                }}
              >
                {doc.visibility === "private"
                  ? "나만 보기"
                  : doc.visibility === "selected"
                    ? "선택한 사용자"
                    : "워크스페이스 공유"}
              </button>
            </div>
            <div className="editor-mode-bar">
              <div className="segmented">
                {[
                  ["edit", "블록 편집"],
                  ["source", "Markdown"],
                  ["preview", "읽기"],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    className={
                      (mode === "edit" && !canWrite ? "preview" : mode) === v
                        ? "active"
                        : ""
                    }
                    disabled={v === "edit" && !canWrite}
                    onClick={() => switchMode(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div>
                <button
                  className="icon-button"
                  title="집중 모드"
                  aria-label="집중 모드"
                  onClick={() => setFocus(!focus)}
                >
                  <Focus size={18} />
                </button>
                <button
                  className="text-button"
                  aria-label="프레젠테이션 보기"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("madi-document-command", {
                        detail: { action: "present" },
                      }),
                    )
                  }
                >
                  발표
                </button>
                <button
                  className="text-button"
                  aria-label="문서 인쇄 또는 PDF 내보내기"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("madi-document-command", {
                        detail: { action: "print" },
                      }),
                    )
                  }
                >
                  인쇄
                </button>
                <button
                  className="icon-button"
                  title="파일 첨부"
                  aria-label="파일 첨부"
                  disabled={!canWrite}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip size={18} />
                </button>
                <button
                  className="icon-button"
                  title="AI 도우미"
                  aria-label="AI 도우미"
                  onClick={onAI}
                >
                  <Sparkles size={18} />
                </button>
              </div>
            </div>
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload(file);
                e.target.value = "";
              }}
            />
            <div
              className="editor-area"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) e.preventDefault();
              }}
              onDrop={(e) => {
                if (e.dataTransfer.files.length) {
                  e.preventDefault();
                  for (const file of e.dataTransfer.files) upload(file);
                }
              }}
            >
              <DocumentProtection
                key={doc.id}
                documentID={doc.id}
                version={doc.version}
              />
              {mode === "edit" && canWrite ? (
                <BlockEditor
                  key={id}
                  documentId={id!}
                  markdown={markdown}
                  onChange={changeMarkdown}
                  metadata={blockMetadata.current}
                  onMetadata={(v) => {
                    if (activeRoute.current === id) blockMetadata.current = v;
                  }}
                  onProvider={(value) => {
                    const previous = collaboration.current;
                    if (!value && previous?.hasUnsavedChanges) {
                      try {
                        sessionStorage.setItem(
                          draftKey(previous.documentId),
                          JSON.stringify({
                            ...latest.current,
                            block_metadata: blockMetadata.current,
                            saved_at: new Date().toISOString(),
                          }),
                        );
                      } catch {}
                    }
                    collaboration.current = value;
                  }}
                  onSnapshot={collaborationSnapshot}
                />
              ) : mode === "source" ? (
                <>
                  {canWrite && (
                    <div className="notice subtle">
                      Markdown 원문은 버전 충돌 검사를 사용하는 별도 편집
                      모드입니다. 저장하면 다른 공동 편집 세션은 초안을 보관하고
                      새 기준으로 다시 연결합니다.
                    </div>
                  )}
                  {sourceLine > 0 && (
                    <p className="notice subtle">
                      검색 결과 원문 · {sourceLine}번째 줄을 선택했습니다.
                      문서가 변경되었다면 위치가 달라질 수 있습니다.
                    </p>
                  )}
                  <textarea
                    ref={sourceInput}
                    className="markdown-source"
                    aria-label="Markdown 원문 편집"
                    value={markdown}
                    readOnly={!canWrite}
                    onChange={(e) => changeMarkdown(e.target.value)}
                    spellCheck={user.preferences?.spell_check !== false}
                  />
                </>
              ) : (
                <MarkdownView
                  markdown={markdown}
                  documents={documents}
                  metadata={blockMetadata.current}
                />
              )}
            </div>
            <div className="doc-bottom-line">
              <span>{markdown.length.toLocaleString()}자 · Markdown 원본</span>
              <span>Ctrl + S 저장</span>
            </div>
            {publicInfo.approval_enabled && (
              <ApprovalPanel
                key={doc.id}
                resourceID={doc.id}
                revision={doc.version}
                canSubmit={canWrite}
                beforeSubmit={async () => {
                  const current = actionGuard();
                  const ready = !dirty || !!(await save(true));
                  return ready && current();
                }}
                onChanged={load}
              />
            )}
            <AttachmentList
              key={`attachments-${doc.id}`}
              documentID={doc.id}
              revision={attachmentRevision}
            />
            <DiscussionPanel key={doc.id} document={doc} />
          </div>
        </article>
        <aside className="document-aside">
          <section>
            <h3>이 문서에서</h3>
            {headings.length ? (
              headings.map((h) => (
                <button
                  key={h.id}
                  className={`outline-item depth-${h.level}`}
                  onClick={() => {
                    const root = document.querySelector(".editor-area");
                    const found = [
                      ...(root?.querySelectorAll("h1,h2,h3") || []),
                    ].find((el) => el.textContent === h.text);
                    found?.scrollIntoView({
                      behavior: "smooth",
                      block: "center",
                    });
                  }}
                >
                  {h.text}
                </button>
              ))
            ) : (
              <p className="muted small-text">
                제목을 추가하면 목차가 표시됩니다.
              </p>
            )}
          </section>
          <section>
            <h3>
              <Link2 size={16} /> 연결된 문서 <Badge>{backlinks.length}</Badge>
            </h3>
            {backlinks.length ? (
              backlinks.map((d) => (
                <Link
                  className="backlink"
                  key={d.id}
                  to={`/app/documents/${d.id}`}
                >
                  <FileText size={16} />
                  {d.title}
                </Link>
              ))
            ) : (
              <p className="muted small-text">
                이 문서를 참조하는 백링크가 아직 없어요.
              </p>
            )}
            <Link className="text-button" to="/app/graph">
              전체 그래프 보기 →
            </Link>
          </section>
          <section>
            <h3>문서 도구</h3>
            {doc.owner_id === user.id && (
              <PublicShareManager key={doc.id} documentID={doc.id} />
            )}
            <button
              className="aside-action"
              onClick={() => setRAGIndexOpen(true)}
            >
              <Sparkles size={17} /> AI 검색 색인
            </button>
            <Link
              className="aside-action"
              to={`/app/documents/${id}/knowledge`}
            >
              <FileText size={17} /> 문서 운영 속성
            </Link>
            {publicInfo.runbook_enabled && (
              <Link
                className="aside-action"
                to={`/app/documents/${doc.id}/runbook`}
              >
                <Code2 size={17} /> 실행 런북
              </Link>
            )}
            <button
              className="aside-action"
              onClick={async () => {
                const current = actionGuard();
                try {
                  if (dirty && !(await save(true))) return;
                  if (current()) setHistory(true);
                } catch (e) {
                  if (current()) notify((e as Error).message, "error");
                }
              }}
            >
              <History size={17} /> 변경 이력
            </button>
            <button
              className="aside-action"
              onClick={() => downloadText(`${title}.md`, markdown)}
            >
              <ArrowDownToLine size={17} /> Markdown 다운로드
            </button>
            <button className="aside-action" onClick={() => window.print()}>
              <FileText size={17} /> 인쇄 / PDF 저장
            </button>
            <button
              className="aside-action"
              disabled={!canWrite || actionBusy}
              onClick={async () => {
                if (actionPending.current) return;
                const current = actionGuard();
                actionPending.current = true;
                setActionBusy(true);
                try {
                  const d = await api<Doc>("/documents", "POST", {
                    workspace_id: doc.workspace_id,
                    title: title + " (복사)",
                    markdown,
                    tags: doc.tags,
                    visibility: doc.visibility,
                  });
                  if (!current()) return;
                  await reload();
                  if (!current()) return;
                  navigate(`/app/documents/${d.id}`);
                  notify("문서를 복제했습니다.");
                } catch (e) {
                  if (current()) notify((e as Error).message, "error");
                } finally {
                  if (current()) {
                    actionPending.current = false;
                    setActionBusy(false);
                  }
                }
              }}
            >
              <Copy size={17} /> 문서 복제
            </button>
            <button
              className="aside-action danger-text"
              disabled={!canWrite || actionBusy}
              onClick={async () => {
                if (actionPending.current) return;
                if (!window.confirm("이 문서를 휴지통으로 이동할까요?")) return;
                const current = actionGuard();
                actionPending.current = true;
                setActionBusy(true);
                try {
                  await api("/documents/" + id, "DELETE");
                  if (!current()) return;
                  await reload();
                  if (!current()) return;
                  navigate("/app/documents");
                  notify("문서를 휴지통으로 이동했습니다.");
                } catch (e) {
                  if (current()) notify((e as Error).message, "error");
                } finally {
                  if (current()) {
                    actionPending.current = false;
                    setActionBusy(false);
                  }
                }
              }}
            >
              <Trash2 size={17} /> 휴지통으로 이동
            </button>
          </section>
          <div className="document-tip">
            <Sparkles size={20} />
            <strong>지식은 연결될 때 더 빛나요</strong>
            <p>
              <code>[[문서 제목]]</code>으로 다른 문서를 연결해 보세요.
            </p>
          </div>
        </aside>
      </div>
      {history && (
        <Suspense fallback={<Loading />}>
          <DocumentHistory
            key={doc.id}
            documentID={doc.id}
            currentVersion={doc.version}
            canWrite={canWrite}
            documents={documents}
            onClose={() => setHistory(false)}
            onRestored={async () => {
              if (activeRoute.current !== doc.id) return;
              // load() advances the generation synchronously; capture after it.
              const pending = load();
              const current = actionGuard();
              await pending;
              if (!current()) return;
              await reload();
              if (current())
                notify("이전 버전을 새 문서 버전으로 복원했습니다.");
            }}
          />
        </Suspense>
      )}
      <Modal
        open={share}
        onOpenChange={changeShare}
        title="문서 공유 및 속성"
        description="문서의 공개 범위와 탐색 위치를 설정하세요."
      >
        <Field label="문서 링크">
          <div className="input-with-button">
            <input
              readOnly
              value={window.location.origin + `/app/documents/${id}`}
            />
            <CopyButton
              value={window.location.origin + `/app/documents/${id}`}
            />
          </div>
        </Field>
        <Field label="공개 범위">
          <select
            value={visibility}
            disabled={!canWrite || shareBusy}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="private">개인 문서 · 나만 보기</option>
            <option value="workspace">워크스페이스 멤버</option>
            <option value="selected">선택한 사용자</option>
          </select>
        </Field>
        <Field label="상위 문서">
          <select
            disabled={!canWrite || shareBusy}
            value={parent}
            onChange={(e) => setParent(e.target.value)}
          >
            <option value="">최상위 문서</option>
            {documents
              .filter((d) => d.id !== id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
          </select>
        </Field>
        <Field
          label="문서 별칭"
          hint="이전 문서명 등을 쉼표로 구분해 입력하세요."
        >
          <input
            readOnly={!canWrite}
            disabled={shareBusy}
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
          />
        </Field>
        {visibility === "selected" && canWrite && (
          <div className="sharing-users">
            <Field label="공유할 사용자 이메일">
              <input
                type="email"
                disabled={shareBusy}
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
              />
            </Field>
            <Field label="공유 권한">
              <select
                disabled={shareBusy}
                value={shareRole}
                onChange={(e) => setShareRole(e.target.value)}
              >
                <option value="viewer">읽기</option>
                <option value="editor">편집</option>
              </select>
            </Field>
            <Button
              disabled={!shareEmail || shareBusy}
              onClick={async () => {
                if (sharePending.current) return;
                const current = actionGuard(),
                  revision = shareRevision.current;
                const currentModal = () =>
                  current() && revision === shareRevision.current;
                sharePending.current = true;
                setShareBusy(true);
                try {
                  await api(`/documents/${id}/shares`, "POST", {
                    email: shareEmail,
                    role: shareRole,
                  });
                  if (!currentModal()) return;
                  const sequence = ++shareReadSequence.current;
                  const result = await api(`/documents/${id}/shares`);
                  if (!currentModal() || sequence !== shareReadSequence.current)
                    return;
                  setShares(result);
                  setShareEmail("");
                  notify("사용자 공유를 추가했습니다.");
                } catch (e) {
                  if (currentModal()) notify((e as Error).message, "error");
                } finally {
                  if (current()) {
                    sharePending.current = false;
                    setShareBusy(false);
                  }
                }
              }}
            >
              공유 사용자 추가
            </Button>
            {shares.map((s) => (
              <p key={s.user_id || s.id}>
                {s.name || s.email} · {s.role === "editor" ? "편집" : "읽기"}
              </p>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <Button onClick={() => changeShare(false)}>취소</Button>
          <Button
            variant="primary"
            disabled={!canWrite || shareBusy}
            onClick={async () => {
              if (sharePending.current) return;
              const current = actionGuard(),
                revision = shareRevision.current;
              const currentModal = () =>
                current() && revision === shareRevision.current;
              const previous = currentDocument.current;
              if (!previous || previous.id !== id) return;
              // This request changes properties only: use the last canonical
              // body as the baseline so unsaved editor text is never discarded.
              const snapshot = {
                title: previous.title,
                markdown: previous.markdown,
                tags: (previous.tags || []).join(", "),
              };
              sharePending.current = true;
              setShareBusy(true);
              try {
                const d = await api<
                  Doc & { protection?: { changed?: boolean } }
                >(`/documents/${id}`, "PUT", {
                  version: previous.version,
                  visibility,
                  parent_id: parent || null,
                  aliases: aliases
                    .split(",")
                    .map((a) => a.trim())
                    .filter(Boolean),
                });
                if (!current()) return;
                const existing = currentDocument.current;
                const canonical =
                  existing?.id === d.id && existing.version > d.version
                    ? existing
                    : d;
                const reconciled = reconcileSavedDocument(
                  snapshot,
                  latest.current,
                  canonical,
                  !!collaboration.current?.hasUnsavedChanges,
                );
                currentDocument.current = canonical;
                latest.current = reconciled.values;
                setDoc(canonical);
                setTitle(reconciled.values.title);
                setMarkdown(reconciled.values.markdown);
                setTags(reconciled.values.tags);
                if (reconciled.applyMetadata)
                  blockMetadata.current = canonical.block_metadata || {
                    blocks: [],
                  };
                setDirty(reconciled.dirty);
                await reload();
                if (!currentModal()) return;
                changeShare(false);
                notify(
                  d.protection?.changed
                    ? "문서 속성을 저장하고 보안 정책에 따라 저장본을 마스킹했습니다."
                    : "문서 속성을 저장했습니다.",
                );
              } catch (e) {
                if (currentModal()) notify((e as Error).message, "error");
              } finally {
                if (current()) {
                  sharePending.current = false;
                  setShareBusy(false);
                }
              }
            }}
          >
            설정 저장
          </Button>
        </div>
      </Modal>
    </div>
  );
}
