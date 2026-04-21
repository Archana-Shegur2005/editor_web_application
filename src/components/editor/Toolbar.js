import { useState, useCallback, useRef, useEffect } from "react";
import {
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Type, Palette, Highlighter, Image, Link, Table, Undo2, Redo2,
  Minus, Plus, ChevronDown, Strikethrough, List, ListOrdered, RemoveFormatting,
} from "lucide-react";
import TableGridSelector from "./TableGridSelector";
import ColorPicker from "./ColorPicker";
import LinkDialog from "./LinkDialog";
import './Toolbar.scss';

const FONT_SIZES = ["8px","9px","10px","11px","12px","14px","16px","18px","20px","24px","28px","32px","36px","48px","64px","72px","96px"];

const ToolbarButton = ({ active, onClick, children, title, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`toolbar-btn${active ? " toolbar-btn--active" : ""}${disabled ? " toolbar-btn--disabled" : ""}`}
  >
    {children}
  </button>
);

const Toolbar = ({ editor, onImageUpload, zoom, setZoom }) => {
  const [showTableGrid,  setShowTableGrid]  = useState(false);
  const [showTextColor,  setShowTextColor]  = useState(false);
  const [showHighlight,  setShowHighlight]  = useState(false);
  const [showFontSize,   setShowFontSize]   = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);

  const tableRef     = useRef(null);
  const textColorRef = useRef(null);
  const highlightRef = useRef(null);
  const fontSizeRef  = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (tableRef.current    && !tableRef.current.contains(e.target))    setShowTableGrid(false);
      if (textColorRef.current && !textColorRef.current.contains(e.target)) setShowTextColor(false);
      if (highlightRef.current && !highlightRef.current.contains(e.target)) setShowHighlight(false);
      if (fontSizeRef.current  && !fontSizeRef.current.contains(e.target))  setShowFontSize(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!editor) return null;

  const currentFontSize = editor.getAttributes("textStyle").fontSize || "12px";

  const changeFontSize = (delta) => {
    const current = parseInt(currentFontSize);
    const idx     = FONT_SIZES.findIndex((s) => parseInt(s) >= current);
    const newIdx  = Math.max(0, Math.min(FONT_SIZES.length - 1, (idx === -1 ? 4 : idx) + delta));
    editor.chain().focus().setFontSize(FONT_SIZES[newIdx]).run();
  };

  const handleImageUploadClick = () => {
    const input = document.createElement("input");
    input.type   = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (typeof onImageUpload === "function") {
        onImageUpload(file);
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          editor.chain().focus().setImage({ src: reader.result }).run();
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const handleInsertTable = (rows, cols) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    setShowTableGrid(false);
  };

  const handleInsertLink = (url) => {
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const Divider = () => <div className="toolbar-divider" />;

  return (
    <>
      <div className="toolbar">
        {/* Undo / Redo */}
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Undo" disabled={!editor.can().undo()}>
          <Undo2 size={16} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Redo" disabled={!editor.can().redo()}>
          <Redo2 size={16} />
        </ToolbarButton>

        <Divider />

        {/* Zoom Controls */}
        <div className="toolbar-zoom">
          <button
            onClick={() => setZoom((z) => Math.max(50, z - 10))}
            className="toolbar-zoom__btn"
            title="Zoom out"
          >
            <Minus size={14} />
          </button>
          <input
            type="range"
            min="50"
            max="200"
            step="10"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="toolbar-zoom__slider"
          />
          <button
            onClick={() => setZoom((z) => Math.min(200, z + 10))}
            className="toolbar-zoom__btn"
            title="Zoom in"
          >
            <Plus size={14} />
          </button>
          <span className="toolbar-zoom__label">{zoom}%</span>
        </div>

        {/* Font Size */}
        <div className="toolbar-fontsize" ref={fontSizeRef}>
          <div className="toolbar-fontsize__controls">
            <ToolbarButton onClick={() => changeFontSize(-1)} title="Decrease font size">
              <Minus size={14} />
            </ToolbarButton>
            <button
              onClick={() => setShowFontSize(!showFontSize)}
              className="toolbar-fontsize__display"
            >
              {parseInt(currentFontSize)}
              <ChevronDown size={12} />
            </button>
            <ToolbarButton onClick={() => changeFontSize(1)} title="Increase font size">
              <Plus size={14} />
            </ToolbarButton>
          </div>
          {showFontSize && (
            <div className="toolbar-dropdown">
              {FONT_SIZES.map((size) => (
                <button
                  key={size}
                  onClick={() => { editor.chain().focus().setFontSize(size).run(); setShowFontSize(false); }}
                  className={`toolbar-dropdown__item${currentFontSize === size ? " toolbar-dropdown__item--active" : ""}`}
                >
                  {parseInt(size)}
                </button>
              ))}
            </div>
          )}
        </div>

        <Divider />

        {/* Text Formatting */}
        <ToolbarButton active={editor.isActive("bold")}      onClick={() => editor.chain().focus().toggleBold().run()}      title="Bold">
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("italic")}    onClick={() => editor.chain().focus().toggleItalic().run()}    title="Italic">
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
          <Underline size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("strike")}    onClick={() => editor.chain().focus().toggleStrike().run()}    title="Strikethrough">
          <Strikethrough size={16} />
        </ToolbarButton>

        <Divider />

        {/* Text Color */}
        <div className="toolbar-popover-wrap" ref={textColorRef}>
          <ToolbarButton onClick={() => setShowTextColor(!showTextColor)} title="Text color">
            <div className="toolbar-color-icon">
              <Type size={14} />
              <div
                className="toolbar-color-icon__bar"
                style={{ backgroundColor: editor.getAttributes("textStyle").color || "#000" }}
              />
            </div>
          </ToolbarButton>
          {showTextColor && (
            <div className="toolbar-popover">
              <ColorPicker
                label="Text Color"
                onSelect={(c) => {
                  c
                    ? editor.chain().focus().extendMarkRange("textStyle").setColor(c).run()
                    : editor.chain().focus().unsetColor().run();
                  setShowTextColor(false);
                }}
              />
            </div>
          )}
        </div>

        {/* Highlight */}
        <div className="toolbar-popover-wrap" ref={highlightRef}>
          <ToolbarButton onClick={() => setShowHighlight(!showHighlight)} title="Highlight">
            <Highlighter size={16} />
          </ToolbarButton>
          {showHighlight && (
            <div className="toolbar-popover">
              <ColorPicker
                label="Highlight Color"
                onSelect={(c) => {
                  c
                    ? editor.chain().focus().setHighlight({ color: c }).run()
                    : editor.chain().focus().unsetHighlight().run();
                  setShowHighlight(false);
                }}
              />
            </div>
          )}
        </div>

        <Divider />

        {/* Alignment */}
        <ToolbarButton active={editor.isActive({ textAlign: "left" })}    onClick={() => editor.chain().focus().setTextAlign("left").run()}    title="Align left">
          <AlignLeft size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: "center" })}  onClick={() => editor.chain().focus().setTextAlign("center").run()}  title="Align center">
          <AlignCenter size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: "right" })}   onClick={() => editor.chain().focus().setTextAlign("right").run()}   title="Align right">
          <AlignRight size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()} title="Justify">
          <AlignJustify size={16} />
        </ToolbarButton>

        <Divider />

        {/* Lists */}
        <ToolbarButton active={editor.isActive("bulletList")}  onClick={() => editor.chain().focus().toggleBulletList().run()}  title="Bullet list">
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
          <ListOrdered size={16} />
        </ToolbarButton>

        <Divider />

        {/* Insert: Image */}
        <ToolbarButton onClick={handleImageUploadClick} title="Insert image">
          <Image size={16} />
        </ToolbarButton>

        {/* Insert: Link */}
        <ToolbarButton active={editor.isActive("link")} onClick={() => setShowLinkDialog(true)} title="Insert link">
          <Link size={16} />
        </ToolbarButton>

        {/* Insert: Table */}
        <div className="toolbar-popover-wrap toolbar-popover-wrap--right" ref={tableRef}>
          <ToolbarButton onClick={() => setShowTableGrid(!showTableGrid)} title="Insert table">
            <Table size={16} />
          </ToolbarButton>
          {showTableGrid && (
            <div className="toolbar-popover toolbar-popover--right">
              <TableGridSelector onSelect={handleInsertTable} />
            </div>
          )}
        </div>

        <Divider />

        <ToolbarButton onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} title="Clear formatting">
          <RemoveFormatting size={16} />
        </ToolbarButton>
      </div>

      <LinkDialog
        open={showLinkDialog}
        onClose={() => setShowLinkDialog(false)}
        onInsert={handleInsertLink}
        initialUrl={editor.getAttributes("link").href || ""}
      />
    </>
  );
};

export default Toolbar;
