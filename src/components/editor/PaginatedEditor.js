import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import ImageExt from "@tiptap/extension-image";
import LinkExt from "@tiptap/extension-link";
import { Table as TableExt } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import UnderlineExt from "@tiptap/extension-underline";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMSerializer } from "@tiptap/pm/model";
import { FontSize } from "../../extensions/FontSize";
import Toolbar from "./Toolbar";
import { useEffect, useRef, useState, useCallback } from "react";
import "./PaginatedEditor.scss";

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

export const API_BASE_URL = "https://localhost:7094/api";
export const PAGE_BREAK_SEP = "\u00b6PAGE_BREAK\u00b6";

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (
    options.body != null &&
    typeof options.body === "string" &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText || String(res.status));
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  const text = await res.text();
  return text || null;
}

export const listEditorDocs = (search) =>
  apiFetch(`/Editor${search ? `?search=${encodeURIComponent(search)}` : ""}`);
export const getEditorDoc = (id) =>
  apiFetch(`/Editor/${encodeURIComponent(id)}`);
export const createEditorDoc = (body) =>
  apiFetch(`/Editor`, { method: "POST", body: JSON.stringify(body) });
export const updateEditorDoc = (id, body) =>
  apiFetch(`/Editor/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
export const deleteEditorDoc = (id) =>
  apiFetch(`/Editor/${encodeURIComponent(id)}`, { method: "DELETE" });

export async function uploadEditorImage(file, docId) {
  const formData = new FormData();
  formData.append("file", file);
  const qs = docId ? `?docId=${encodeURIComponent(docId)}` : "";
  const res = await fetch(`${API_BASE_URL}/Editor/upload-image${qs}`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText || String(res.status));
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Page layout constants
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const PADDING_TOP = 96;
const PADDING_BOTTOM = 96;
const PADDING_X = 96;
const CONTENT_HEIGHT = PAGE_HEIGHT - PADDING_TOP - PADDING_BOTTOM; // 931
const PAGE_GAP = 40;
const PAGE_BREAK_SPACER = PAGE_GAP + PADDING_TOP + PADDING_BOTTOM; // 232

// ─────────────────────────────────────────────────────────────────────────────
// Pagination ProseMirror plugin
// ─────────────────────────────────────────────────────────────────────────────

const paginationPluginKey = new PluginKey("pagination-breaks");

/**
 * Each break now carries its own spacerHeight so atomic blocks
 * (images, tables, hr) that straddle a boundary get a taller spacer
 * that pushes them fully onto the next page.
 *
 * @typedef {{ position: number, spacerHeight: number }} PageBreakMarker
 */

const areBreaksEqual = (left, right) =>
  left.length === right.length &&
  left.every(
    (v, i) =>
      v.position === right[i]?.position &&
      Math.abs(v.spacerHeight - right[i].spacerHeight) < 1,
  );

const createPageBreakDecorations = (doc, breaks) =>
  DecorationSet.create(
    doc,
    breaks.map((pageBreak, index) =>
      Decoration.widget(
        pageBreak.position,
        () => {
          const el = document.createElement("span");
          el.dataset.pageBreakWidget = "true";
          el.contentEditable = "false";
          el.className = "page-break-widget";
          el.style.height = `${pageBreak.spacerHeight}px`;
          return el;
        },
        {
          key: `page-break-${index}-${pageBreak.position}-${Math.round(pageBreak.spacerHeight)}`,
          side: -1,
        },
      ),
    ),
  );

const paginationPlugin = new Plugin({
  key: paginationPluginKey,
  state: {
    init: (_, state) => createPageBreakDecorations(state.doc, []),
    apply: (tr, decorationSet, _, newState) => {
      const next = tr.getMeta(paginationPluginKey);
      if (next !== undefined)
        return createPageBreakDecorations(newState.doc, next);
      return tr.docChanged
        ? decorationSet.map(tr.mapping, tr.doc)
        : decorationSet;
    },
  },
  props: { decorations: (state) => paginationPluginKey.getState(state) },
});

// ─────────────────────────────────────────────────────────────────────────────
// getPageHTMLChunks  (unchanged — uses positions only)
// ─────────────────────────────────────────────────────────────────────────────

function getPageHTMLChunks(editorView, pageBreaks) {
  // pageBreaks is now PageBreakMarker[]; extract positions for slicing
  const positions = pageBreaks.map((b) => b.position);
  const {
    state: { doc, schema },
  } = editorView;
  const docSize = doc.content.size;
  const boundaries = [0, ...positions, docSize];
  const serializer = DOMSerializer.fromSchema(schema);
  const chunks = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i];
    const to = boundaries[i + 1];
    if (from >= to) {
      chunks.push("");
      continue;
    }
    const container = document.createElement("div");
    container.appendChild(
      serializer.serializeFragment(doc.slice(from, to).content),
    );
    chunks.push(container.innerHTML);
  }
  while (chunks.length > 1 && chunks[chunks.length - 1].trim() === "")
    chunks.pop();
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// DocumentSidebar  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const DocumentSidebar = ({
  isOpen,
  onToggle,
  activeDocId,
  onSelectDoc,
  onNewDoc,
}) => {
  const [docs, setDocs] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchDocs = useCallback(async (q = "") => {
    setLoading(true);
    setError("");
    try {
      const result = await listEditorDocs(q || undefined);
      setDocs(Array.isArray(result) ? result : []);
    } catch {
      setError("Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchDocs(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => fetchDocs(search), 300);
    return () => clearTimeout(t);
  }, [search, isOpen, fetchDocs]);

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr);
      if (isNaN(d)) return "—";
      const now = new Date();
      const diff = (now - d) / 1000;
      if (diff < 60) return "Just now";
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "—";
    }
  };

  const getInitials = (title) => {
    if (!title) return "?";
    return title
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("");
  };

  return (
    <>
      <div
        className="sidebar"
        style={{ width: isOpen ? 260 : 0, minWidth: isOpen ? 260 : 0 }}
      >
        {isOpen && (
          <>
            <div className="sidebar__header">
              <div className="sidebar__header-left">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  className="sidebar__icon"
                >
                  <rect
                    x="2"
                    y="4"
                    width="12"
                    height="10"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    fill="none"
                  />
                  <path
                    d="M4 4V3a1 1 0 011-1h6a1 1 0 011 1v1"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                  <path
                    d="M5 8h6M5 11h4"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="sidebar__title">Documents</span>
              </div>
              <div className="sidebar__header-actions">
                <button
                  type="button"
                  title="New document"
                  onClick={onNewDoc}
                  className="sidebar__icon-btn"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M7 2v10M2 7h10"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  title="Refresh"
                  onClick={() => fetchDocs(search)}
                  className="sidebar__icon-btn"
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path
                      d="M11 6.5A4.5 4.5 0 112 6.5"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                    <path
                      d="M11 3.5V6.5H8"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  title="Close sidebar"
                  onClick={onToggle}
                  className="sidebar__icon-btn"
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path
                      d="M2 2l9 9M11 2l-9 9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div className="sidebar__search-wrap">
              <div className="sidebar__search">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  className="sidebar__search-icon"
                >
                  <circle
                    cx="5.5"
                    cy="5.5"
                    r="3.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                  <path
                    d="M8.5 8.5l2.5 2.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search documents…"
                  className="sidebar__search-input"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="sidebar__search-clear"
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <path
                        d="M1 1l9 9M10 1l-9 9"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div className="sidebar__list">
              {loading && (
                <div className="sidebar__loading">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    className="sidebar__spinner"
                  >
                    <circle
                      cx="7"
                      cy="7"
                      r="5.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeDasharray="16 18"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="sidebar__loading-text">Loading…</span>
                </div>
              )}
              {!loading && error && (
                <div className="sidebar__error">{error}</div>
              )}
              {!loading && !error && docs.length === 0 && (
                <div className="sidebar__empty">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 32 32"
                    fill="none"
                    className="sidebar__empty-icon"
                  >
                    <rect
                      x="6"
                      y="4"
                      width="20"
                      height="24"
                      rx="2"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      fill="none"
                    />
                    <path
                      d="M10 10h12M10 14h12M10 18h8"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                  <p className="sidebar__empty-text">
                    {search ? "No documents found" : "No documents yet"}
                  </p>
                </div>
              )}
              {!loading &&
                !error &&
                docs.map((doc) => {
                  const isActive = String(doc.id) === String(activeDocId);
                  const updatedAt =
                    doc.updatedAt ||
                    doc.updated_at ||
                    doc.lastModified ||
                    doc.modifiedAt;
                  const title = doc.title || "Untitled Document";
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => onSelectDoc(doc.id)}
                      className={`sidebar__doc-item${isActive ? " sidebar__doc-item--active" : ""}`}
                    >
                      <div
                        className={`sidebar__doc-avatar${isActive ? " sidebar__doc-avatar--active" : ""}`}
                      >
                        {getInitials(title)}
                      </div>
                      <div className="sidebar__doc-info">
                        <p
                          className={`sidebar__doc-title${isActive ? " sidebar__doc-title--active" : ""}`}
                        >
                          {title}
                        </p>
                        <p className="sidebar__doc-date">
                          {formatDate(updatedAt)}
                        </p>
                      </div>
                      {isActive && <div className="sidebar__doc-dot" />}
                    </button>
                  );
                })}
            </div>

            {!loading && docs.length > 0 && (
              <div className="sidebar__footer">
                <p className="sidebar__footer-text">
                  {docs.length} document{docs.length !== 1 ? "s" : ""}
                  {search ? ` matching "${search}"` : ""}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {!isOpen && (
        <button
          type="button"
          title="Open sidebar"
          onClick={onToggle}
          className="sidebar__collapsed-btn"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            className="sidebar__collapsed-icon"
          >
            <rect
              x="1.5"
              y="3"
              width="12"
              height="9"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
            <path d="M5 3v9" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      )}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TableContextMenu  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const TableContextMenu = ({ x, y, td, table, onClose }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({
        x: x + r.width > window.innerWidth ? x - r.width : x,
        y: y + r.height > window.innerHeight ? y - r.height : y,
      });
    }
  }, [x, y]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const getInfo = () => {
    const row = td.closest("tr");
    const tbody = row.parentElement;
    const rows = Array.from(tbody.rows);
    const rowIdx = rows.indexOf(row);
    const colIdx = Array.from(row.cells).indexOf(td);
    const colCount = rows[0]?.cells.length || 1;
    return { row, tbody, rows, rowIdx, colIdx, colCount };
  };

  const makeCell = (isHeader = false) => {
    const cell = document.createElement(isHeader ? "th" : "td");
    cell.style.cssText = isHeader
      ? "border:1px solid hsl(var(--border));padding:6px 10px;min-width:40px;vertical-align:top;background:hsl(var(--muted));font-weight:600;"
      : "border:1px solid hsl(var(--border));padding:6px 10px;min-width:40px;vertical-align:top;";
    cell.innerHTML = "&nbsp;";
    return cell;
  };

  const act = (fn) => {
    fn();
    onClose();
  };

  const actions = {
    insertRowAbove: () => {
      const { tbody, rowIdx, colCount } = getInfo();
      const r = tbody.insertRow(rowIdx);
      for (let i = 0; i < colCount; i++) r.appendChild(makeCell());
    },
    insertRowBelow: () => {
      const { tbody, rowIdx, colCount } = getInfo();
      const r = tbody.insertRow(rowIdx + 1);
      for (let i = 0; i < colCount; i++) r.appendChild(makeCell());
    },
    deleteRow: () => {
      const { tbody, rows, rowIdx } = getInfo();
      if (rows.length <= 1) { table.remove(); return; }
      tbody.deleteRow(rowIdx);
    },
    insertColLeft: () => {
      const { rows, colIdx } = getInfo();
      rows.forEach((r, ri) => {
        const c = makeCell(ri === 0 && r.cells[0]?.tagName === "TH");
        r.insertBefore(c, r.cells[colIdx]);
      });
    },
    insertColRight: () => {
      const { rows, colIdx } = getInfo();
      rows.forEach((r, ri) => {
        const c = makeCell(ri === 0 && r.cells[0]?.tagName === "TH");
        const ref2 = r.cells[colIdx + 1];
        ref2 ? r.insertBefore(c, ref2) : r.appendChild(c);
      });
    },
    deleteCol: () => {
      const { rows, colIdx, colCount } = getInfo();
      if (colCount <= 1) { table.remove(); return; }
      rows.forEach((r) => { if (r.cells[colIdx]) r.deleteCell(colIdx); });
    },
    toggleHeader: () => {
      const { rows } = getInfo();
      const first = rows[0];
      if (!first) return;
      const isH = first.cells[0]?.tagName === "TH";
      Array.from(first.cells).forEach((c) => {
        const n = makeCell(!isH);
        n.innerHTML = c.innerHTML;
        first.replaceChild(n, c);
      });
    },
    deleteTable: () => table.remove(),
    distributeColumns: () => {
      const { rows, colCount } = getInfo();
      const w = Math.max(40, Math.floor(table.offsetWidth / colCount));
      rows.forEach((r) =>
        Array.from(r.cells).forEach((c) => {
          c.style.width = `${w}px`;
          c.style.minWidth = `${w}px`;
        }),
      );
    },
    distributeRows: () => {
      const { rows } = getInfo();
      const h = Math.max(20, Math.floor(table.offsetHeight / rows.length));
      rows.forEach((r) => { r.style.height = `${h}px`; });
    },
  };

  const BG_COLORS = [
    ["#ffffff", "None"],
    ["#f1f5f9", "Gray"],
    ["#dbeafe", "Blue"],
    ["#dcfce7", "Green"],
    ["#fef9c3", "Yellow"],
    ["#fee2e2", "Red"],
    ["#ede9fe", "Purple"],
  ];

  const MI = ({ label, onClick, danger }) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`ctx-menu__item${danger ? " ctx-menu__item--danger" : ""}`}
    >
      {label}
    </button>
  );
  const Hd = ({ t }) => <div className="ctx-menu__heading">{t}</div>;
  const Div = () => <div className="ctx-menu__divider" />;

  return (
    <div ref={ref} className="ctx-menu" style={{ top: pos.y, left: pos.x }}>
      <Hd t="Rows" />
      <MI label="Insert row above" onClick={() => act(actions.insertRowAbove)} />
      <MI label="Insert row below" onClick={() => act(actions.insertRowBelow)} />
      <MI label="Delete row" onClick={() => act(actions.deleteRow)} danger />
      <Div />
      <Hd t="Columns" />
      <MI label="Insert column left" onClick={() => act(actions.insertColLeft)} />
      <MI label="Insert column right" onClick={() => act(actions.insertColRight)} />
      <MI label="Delete column" onClick={() => act(actions.deleteCol)} danger />
      <Div />
      <Hd t="Distribute" />
      <MI label="Distribute columns evenly" onClick={() => act(actions.distributeColumns)} />
      <MI label="Distribute rows evenly" onClick={() => act(actions.distributeRows)} />
      <Div />
      <Hd t="Cell background" />
      <div className="ctx-menu__colors">
        {BG_COLORS.map(([color, name]) => (
          <button
            key={color}
            type="button"
            title={name}
            className="ctx-menu__color-swatch"
            style={{ background: color }}
            onMouseDown={(e) => {
              e.preventDefault();
              td.style.backgroundColor = color === "#ffffff" ? "" : color;
              onClose();
            }}
          />
        ))}
      </div>
      <Div />
      <Hd t="Table" />
      <MI label="Toggle header row" onClick={() => act(actions.toggleHeader)} />
      <MI label="Delete table" onClick={() => act(actions.deleteTable)} danger />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// StatusBadge  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const StatusBadge = ({ status }) => {
  const map = {
    idle:    { label: "Saved",    cls: "status-badge--saved"   },
    saving:  { label: "Saving…",  cls: "status-badge--saving"  },
    error:   { label: "Error",    cls: "status-badge--error"   },
    loading: { label: "Loading…", cls: "status-badge--loading" },
    unsaved: { label: "Unsaved",  cls: "status-badge--unsaved" },
  };
  const { label, cls } = map[status] || map.idle;
  return <span className={`status-badge ${cls}`}>{label}</span>;
};

// ─────────────────────────────────────────────────────────────────────────────
// PaginatedEditor  (main export)
// ─────────────────────────────────────────────────────────────────────────────

const PaginatedEditor = ({ docId: initialDocId = null }) => {
  const [pageCount, setPageCount] = useState(1);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [docId, setDocId] = useState(initialDocId);
  const [docTitle, setDocTitle] = useState("Untitled Document");
  const [errorMsg, setErrorMsg] = useState("");
  const [contextMenu, setContextMenu] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // pageBreaksRef now holds PageBreakMarker[] ({ position, spacerHeight })
  const pageBreaksRef = useRef([]);
  const rafRef = useRef(null);
  const isCalculatingRef = useRef(false);
  const pluginRegisteredRef = useRef(false);
  const editorAreaRef = useRef(null);
  const saveTimerRef = useRef(null);
  const docIdRef = useRef(docId);
  const zoomRef = useRef(zoom);

  useEffect(() => { docIdRef.current = docId; }, [docId]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // ── Editor ────────────────────────────────────────────────────────────────

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      FontSize,
      Highlight.configure({ multicolor: true }),
      ImageExt.configure({ inline: false, allowBase64: true }),
      LinkExt.configure({ openOnClick: false }),
      TableExt.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      UnderlineExt,
    ],
    content: `<p></p>`,
    onUpdate: () => {
      setSaveStatus("unsaved");
      scheduleSave();
    },
  });

  // ── Load document ─────────────────────────────────────────────────────────

  const loadDocument = useCallback(
    async (id) => {
      if (!id || !editor) return;
      setSaveStatus("loading");
      setErrorMsg("");
      try {
        const doc = await getEditorDoc(id);
        setDocTitle(doc.title || "Untitled Document");
        const html = (doc.content || "").split(PAGE_BREAK_SEP).join("");
        editor.commands.setContent(html || "<p></p>", false);
        setSaveStatus("idle");
      } catch (err) {
        setErrorMsg(`Load failed: ${err.message}`);
        setSaveStatus("error");
      }
    },
    [editor],
  );

  useEffect(() => {
    if (initialDocId && editor) loadDocument(initialDocId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDocId, editor]);

  // ── Sidebar actions ───────────────────────────────────────────────────────

  const handleSelectDoc = useCallback(
    async (id) => {
      if (docIdRef.current && saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        (async () => {
          try { await saveDocumentImmediate(); } catch { /* noop */ }
        })();
      }
      setDocId(id);
      await loadDocument(id);
    },
    [loadDocument], // saveDocumentImmediate added below via ref to avoid cycle
  );

  const handleNewDoc = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setDocId(null);
    setDocTitle("Untitled Document");
    setSaveStatus("idle");
    setErrorMsg("");
    editor?.commands.setContent("<p></p>", false);
  }, [editor]);

  // ── Auto-save ─────────────────────────────────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveDocument(), 1500);
  }, []);

  // ── Save ──────────────────────────────────────────────────────────────────

  const saveDocumentImmediate = useCallback(async () => {
    if (!editor) return;
    let content;
    if (editor.view && pageBreaksRef.current.length > 0) {
      const chunks = getPageHTMLChunks(editor.view, pageBreaksRef.current);
      content = chunks.join(PAGE_BREAK_SEP);
    } else {
      content = editor.getHTML();
    }
    const body = { title: docTitle, content };
    const currentId = docIdRef.current;
    if (currentId) {
      await updateEditorDoc(currentId, body);
    } else {
      const created = await createEditorDoc(body);
      const newId = created?.id ?? created;
      setDocId(newId);
    }
  }, [editor, docTitle]);

  const saveDocument = useCallback(async () => {
    if (!editor) return;
    setSaveStatus("saving");
    setErrorMsg("");
    try {
      await saveDocumentImmediate();
      setSaveStatus("idle");
    } catch (err) {
      setErrorMsg(`Save failed: ${err.message}`);
      setSaveStatus("error");
    }
  }, [editor, saveDocumentImmediate]);

  // ── Print ─────────────────────────────────────────────────────────────────

  const handlePrint = useCallback(() => {
    if (!editor) return;
    const chunks = getPageHTMLChunks(editor.view, pageBreaksRef.current);
    const totalPages = chunks.length;
    const pagesHTML = chunks
      .map(
        (html, i) => `
<div class="page${i === totalPages - 1 ? " page-last" : ""}">
  <div class="page-content">${html}</div>
  <div class="page-number">Page ${i + 1} of ${totalPages}</div>
</div>`,
      )
      .join("\n");

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setErrorMsg("Pop-up blocked — please allow pop-ups for this site and try again.");
      return;
    }

    printWindow.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${docTitle}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #e5e7eb; font-family: 'Times New Roman', Georgia, serif; font-size: 12pt; line-height: 1.6; color: #000; }
.page { position: relative; width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; margin: 0 auto 40px auto; background: #fff; overflow: hidden; box-shadow: 0 1px 10px rgba(0,0,0,0.08); }
.page-content { position: absolute; top: ${PADDING_TOP}px; left: ${PADDING_X}px; right: ${PADDING_X}px; bottom: ${PADDING_BOTTOM}px; overflow: hidden; word-break: break-word; }
.page-number { position: absolute; bottom: 28px; left: 0; right: 0; text-align: center; font-size: 9pt; color: #888; }
.page-content mark { padding: 0.1em 0.2em; border-radius: 2px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page-content p { margin: 0 0 0.3em 0; }
.page-content h1 { font-size: 2em; font-weight: 700; margin: 0.5em 0; }
.page-content h2 { font-size: 1.5em; font-weight: 700; margin: 0.5em 0; }
.page-content h3 { font-size: 1.17em; font-weight: 700; margin: 0.5em 0; }
.page-content h4, .page-content h5, .page-content h6 { font-weight: 700; margin: 0.5em 0; }
.page-content img { max-width: 100%; height: auto; margin: 8px 0; }
.page-content a { color: #1a56db; text-decoration: underline; }
.page-content ul, .page-content ol { padding-left: 1.5em; margin: 0.3em 0; }
.page-content li { margin: 0.1em 0; }
.page-content blockquote { border-left: 3px solid #ccc; padding-left: 1em; margin: 0.3em 0; color: #555; }
.page-content table { border-collapse: collapse; width: 100%; margin: 8px 0; }
.page-content th, .page-content td { border: 1px solid #ccc; padding: 6px 10px; min-width: 50px; vertical-align: top; }
.page-content th { background: #f5f5f5; font-weight: 600; }
.page-content hr { border: none; border-top: 1px solid #ddd; margin: 1em 0; }
.page-content [style*="text-align: left"]    { text-align: left; }
.page-content [style*="text-align: center"]  { text-align: center; }
.page-content [style*="text-align: right"]   { text-align: right; }
.page-content [style*="text-align: justify"] { text-align: justify; }
@media print {
  html, body { background: #fff; margin: 0; padding: 0; }
  .page { position: relative; width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; overflow: hidden; margin: 0 auto; box-shadow: none; background: #fff; page-break-after: always; break-after: page; }
  .page.page-last, .page:last-child { page-break-after: avoid; break-after: avoid; }
  .page-content { position: absolute; top: ${PADDING_TOP}px; left: ${PADDING_X}px; right: ${PADDING_X}px; bottom: ${PADDING_BOTTOM}px; overflow: hidden; }
  .page-number { position: absolute; bottom: 28px; left: 0; right: 0; text-align: center; font-size: 9pt; color: #888; }
  @page { size: ${PAGE_WIDTH}px ${PAGE_HEIGHT}px; margin: 0; }
}
</style></head><body>${pagesHTML}</body></html>`);

    printWindow.document.close();
    printWindow.focus();
    const triggerPrint = () => {
      setTimeout(() => {
        printWindow.print();
        printWindow.addEventListener("afterprint", () => printWindow.close(), { once: true });
      }, 400);
    };
    if (printWindow.document.readyState === "complete") triggerPrint();
    else printWindow.onload = triggerPrint;
  }, [editor, docTitle]);

  // ── Ctrl+S / Cmd+S ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveDocument();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveDocument]);

  // ── Image upload ──────────────────────────────────────────────────────────

  const handleImageUpload = useCallback(
    async (file) => {
      if (!editor) return;
      setErrorMsg("");
      const reader = new FileReader();
      reader.onload = () => {
        editor.chain().focus().setImage({ src: reader.result }).run();
      };
      reader.readAsDataURL(file);
      try {
        const result = await uploadEditorImage(file, docIdRef.current);
        const serverUrl = result?.url || result?.imageUrl || result;
        if (serverUrl && typeof serverUrl === "string") {
          editor.view.state.doc.descendants((node, pos) => {
            if (node.type.name === "image" && node.attrs.src?.startsWith("data:")) {
              const tr = editor.state.tr.setNodeMarkup(pos, null, {
                ...node.attrs,
                src: serverUrl,
              });
              editor.view.dispatch(tr);
              return false;
            }
          });
        }
      } catch (err) {
        setErrorMsg(`Image upload failed: ${err.message}`);
      }
    },
    [editor],
  );

  // ── Table right-click ─────────────────────────────────────────────────────

  useEffect(() => {
    const host = editorAreaRef.current;
    if (!host) return;
    const handleContextMenu = (e) => {
      const td = e.target.closest("td, th");
      const table = e.target.closest("table");
      if (!td || !table) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, td, table });
    };
    host.addEventListener("contextmenu", handleContextMenu);
    return () => host.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // PAGINATION ENGINE  — improved DOM-walking approach
  //
  // Key improvements over the old version:
  //   • Each PageBreakMarker carries its own spacerHeight (not a fixed value).
  //   • Atomic blocks (img, table, hr, figure) that cross a page boundary are
  //     pushed to the next page; the spacer is grown to cover the portion of
  //     the block that was already visible above the boundary.
  //   • Text blocks are split mid-paragraph via posAtCoords (multiple x probes).
  //   • Comparison uses areBreaksEqual() so tiny float differences don't cause
  //     unnecessary re-dispatches.
  // ─────────────────────────────────────────────────────────────────────────

  /** Apply a new set of PageBreakMarkers to the ProseMirror plugin. */
  const applyBreaks = useCallback(
    (breaks) => {
      if (!editor || !pluginRegisteredRef.current) return;

      // Deduplicate by position and sort ascending
      const sanitized = breaks
        .slice()
        .sort((a, b) => a.position - b.position)
        .filter(
          (b, i, arr) => i === 0 || b.position !== arr[i - 1].position,
        );

      setPageCount(Math.max(1, sanitized.length + 1));

      if (areBreaksEqual(pageBreaksRef.current, sanitized)) return;

      pageBreaksRef.current = sanitized;
      editor.view.dispatch(
        editor.state.tr.setMeta(paginationPluginKey, sanitized),
      );
    },
    [editor],
  );

  /**
   * Find the best ProseMirror position to insert a page break at `boundaryOffset`
   * pixels from the top of the tiptap element.
   *
   * Strategy (mirrors the first snippet):
   *  1. Walk top-level blocks.
   *  2. If a block fits fully above the boundary → skip.
   *  3. If a block starts at or below the boundary → break just before it.
   *  4. If a block crosses the boundary:
   *     a. Atomic (img / table / hr / figure) → push whole block to next page,
   *        grow spacerHeight by the overlap.
   *     b. Text block → try posAtCoords at several x positions near the boundary;
   *        fall back to breaking before the block.
   *
   * @param {number} boundaryOffset - pixels from top of tiptap element
   * @param {HTMLElement} tiptap
   * @param {number|null} previousBreakPos - last inserted break position
   * @returns {{ position: number, spacerHeight: number } | null}
   */
  const findBreakPosition = useCallback(
    (boundaryOffset, tiptap, previousBreakPos) => {
      if (!editor) return null;

      const rect = tiptap.getBoundingClientRect();
      const docSize = editor.state.doc.content.size;
      const minPos = previousBreakPos === null ? 1 : previousBreakPos + 1;
      const boundaryTop = rect.top + boundaryOffset; // absolute screen Y

      const children = Array.from(tiptap.children).filter(
        (child) =>
          child instanceof HTMLElement &&
          child.dataset.pageBreakWidget !== "true",
      );

      for (const child of children) {
        const childRect = child.getBoundingClientRect();
        // Positions relative to the tiptap container top
        const childTop = childRect.top - rect.top;
        const childBottom = childRect.bottom - rect.top;

        // Block is fully above the boundary → continue
        if (childBottom <= boundaryOffset) continue;

        // Block starts at or below the boundary → break just before it
        if (childTop >= boundaryOffset) {
          try {
            const pos = editor.view.posAtDOM(child, 0) - 1;
            const normalized = Math.max(minPos, Math.min(pos, docSize - 1));
            return normalized >= docSize
              ? null
              : { position: normalized, spacerHeight: PAGE_BREAK_SPACER };
          } catch {
            return null;
          }
        }

        // Block crosses the boundary ─────────────────────────────────────────
        const tag = child.tagName.toLowerCase();
        const isAtomic =
          tag === "img" ||
          tag === "table" ||
          tag === "hr" ||
          tag === "figure" ||
          child.querySelector(":scope > img, :scope > table") !== null;

        if (isAtomic) {
          // Push the whole atomic block to the next page.
          // Grow the spacer by however many pixels of the block were already
          // visible above the boundary so the block lands cleanly at the top
          // of the next page.
          try {
            const pos = editor.view.posAtDOM(child, 0) - 1;
            const normalized = Math.max(minPos, Math.min(pos, docSize - 1));
            return normalized >= docSize
              ? null
              : {
                  position: normalized,
                  spacerHeight:
                    PAGE_BREAK_SPACER + Math.max(0, boundaryOffset - childTop),
                };
          } catch {
            return null;
          }
        }

        // Text block: probe multiple x positions at the boundary row
        const xProbes = [
          rect.left + 2,
          rect.left + rect.width * 0.2,
          rect.left + rect.width * 0.5,
          rect.right - 2,
        ];

        for (const screenX of xProbes) {
          const hit = editor.view.posAtCoords({
            left: Math.round(screenX),
            top: Math.round(boundaryTop + 2), // +2px nudge below the line
          });
          if (!hit) continue;
          const normalized = Math.max(minPos, Math.min(hit.pos, docSize - 1));
          if (normalized >= docSize) continue;
          return { position: normalized, spacerHeight: PAGE_BREAK_SPACER };
        }

        // Fallback: break before the crossing text block
        try {
          const pos = editor.view.posAtDOM(child, 0) - 1;
          const normalized = Math.max(minPos, Math.min(pos, docSize - 1));
          return normalized >= docSize
            ? null
            : {
                position: normalized,
                spacerHeight:
                  PAGE_BREAK_SPACER + Math.max(0, boundaryOffset - childTop),
              };
        } catch {
          return null;
        }
      }

      return null; // No break needed
    },
    [editor],
  );

  /** Recalculate all page breaks from scratch. */
  const calculatePages = useCallback(() => {
    if (!editor || !pluginRegisteredRef.current) return;
    if (isCalculatingRef.current) return;
    isCalculatingRef.current = true;

    const host = editorAreaRef.current;
    const tiptap = host?.querySelector(".tiptap");
    if (!host || !tiptap) {
      isCalculatingRef.current = false;
      return;
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    host.dataset.measuring = "true";

    rafRef.current = requestAnimationFrame(() => {
      const naturalHeight = tiptap.scrollHeight;
      const requiredPages = Math.max(
        1,
        Math.ceil(naturalHeight / CONTENT_HEIGHT),
      );
      const nextBreaks = [];

      for (let pageIndex = 1; pageIndex < requiredPages; pageIndex++) {
        const boundaryOffset = pageIndex * CONTENT_HEIGHT;
        const breakResult = findBreakPosition(
          boundaryOffset,
          tiptap,
          nextBreaks.length > 0
            ? nextBreaks[nextBreaks.length - 1].position
            : null,
        );
        if (breakResult !== null) nextBreaks.push(breakResult);
      }

      host.dataset.measuring = "false";
      applyBreaks(nextBreaks);

      rafRef.current = null;
      setTimeout(() => {
        isCalculatingRef.current = false;
      }, 0);
    });
  }, [applyBreaks, editor, findBreakPosition]);

  // Recalculate when zoom changes
  useEffect(() => {
    if (!editor || !pluginRegisteredRef.current) return;
    const t = setTimeout(() => calculatePages(), 50);
    return () => clearTimeout(t);
  }, [zoom, calculatePages, editor]);

  // Register plugin once
  useEffect(() => {
    if (!editor || pluginRegisteredRef.current) return;
    editor.registerPlugin(paginationPlugin);
    pluginRegisteredRef.current = true;
    calculatePages();
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      editorAreaRef.current?.removeAttribute("data-measuring");
      try {
        editor.unregisterPlugin(paginationPluginKey);
      } catch { /* noop */ }
      pluginRegisteredRef.current = false;
    };
  }, [calculatePages, editor]);

  // Subscribe to editor / DOM changes
  useEffect(() => {
    if (!editor) return;
    const calc = () => calculatePages();
    calc();
    editor.on("update", calc);
    editor.on("create", calc);

    const host = editorAreaRef.current;
    const tiptap = host?.querySelector(".tiptap");
    let resizeTimeout;

    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(calc, 100);
    });
    if (host) ro.observe(host);
    if (tiptap) ro.observe(tiptap);

    const mo = tiptap
      ? new MutationObserver(calc)
      : null;
    mo?.observe(tiptap, { childList: true, subtree: true, characterData: true });

    window.addEventListener("resize", calc);
    void document.fonts?.ready.then(calc).catch(() => undefined);

    return () => {
      ro.disconnect();
      mo?.disconnect();
      window.removeEventListener("resize", calc);
      editor.off("update", calc);
      editor.off("create", calc);
    };
  }, [editor, calculatePages]);

  // ── Layout ────────────────────────────────────────────────────────────────

  const totalPagesHeight = pageCount * PAGE_HEIGHT + (pageCount - 1) * PAGE_GAP;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="pe-root">
      {/* Title bar */}
      <div className="pe-titlebar">
        <button
          type="button"
          title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          onClick={() => setSidebarOpen((v) => !v)}
          className="pe-titlebar__sidebar-btn"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
            <path d="M5.5 3v10" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
        <input
          value={docTitle}
          onChange={(e) => { setDocTitle(e.target.value); setSaveStatus("unsaved"); }}
          onBlur={() => scheduleSave()}
          className="pe-titlebar__title-input"
          placeholder="Untitled Document"
          aria-label="Document title"
        />
        <StatusBadge status={saveStatus} />
        <button
          type="button"
          onClick={() => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveDocument();
          }}
          className="pe-titlebar__btn pe-titlebar__btn--primary"
        >
          Save
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className="pe-titlebar__btn pe-titlebar__btn--secondary"
        >
          Print
        </button>
      </div>

      {/* Error banner */}
      {errorMsg && (
        <div className="pe-error-banner">
          <span className="pe-error-banner__text">{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg("")} className="pe-error-banner__close">✕</button>
        </div>
      )}

      {/* Toolbar */}
      <Toolbar editor={editor} onImageUpload={handleImageUpload} zoom={zoom} setZoom={setZoom} />

      {/* Body */}
      <div className="pe-body">
        <DocumentSidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((v) => !v)}
          activeDocId={docId}
          onSelectDoc={handleSelectDoc}
          onNewDoc={handleNewDoc}
        />

        {/* Scrollable canvas */}
        <div className="pe-canvas-scroll">
          <div
            className="pe-canvas-outer"
            style={{ minHeight: totalPagesHeight * (zoom / 100) + 64 }}
          >
            <div
              className="pe-canvas-inner"
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top center",
                width: PAGE_WIDTH,
                minHeight: totalPagesHeight,
              }}
            >
              {/* Page background sheets */}
              {Array.from({ length: pageCount }).map((_, i) => (
                <div
                  key={i}
                  className="pe-page-sheet"
                  style={{
                    width: PAGE_WIDTH,
                    height: PAGE_HEIGHT,
                    top: i * (PAGE_HEIGHT + PAGE_GAP),
                    boxShadow: "0 1px 10px hsl(var(--foreground) / 0.08)",
                  }}
                >
                  <span className="pe-page-sheet__number">
                    Page {i + 1} of {pageCount}
                  </span>
                </div>
              ))}

              {/* Tiptap editor overlay */}
              <div
                ref={editorAreaRef}
                className="doc-editor"
                style={{
                  width: PAGE_WIDTH,
                  minHeight: totalPagesHeight,
                  paddingTop: PADDING_TOP,
                  paddingRight: PADDING_X,
                  paddingBottom: PADDING_BOTTOM,
                  paddingLeft: PADDING_X,
                }}
              >
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Table context menu */}
      {contextMenu && (
        <TableContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          td={contextMenu.td}
          table={contextMenu.table}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export default PaginatedEditor;
