import type { ChangeSpec } from "@codemirror/state";
import type { Command } from "@codemirror/view";

export const indentWithTab: Command = (view) => {
  if (view.state.selection.ranges.every((range) => range.empty)) {
    view.dispatch(view.state.replaceSelection("\t"));
    return true;
  }
  const positions = selectedLineStarts(view.state.doc.toString(), view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to })));
  view.dispatch({ changes: positions.map((from): ChangeSpec => ({ from, insert: "\t" })), userEvent: "input.indent" });
  return true;
};

export const outdentOneLevel: Command = (view) => {
  const text = view.state.doc.toString();
  const positions = selectedLineStarts(text, view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to })));
  const changes: ChangeSpec[] = [];
  for (const from of positions) {
    const prefix = text.slice(from, from + 4);
    const removal = outdentLength(prefix);
    if (removal > 0) changes.push({ from, to: from + removal });
  }
  if (changes.length) view.dispatch({ changes, userEvent: "delete.backward" });
  return true;
};

export function outdentLength(prefix: string): number {
  if (prefix.startsWith("\t")) return 1;
  return Math.min(prefix.match(/^ */)?.[0].length ?? 0, 4);
}

export function selectedLineStarts(text: string, ranges: Array<{ from: number; to: number }>): number[] {
  const starts = new Set<number>();
  for (const range of ranges) {
    let from = lineStart(text, range.from);
    const adjustedTo = range.to > range.from && text[range.to - 1] === "\n" ? range.to - 1 : range.to;
    const to = lineStart(text, adjustedTo);
    while (from <= to) {
      starts.add(from);
      const newline = text.indexOf("\n", from);
      if (newline < 0 || newline >= to) break;
      from = newline + 1;
    }
  }
  return [...starts].sort((a, b) => a - b);
}

function lineStart(text: string, position: number): number {
  return text.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
}
