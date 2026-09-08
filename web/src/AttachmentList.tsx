import { useEffect, useState } from "react";
import { Download, Paperclip } from "lucide-react";
import { api, bytes } from "./api";
import { Button, ErrorBox } from "./ui";
import "./attachments.css";
export default function AttachmentList({
  documentID,
  revision,
}: {
  documentID: string;
  revision: number;
}) {
  const [files, setFiles] = useState<Record<string, any>[]>([]),
    [error, setError] = useState<unknown>(null),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setFiles([]);
    setError(null);
    api<Record<string, any>[]>(`/documents/${documentID}/attachments`)
      .then((rows) => {
        if (active) {
          setFiles(rows);
          setMore(rows.length === 200);
        }
      })
      .catch((e) => {
        if (active) setError(e);
      });
    return () => {
      active = false;
    };
  }, [documentID, revision]);
  if (!files.length && !error) return null;
  return (
    <section className="attachment-index">
      <h3>
        <Paperclip size={17} />
        문서 첨부파일 · {files.length}
        {more ? "+" : ""}개
      </h3>
      <ErrorBox error={error} />
      <ul>
        {files.map((f) => (
          <li key={f.id}>
            <a href={f.url} download={f.name}>
              <Download size={16} />
              <span>{f.name}</span>
              <small>{bytes(f.size)}</small>
            </a>
          </li>
        ))}
      </ul>
      {more && (
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const rows = await api<Record<string, any>[]>(
                `/documents/${documentID}/attachments?after=${files.at(-1)?.id}`,
              );
              setFiles((prev) => [...prev, ...rows]);
              setMore(rows.length === 200);
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          이전 첨부파일 더 보기
        </Button>
      )}
    </section>
  );
}
