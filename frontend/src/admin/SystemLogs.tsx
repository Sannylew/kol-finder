import { useEffect, useState } from "react";
import { fetchLogs } from "../api";

export default function SystemLogs() {
  const [lines, setLines] = useState<string[]>([]);
  const [level, setLevel] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  function load() {
    setLoading(true);
    setMsg("");
    fetchLogs(300, level)
      .then((r) => setLines(r.lines))
      .catch(() => setMsg("读取日志失败"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [level]);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>系统日志</h2>
        <div className="select-wrap">
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">全部级别</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="ERROR">ERROR</option>
          </select>
        </div>
      </div>
      {msg && <div className="msg err">{msg}</div>}
      <div className="admin-card">
        {loading ? (
          <p className="hint">读取中…</p>
        ) : lines.length === 0 ? (
          <p className="hint">暂无日志</p>
        ) : (
          <pre className="log-view">{lines.join("\n")}</pre>
        )}
      </div>
    </div>
  );
}
