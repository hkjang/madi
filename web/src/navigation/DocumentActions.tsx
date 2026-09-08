import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  Copy,
  Download,
  FolderInput,
  Link2,
  MoreHorizontal,
  Pin,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { api, downloadText, type Doc, type DocSummary } from "../api";
import { useApp } from "../context";
import { Button, ErrorBox, Field, Modal } from "../ui";
import { usePreferenceWriter } from "./preferences";
import { copyText } from "./clipboard";
export function safeIDs(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (id): id is string =>
              typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id),
          ),
        ),
      ].slice(0, 100)
    : [];
}
export function moveCandidates(
  doc: Pick<Doc, "id" | "workspace_id">,
  docs: DocSummary[],
): DocSummary[] {
  const descendants = new Set([doc.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of docs)
      if (
        item.parent_id &&
        descendants.has(item.parent_id) &&
        !descendants.has(item.id)
      ) {
        descendants.add(item.id);
        changed = true;
      }
  }
  return docs.filter(
    (item) =>
      item.workspace_id === doc.workspace_id && !descendants.has(item.id),
  );
}
export function MoveDocumentModal({
  doc,
  close,
}: {
  doc: Doc | null;
  close: () => void;
}) {
  const { documents, reload, notify } = useApp();
  const [parent, setParent] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setParent(doc?.parent_id || "");
    setError("");
  }, [doc?.id]);
  return (
    <Modal
      open={!!doc}
      onOpenChange={(v) => {
        if (!v && !busy) close();
      }}
      title="문서 위치 변경"
      description="문서의 상위 페이지를 선택하세요. 이동 후에는 대상 페이지의 접근 권한도 적용됩니다."
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!doc) return;
          setBusy(true);
          setError("");
          try {
            const fresh = await api<Doc>("/documents/" + doc.id);
            if (!fresh.can_write)
              throw new Error("이 문서를 이동할 권한이 없습니다.");
            await api("/documents/" + doc.id, "PUT", {
              version: fresh.version,
              parent_id: parent || null,
            });
            await reload();
            notify("문서를 이동했습니다.");
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBox error={error} />
        <Field label="상위 문서">
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">워크스페이스 최상위</option>
            {doc &&
              moveCandidates(doc, documents).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
          </select>
        </Field>
        <div className="modal-actions">
          <Button type="button" disabled={busy} onClick={close}>
            취소
          </Button>
          <Button variant="primary" disabled={busy}>
            이동
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export default function DocumentActions({ doc }: { doc: DocSummary }) {
  const { user, setUser, reload, createDocument, notify } = useApp(),
    navigate = useNavigate(),
    location = useLocation();
  const [open, setOpen] = useState(false),
    [fresh, setFresh] = useState<Doc | null>(null),
    [moving, setMoving] = useState<Doc | null>(null),
    [remove, setRemove] = useState(false),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const writePreferences = usePreferenceWriter(),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = trigger.current;
    const open = () => setOpen(true);
    button?.addEventListener("madi-open-context", open);
    return () => button?.removeEventListener("madi-open-context", open);
  }, []);
  const pinned = safeIDs(user.preferences?.pinned_documents);
  useEffect(() => {
    const current = ++generation.current;
    setFresh(null);
    if (open)
      void api<Doc>("/documents/" + doc.id)
        .then((value) => {
          if (generation.current === current) setFresh(value);
        })
        .catch((e) => notify(e.message, "error"));
    return () => {
      generation.current++;
    };
  }, [open, doc.id]);
  const run = (fn: () => Promise<unknown>) =>
    void fn().catch((e) => notify(e.message, "error"));
  return (
    <>
      <Menu.Root open={open} onOpenChange={setOpen}>
        <Menu.Trigger asChild>
          <button
            ref={trigger}
            data-doc-menu
            className="tree-context-trigger"
            aria-label={`${doc.title} 문서 메뉴`}
          >
            <MoreHorizontal size={16} />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            className="navigation-context"
            side="right"
            align="start"
            collisionPadding={10}
          >
            <Menu.Item onSelect={() => navigate("/app/documents/" + doc.id)}>
              <FolderInput size={16} />
              문서 열기
            </Menu.Item>
            <Menu.Item
              onSelect={() =>
                run(async () => {
                  await copyText(locationOrigin() + "/app/documents/" + doc.id);
                  notify("문서 링크를 복사했습니다.");
                })
              }
            >
              <Link2 size={16} />
              링크 복사
            </Menu.Item>
            <Menu.Item
              disabled={!fresh}
              onSelect={() =>
                run(async () => {
                  await api("/documents/" + doc.id + "/favorite", "POST");
                  await reload();
                })
              }
            >
              <Star size={16} />
              {doc.is_favorite ? "즐겨찾기 해제" : "즐겨찾기에 추가"}
            </Menu.Item>
            <Menu.Item
              disabled={!fresh}
              onSelect={() =>
                run(async () => {
                  const next = pinned.includes(doc.id)
                    ? pinned.filter((id) => id !== doc.id)
                    : [...pinned.slice(-39), doc.id];
                  await writePreferences({ pinned_documents: next });
                })
              }
            >
              <Pin size={16} />
              {pinned.includes(doc.id) ? "문서 고정 해제" : "사이드바에 고정"}
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              disabled={!fresh?.can_write}
              onSelect={() => setMoving(fresh)}
            >
              <FolderInput size={16} />
              문서 이동
            </Menu.Item>
            <Menu.Item
              disabled={!fresh?.can_write}
              onSelect={() =>
                run(async () => {
                  const d = await createDocument("제목 없는 문서", "", {
                    parent_id: doc.id,
                  });
                  if (d) navigate("/app/documents/" + d.id);
                })
              }
            >
              <Plus size={16} />
              하위 문서 만들기
            </Menu.Item>
            <Menu.Item
              disabled={!fresh}
              onSelect={() =>
                run(async () => {
                  const current = await api<Doc>("/documents/" + doc.id);
                  const d = await createDocument(
                    current.title + " 사본",
                    current.markdown,
                    {
                      visibility: "private",
                      tags: current.tags,
                      block_metadata: {},
                    },
                  );
                  if (d) navigate("/app/documents/" + d.id);
                })
              }
            >
              <Copy size={16} />
              저장된 문서 복제
            </Menu.Item>
            <Menu.Item
              disabled={!fresh}
              onSelect={() =>
                run(async () => {
                  const current = await api<Doc>("/documents/" + doc.id);
                  downloadText(current.title + ".md", current.markdown);
                })
              }
            >
              <Download size={16} />
              Markdown 내보내기
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              disabled={!fresh?.can_write}
              onSelect={() => setRemove(true)}
            >
              <Trash2 size={16} />
              휴지통으로 이동
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <MoveDocumentModal doc={moving} close={() => setMoving(null)} />
      <Modal
        open={remove}
        onOpenChange={(v) => {
          if (!busy) setRemove(v);
        }}
        title="휴지통으로 이동할까요?"
        description={`‘${doc.title}’ 문서는 휴지통에서 복구할 수 있습니다. 저장하지 않은 편집 내용은 먼저 저장하세요.`}
      >
        <div className="modal-actions">
          <Button disabled={busy} onClick={() => setRemove(false)}>
            취소
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              run(async () => {
                try {
                  await api("/documents/" + doc.id, "DELETE");
                  await reload();
                  setRemove(false);
                  if (location.pathname === "/app/documents/" + doc.id)
                    navigate("/app/trash");
                  notify("문서를 휴지통으로 이동했습니다.");
                } finally {
                  setBusy(false);
                }
              });
            }}
          >
            휴지통으로 이동
          </Button>
        </div>
      </Modal>
    </>
  );
}
function locationOrigin() {
  return window.location.origin;
}
