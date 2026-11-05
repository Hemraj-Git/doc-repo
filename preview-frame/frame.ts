// Runs inside the sandboxed preview iframe (opaque origin, no network, strict CSP).
// The parent page posts the file bytes; this script renders them. Even if a crafted
// file exploited a renderer, it could not reach the app's session or DOM.
import { renderAsync } from "docx-preview"
import { init as initPptx } from "pptx-preview"
import * as XLSX from "xlsx"

type Kind = "docx" | "sheet" | "pptx"
type RenderMessage = { type: "render"; kind: Kind; fileName: string; buffer: ArrayBuffer }

const MAX_SHEET_ROWS = 2000
const MAX_SHEET_COLS = 60

const root = document.getElementById("root")!

function post(message: Record<string, unknown>) {
  // Opaque-origin frame: the parent identifies us by event.source, not origin.
  window.parent.postMessage({ source: "dms-preview", ...message }, "*")
}

/** Keep links usable but harmless: only http(s)/mailto, always in a new tab. */
function sanitizeLinks(container: HTMLElement) {
  container.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href") ?? ""
    if (/^(https?:|mailto:)/i.test(href)) {
      a.target = "_blank"
      a.rel = "noopener noreferrer"
    } else if (!href.startsWith("#")) {
      a.removeAttribute("href")
    }
  })
}

async function renderDocx(buffer: ArrayBuffer) {
  root.className = "docx-root"
  await renderAsync(buffer, root, undefined, {
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderComments: false,
    renderChanges: false,
    useBase64URL: true,
    experimental: false,
  })
}

function renderSheet(buffer: ArrayBuffer): string | undefined {
  root.className = "sheet-root"
  const wb = XLSX.read(buffer, { type: "array", cellDates: true, sheetRows: MAX_SHEET_ROWS + 1 })
  let truncated = false

  const tabs = document.createElement("div")
  tabs.className = "tabs"
  tabs.setAttribute("role", "tablist")
  const body = document.createElement("div")
  body.className = "sheet"

  const show = (name: string) => {
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.sheet === name)))
    const ws = wb.Sheets[name]!
    const ref = ws["!ref"]
    if (ref) {
      const range = XLSX.utils.decode_range(ref)
      if (range.e.c - range.s.c + 1 > MAX_SHEET_COLS) {
        range.e.c = range.s.c + MAX_SHEET_COLS - 1
        ws["!ref"] = XLSX.utils.encode_range(range)
        truncated = true
      }
      if (range.e.r - range.s.r + 1 > MAX_SHEET_ROWS) truncated = true
    }
    // SheetJS escapes cell text when building the table.
    body.innerHTML = ref ? XLSX.utils.sheet_to_html(ws, { header: "", footer: "" }) : '<p class="empty">This sheet is empty.</p>'
    sanitizeLinks(body)
  }

  wb.SheetNames.forEach((name, i) => {
    const b = document.createElement("button")
    b.type = "button"
    b.textContent = name
    b.dataset.sheet = name
    b.setAttribute("role", "tab")
    b.addEventListener("click", () => show(name))
    if (i === 0) b.setAttribute("aria-selected", "true")
    tabs.appendChild(b)
  })

  if (wb.SheetNames.length > 1) root.appendChild(tabs)
  root.appendChild(body)
  if (wb.SheetNames[0]) show(wb.SheetNames[0])
  return truncated ? `Large sheet: showing the first ${MAX_SHEET_ROWS} rows and ${MAX_SHEET_COLS} columns. Download for the full file.` : undefined
}

async function renderPptx(buffer: ArrayBuffer) {
  root.className = "pptx-root"
  const width = Math.min(960, Math.max(320, root.clientWidth - 32))
  const previewer = initPptx(root, { width, height: Math.round((width * 9) / 16), mode: "list" })
  await previewer.preview(buffer)
  // The renderer resolves even when it could not read any slide (some non-PowerPoint
  // generators); report that instead of showing an empty frame.
  if (!root.querySelector(".pptx-preview-slide-wrapper")) throw new Error("no slides could be read from this file")
}

let started = false

window.addEventListener("message", async (event: MessageEvent<RenderMessage | { type: "hello" }>) => {
  if (event.source !== window.parent) return
  // The parent asks again once the iframe has loaded, in case it missed our first "ready".
  if (event.data?.type === "hello") return void (started || post({ type: "ready" }))
  if (started) return
  const msg = event.data as RenderMessage
  if (!msg || msg.type !== "render" || !(msg.buffer instanceof ArrayBuffer)) return
  started = true
  try {
    let note: string | undefined
    if (msg.kind === "docx") await renderDocx(msg.buffer)
    else if (msg.kind === "sheet") note = renderSheet(msg.buffer)
    else if (msg.kind === "pptx") await renderPptx(msg.buffer)
    else throw new Error("Unsupported preview type")
    sanitizeLinks(root)
    post({ type: "rendered", note })
  } catch (err) {
    root.textContent = ""
    post({ type: "error", message: err instanceof Error ? err.message : String(err) })
  }
})

post({ type: "ready" })
