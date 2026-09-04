import { useEffect, useRef, type MutableRefObject } from "react";
import { cpp } from "@codemirror/lang-cpp";
import { EditorState, Prec, Compartment, Transaction } from "@codemirror/state";
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  lineNumbers,
} from "@codemirror/view";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  defaultHighlightStyle,
  HighlightStyle,
} from "@codemirror/language";
import {
  defaultKeymap,
  history,
  undo,
  redo,
  indentWithTab,
  toggleComment,
  copyLineUp,
  copyLineDown,
  deleteLine,
  indentMore,
  indentLess,
  selectLine,
} from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap, selectNextOccurrence } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { showMinimap } from "@replit/codemirror-minimap";

export const EDITOR_FONT_MIN = 11;
export const EDITOR_FONT_MAX = 28;
export const EDITOR_FONT_DEFAULT = 14;

export function readEditorFontSize(): number {
  try {
    const n = Number(localStorage.getItem("judge-editor-font"));
    if (Number.isFinite(n) && n >= EDITOR_FONT_MIN && n <= EDITOR_FONT_MAX) return n;
  } catch {
    /* ignore */
  }
  return EDITOR_FONT_DEFAULT;
}

function editorThemeFor(isDark: boolean) {
  const sel = isDark ? "#264f78" : "#add6ff";
  const selBlur = isDark ? "#1a3550" : "#cce0f5";
  const selMatch = isDark ? "rgba(87, 148, 242, 0.22)" : "rgba(42, 110, 190, 0.18)";
  return EditorView.theme(
    {
      "&": {
        backgroundColor: "var(--editor-bg)",
        color: "var(--color-ink)",
        height: "100%",
      },
      ".cm-scroller": {
        fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
        lineHeight: "1.65",
        overflowX: "auto",
        overflowY: "auto",
      },
      ".cm-content": {
        caretColor: "var(--editor-cursor)",
        fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
        lineHeight: "1.65",
        padding: "10px 0",
        tabSize: "4",
        whiteSpace: "pre",
      },
      ".cm-minimap-gutter": {
        borderLeft: "1px solid var(--color-line)",
        backgroundColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.03)",
      },
      ".cm-minimap-overlay-container .cm-minimap-overlay": {
        backgroundColor: isDark ? "rgba(212,137,58,0.18)" : "rgba(181,115,32,0.16)",
        border: isDark ? "1px solid rgba(212,137,58,0.35)" : "1px solid rgba(181,115,32,0.3)",
      },
      ".cm-content > .cm-line[style*='display: none']": {
        fontSize: "18px !important",
        lineHeight: "28px !important",
      },
      ".cm-content > .cm-line[style*='display: none'] *": {
        fontSize: "18px !important",
        lineHeight: "28px !important",
      },
      ".cm-gutters": {
        backgroundColor: "var(--editor-gutter)",
        color: "var(--editor-gutter-text)",
        border: "none",
        borderRight: "1px solid var(--color-line)",
        fontFamily: "'JetBrains Mono', monospace",
        minWidth: "52px",
        paddingRight: "4px",
      },
      ".cm-line": {
        padding: "0 12px 0 8px",
      },
      ".cm-activeLine": {
        backgroundColor: isDark ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.035)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: isDark ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.035)",
        color: "var(--color-copper)",
      },
      ".cm-selectionLayer .cm-selectionBackground": {
        backgroundColor: `${sel} !important`,
      },
      "&.cm-focused .cm-selectionLayer .cm-selectionBackground": {
        backgroundColor: `${sel} !important`,
      },
      "&:not(.cm-focused) .cm-selectionLayer .cm-selectionBackground": {
        backgroundColor: `${selBlur} !important`,
      },
      ".cm-content ::selection": {
        backgroundColor: `${sel} !important`,
      },
      ".cm-selectionMatch": {
        backgroundColor: selMatch,
        borderRadius: "2px",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--editor-cursor)",
        borderLeftWidth: "2px",
      },
      ".cm-matchingBracket": {
        backgroundColor: isDark ? "rgba(212,137,58,0.28)" : "rgba(181,115,32,0.22)",
        outline: `1px solid ${isDark ? "rgba(212,137,58,0.55)" : "rgba(181,115,32,0.45)"}`,
        borderRadius: "2px",
      },
      ".cm-searchMatch": {
        backgroundColor: isDark ? "rgba(212,137,58,0.28)" : "rgba(181,115,32,0.2)",
      },
      ".cm-searchMatch-selected": {
        backgroundColor: isDark ? "rgba(212,137,58,0.55)" : "rgba(181,115,32,0.42)",
      },
      ".cm-panels": {
        backgroundColor: "var(--color-bg2)",
        borderBottom: "1px solid var(--color-line)",
      },
      ".cm-panel input, .cm-panel button": {
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "12px",
      },
    },
    { dark: isDark },
  );
}

