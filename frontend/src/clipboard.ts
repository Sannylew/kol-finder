// 复制文本到剪贴板。
// navigator.clipboard 仅在安全上下文（HTTPS / localhost）可用，
// 通过 http://服务器IP 访问时会缺失，这里降级到 execCommand 兜底。
export function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.setAttribute("readonly", "");
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("copy failed"));
    } catch (err) {
      reject(err);
    }
  });
}
