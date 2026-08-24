import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { indentWithTab, outdentOneLevel } from "./editor-commands";

export function PlainTextEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: value, extensions: [
      history(),
      drawSelection({ drawRangeCursor: false }),
      keymap.of([
        { key: "Tab", run: indentWithTab },
        { key: "Shift-Tab", run: outdentOneLevel },
        ...defaultKeymap, ...historyKeymap
      ]),
      EditorView.updateListener.of((update) => { if (update.docChanged) onChangeRef.current(update.state.doc.toString()); }),
      EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off", translate: "no" }),
      EditorView.theme({
        "&": { height: "100%", backgroundColor: "transparent", color: "#e7e7e9", fontSize: "13px" },
        ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
        ".cm-content": { minWidth: "max-content", padding: "10px 0", caretColor: "#fff" },
        ".cm-line": { padding: "0 10px" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#fff", borderLeftWidth: "2px" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#315c76 !important" },
        "&.cm-focused": { outline: "none" }
      })
    ]}) });
    const focusEditor = () => view.focus();
    const focusFrame = window.requestAnimationFrame(focusEditor);
    window.addEventListener("focus", focusEditor);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("focus", focusEditor);
      view.destroy();
    };
  }, []);
  return <div className="editor-host" ref={host} />;
}