function editorFontTheme(fontSize: number) {
  return EditorView.theme({
    ".cm-content": { fontSize: `${fontSize}px` },
    ".cm-gutters": { fontSize: `${Math.max(11, fontSize - 1)}px` },
  });
}

const darkSyntax = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff9b7a", fontWeight: "700" },
  { tag: tags.controlKeyword, color: "#ff9b7a", fontWeight: "700" },
  { tag: tags.definitionKeyword, color: "#ff9b7a", fontWeight: "700" },
  { tag: tags.modifier, color: "#ff9b7a", fontWeight: "700" },
  { tag: tags.operatorKeyword, color: "#ff9b7a", fontWeight: "700" },
  { tag: tags.operator, color: "#e8b45c" },
  { tag: tags.number, color: "#e0b86a" },
  { tag: tags.string, color: "#a3c96e" },
  { tag: tags.character, color: "#a3c96e" },
  { tag: tags.comment, color: "#7a7368", fontStyle: "italic" },
  { tag: tags.lineComment, color: "#7a7368", fontStyle: "italic" },
  { tag: tags.blockComment, color: "#7a7368", fontStyle: "italic" },
  { tag: tags.typeName, color: "#8cb4e0", fontWeight: "600" },
  { tag: tags.className, color: "#8cb4e0", fontWeight: "700" },
  { tag: tags.definition(tags.variableName), color: "#e8dcc8" },
  { tag: tags.definition(tags.function(tags.variableName)), color: "#e8b45c", fontWeight: "600" },
  { tag: tags.function(tags.variableName), color: "#e8b45c" },
  { tag: tags.variableName, color: "#e8dcc8" },
  { tag: tags.bool, color: "#e0b86a", fontWeight: "600" },
  { tag: tags.null, color: "#ff9b7a", fontWeight: "700" },
  { tag: tags.macroName, color: "#f0a04a", fontWeight: "700" },
  { tag: tags.processingInstruction, color: "#f0a04a", fontWeight: "600" },
  { tag: tags.meta, color: "#f0a04a", fontWeight: "600" },
  { tag: tags.bracket, color: "#b0a898" },
  { tag: tags.punctuation, color: "#b0a898" },
  { tag: tags.separator, color: "#b0a898" },
]);

const lightSyntax = HighlightStyle.define([
  { tag: tags.keyword, color: "#b01048", fontWeight: "700" },
  { tag: tags.controlKeyword, color: "#b01048", fontWeight: "700" },
  { tag: tags.definitionKeyword, color: "#b01048", fontWeight: "700" },
  { tag: tags.modifier, color: "#b01048", fontWeight: "700" },
  { tag: tags.operatorKeyword, color: "#b01048", fontWeight: "700" },
  { tag: tags.operator, color: "#8a5608" },
  { tag: tags.number, color: "#9a4e0a" },
  { tag: tags.string, color: "#1f6b18" },
  { tag: tags.character, color: "#1f6b18" },
  { tag: tags.comment, color: "#6e675c", fontStyle: "italic" },
  { tag: tags.lineComment, color: "#6e675c", fontStyle: "italic" },
  { tag: tags.blockComment, color: "#6e675c", fontStyle: "italic" },
  { tag: tags.typeName, color: "#0d5aa7", fontWeight: "600" },
  { tag: tags.className, color: "#0d5aa7", fontWeight: "700" },
  { tag: tags.definition(tags.variableName), color: "#12110e" },
  { tag: tags.definition(tags.function(tags.variableName)), color: "#8a5608", fontWeight: "600" },
  { tag: tags.function(tags.variableName), color: "#8a5608" },
  { tag: tags.variableName, color: "#12110e" },
  { tag: tags.bool, color: "#9a4e0a", fontWeight: "600" },
  { tag: tags.null, color: "#b01048", fontWeight: "700" },
  { tag: tags.macroName, color: "#a85a00", fontWeight: "700" },
  { tag: tags.processingInstruction, color: "#a85a00", fontWeight: "600" },
  { tag: tags.meta, color: "#a85a00", fontWeight: "600" },
  { tag: tags.bracket, color: "#5c564c" },
  { tag: tags.punctuation, color: "#5c564c" },
  { tag: tags.separator, color: "#5c564c" },
]);

