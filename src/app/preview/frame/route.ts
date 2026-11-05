import { randomBytes } from "node:crypto"

// The sandboxed document the Office previews render in. It holds no data of its own:
// the parent posts the file bytes. The CSP allows only our renderer script (by nonce),
// inline styles for the rendered document, and images from the file itself; no network.
export function GET() {
  const nonce = randomBytes(16).toString("base64")
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "img-src blob: data:",
    "font-src data:",
    "base-uri 'none'",
    "form-action 'none'",
    "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
  ].join("; ")

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Preview</title>
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; background: #f4f4f2; color: #0b0b0b; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  #root { min-height: 100vh; }
  .docx-root { padding: 16px 0; }
  .docx-root .docx-wrapper { background: transparent !important; padding: 0 !important; }
  .docx-root .docx-wrapper > section.docx { box-shadow: 0 1px 3px rgba(0,0,0,.12); margin: 0 auto 16px !important; max-width: calc(100% - 24px); }
  .sheet-root { padding: 12px; }
  .tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
  .tabs button { font: inherit; font-size: 13px; padding: 4px 10px; border: 1px solid #d8d7d0; border-radius: 6px; background: #fff; cursor: pointer; }
  .tabs button[aria-selected="true"] { background: #1f3f73; border-color: #1f3f73; color: #fff; }
  .sheet { overflow: auto; background: #fff; border: 1px solid #e1e0d9; border-radius: 8px; max-height: calc(100vh - 80px); }
  .sheet table { border-collapse: collapse; font-size: 13px; }
  .sheet td { border: 1px solid #e8e7e1; padding: 3px 8px; white-space: nowrap; vertical-align: top; }
  .sheet tr:first-child td { background: #f6f6f3; font-weight: 600; position: sticky; top: 0; }
  .empty { padding: 16px; color: #52514e; }
  .pptx-root { padding: 16px; display: flex; justify-content: center; }
  /* The renderer boxes every slide into one fixed-height scroller on black; let slides stack instead. */
  .pptx-root .pptx-preview-wrapper { background: transparent !important; height: auto !important; overflow: visible !important; }
  .pptx-root .pptx-preview-slide-wrapper { box-shadow: 0 1px 3px rgba(0,0,0,.15); margin-bottom: 16px !important; }
</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="/preview/frame.js"></script>
</body>
</html>`

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  })
}
