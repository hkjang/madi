import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "../api";
import "./style.css";
const classes: Record<string, string> = {
  public: "공개",
  internal: "내부",
  confidential: "기밀",
  restricted: "제한",
};
export function DocumentWatermark({
  viewer,
  classification,
  at,
}: {
  viewer: string;
  classification: string;
  at?: string;
}) {
  const [time, setTime] = useState(() => new Date(at || Date.now()));
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  const text = `${viewer} · ${classes[classification] || classification} · ${time.toLocaleString("ko-KR")}`;
  return (
    <div className="protection-watermark" aria-hidden="true">
      {text}
      <br />
      {text}
      <br />
      {text}
    </div>
  );
}
export default function DocumentProtection({
  documentID,
  version,
}: {
  documentID: string;
  version?: number;
}) {
  const [data, setData] = useState<Record<string, any> | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      api<Record<string, any>>(`/documents/${documentID}/protection`)
        .then((v) => {
          if (active) {
            setData(v);
            setError("");
          }
        })
        .catch((e) => {
          if (active) {
            setData(null);
            setError(e.message);
          }
        });
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [documentID, version]);
  if (error)
    return (
      <div className="notice">정보보호 정책을 확인하지 못했습니다: {error}</div>
    );
  if (!data) return null;
  return (
    <>
      <div className="protection-summary">
        <ShieldCheck size={16} />
        <span>상속 적용 등급: {classes[data.classification]}</span>
        {data.watermark && <span>화면·인쇄 워터마크</span>}
        {data.enabled && (
          <span>
            민감정보{" "}
            {
              (
                {
                  warn: "경고",
                  block: "차단",
                  mask: "마스킹",
                  audit: "감사",
                } as Record<string, string>
              )[data.mode]
            }
          </span>
        )}
      </div>
      {data.watermark && (
        <DocumentWatermark
          viewer={data.viewer}
          classification={data.classification}
        />
      )}
    </>
  );
}