function themeExtensions(isDark: boolean) {
  return [
    editorThemeFor(isDark),
    syntaxHighlighting(isDark ? darkSyntax : lightSyntax),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  ];
}

function buildExtensions(
  themeComp: Compartment,
  fontComp: Compartment,
  isDark: boolean,
  fontSize: number,
  onFontSize: (next: number | ((prev: number) => number)) => void,
  onChange: (doc: string) => void,
) {
  return [
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(4),
    indentUnit.of("    "),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history({ minDepth: 200, newGroupDelay: 250 }),
    foldGutter(),
    drawSelection({ cursorBlinkRate: 1000 }),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ activateOnTyping: true }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches({ highlightWordAroundCursor: true, minSelectionLength: 2 }),
    cpp(),
    themeComp.of(themeExtensions(isDark)),
    fontComp.of(editorFontTheme(fontSize)),
    showMinimap.compute(["doc"], () => ({
      create: () => ({ dom: document.createElement("div") }),
      displayText: "characters",
      showOverlay: "always",
    })),
    EditorView.updateListener.of((vu) => {
      if (vu.docChanged) onChange(vu.state.doc.toString());
    }),
    Prec.highest(
      keymap.of([
        { key: "Mod-z", run: undo, preventDefault: true, stopPropagation: true },
        { key: "Mod-y", run: redo, preventDefault: true, stopPropagation: true },
        { key: "Mod-Shift-z", run: redo, preventDefault: true, stopPropagation: true },
        { key: "Ctrl-z", run: undo, preventDefault: true, stopPropagation: true },
        { key: "Ctrl-y", run: redo, preventDefault: true, stopPropagation: true },
        { key: "Ctrl-Shift-z", run: redo, preventDefault: true, stopPropagation: true },
      ]),
    ),
    Prec.high(
      keymap.of([
        indentWithTab,
        { key: "Mod-/", run: toggleComment },
        { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
        { key: "Shift-Alt-ArrowUp", run: copyLineUp },
        { key: "Shift-Alt-ArrowDown", run: copyLineDown },
        { key: "Shift-Mod-k", run: deleteLine },
        { key: "Mod-]", run: indentMore },
        { key: "Mod-[", run: indentLess },
        { key: "Alt-l", run: selectLine },
        {
          key: "Mod-=",
          run: () => {
            onFontSize((s) => Math.min(EDITOR_FONT_MAX, s + 1));
            return true;
          },
          preventDefault: true,
        },
        {
          key: "Mod-equal",
          run: () => {
            onFontSize((s) => Math.min(EDITOR_FONT_MAX, s + 1));
            return true;
          },
          preventDefault: true,
        },
        {
          key: "Mod-Minus",
          run: () => {
            onFontSize((s) => Math.max(EDITOR_FONT_MIN, s - 1));
            return true;
          },
          preventDefault: true,
        },
        {
          key: "Mod-0",
          run: () => {
            onFontSize(EDITOR_FONT_DEFAULT);
            return true;
          },
          preventDefault: true,
        },
      ]),
    ),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ]),
  ];
}

/** Thay toàn bộ mã nguồn mà không ghi vào lịch sử undo */
export function replaceEditorDoc(view: EditorView, text: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: Transaction.addToHistory.of(false),
  });
}

type CppEditorProps = {
  initialDoc: string;
  isDark: boolean;
  fontSize: number;
  onFontSize: (next: number | ((prev: number) => number)) => void;
  onChange: (doc: string) => void;
  viewRef: MutableRefObject<EditorView | null>;
};

/**
 * Editor tự quản lý EditorView — không dùng controlled value của react-codemirror
 * (tránh sync value phá undo/redo).
 */
export function CppEditor(props: CppEditorProps) {
  const { initialDoc, isDark, fontSize, onFontSize, onChange, viewRef } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const themeCompRef = useRef(new Compartment());
  const fontCompRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onFontSizeRef = useRef(onFontSize);
  onChangeRef.current = onChange;
  onFontSizeRef.current = onFontSize;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      doc: initialDoc,
      parent: host,
      extensions: buildExtensions(
        themeCompRef.current,
        fontCompRef.current,
        isDark,
        fontSize,
        (next) => onFontSizeRef.current(next),
        (doc) => onChangeRef.current(doc),
      ),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
    // Chỉ tạo 1 lần — theme/font cập nhật qua compartment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompRef.current.reconfigure(themeExtensions(isDark)),
    });
  }, [isDark, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: fontCompRef.current.reconfigure(editorFontTheme(fontSize)),
    });
  }, [fontSize, viewRef]);

  return <div ref={hostRef} className="cm-theme-none h-full w-full" />;
}
