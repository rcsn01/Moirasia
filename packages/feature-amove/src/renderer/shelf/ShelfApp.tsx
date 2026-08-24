import React, { useEffect, useRef, useState } from "react";
import type { ShelfItemView, ShelfState, ShelfThumbnailView } from "../../shared/contracts";
import { PlainTextEditor } from "./PlainTextEditor";
import { Button } from "@moirasia/ui-react/components/button";
import { AppWindow, ChevronDown, ChevronLeft, Code2, Grid2X2, List } from "@moirasia/ui-react/lib/icons";

type GalleryView = "grid" | "list";

export function ShelfApp() {
  const [state, setState] = useState<ShelfState>();
  const [galleryView, setGalleryView] = useState<GalleryView>("grid");
  const [thumbnails, setThumbnails] = useState<Record<string, ShelfThumbnailView>>({});
  const thumbnailsRef = useRef<Record<string, ShelfThumbnailView>>({});
  const dragging = useRef(false);
  const preloadedDrop = useRef("");
  const beginDrag = (ids: string[]) => {
    dragging.current = true;
    window.amoveShelf.beginDrag(ids);
  };
  useEffect(() => {
    let active = true;
    let receivedSubscription = false;
    let revision = 0;
    const applyState = async (nextState: ShelfState) => {
      const currentRevision = ++revision;
      const itemIds = new Set(nextState.items.map((item) => item.id));
      const nextThumbnails = Object.fromEntries(Object.entries(thumbnailsRef.current).filter(([id]) => itemIds.has(id)));
      const missingIds = nextState.items.map((item) => item.id).filter((id) => !nextThumbnails[id]);
      if (missingIds.length > 0) {
        try {
          const result = await window.amoveShelf.getThumbnails(missingIds);
          if (result.ok) {
            for (const thumbnail of result.value) nextThumbnails[thumbnail.id] = thumbnail;
          }
        } catch {
          // Unsupported files render the generic fallback without first flashing it.
        }
      }
      if (!active || currentRevision !== revision) return;
      thumbnailsRef.current = nextThumbnails;
      setThumbnails(nextThumbnails);
      setState(nextState);
    };
    void window.amoveShelf.getState().then((initialState) => {
      if (!receivedSubscription) void applyState(initialState);
    });
    const unsubscribe = window.amoveShelf.subscribe((nextState) => {
      receivedSubscription = true;
      void applyState(nextState);
    });
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    const finish = (event: DragEvent) => { if (!dragging.current) return; dragging.current = false; void window.amoveShelf.completeDrag(event.dataTransfer?.dropEffect !== "none"); };
    document.addEventListener("dragend", finish); return () => document.removeEventListener("dragend", finish);
  }, []);
  if (!state) return null;

  const editorVisible = state.transition === "editor";
  const itemIds = state.items.map((item) => item.id);
  const cardCount = Math.min(state.items.length, 4);
  const preloadDrop = (event: React.DragEvent) => {
    const files = filesFromTransfer(event.dataTransfer);
    if (files.length === 0) return;
    const signature = files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|");
    if (signature === preloadedDrop.current) return;
    preloadedDrop.current = signature;
    window.amoveShelf.preloadDroppedFiles(files);
  };
  return <div
    className={`shelf-root ${state.transition} ${state.itemsExpanded ? "gallery-open" : ""}`}
    onDragEnter={preloadDrop}
    onDragOver={(event) => { event.preventDefault(); preloadDrop(event); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) preloadedDrop.current = ""; }}
    onDrop={(event) => { event.preventDefault(); preloadedDrop.current = ""; const files = filesFromTransfer(event.dataTransfer); if (files.length) void window.amoveShelf.resolveDroppedFiles(files); }}
  >
    {editorVisible
      ? <>
          <header className="shelf-header">
            <button className="close-dot" aria-label="Close Shelf" onClick={() => void window.amoveShelf.close()} />
            <Button size="icon" className="code-toggle" aria-label="Back to shelf" onClick={() => void window.amoveShelf.setMode("files")}><AppWindow /></Button>
          </header>
          <div className="editor-panel"><PlainTextEditor value={state.draft} onChange={(draft) => void window.amoveShelf.setDraft(draft)} /></div>
        </>
      : <>
          <div className={`compact-shelf-view ${state.itemsExpanded ? "is-hidden" : "is-visible"}`} aria-hidden={state.itemsExpanded}>
            <header className="shelf-header">
              <button className="close-dot" aria-label="Close Shelf" onClick={() => void window.amoveShelf.close()} />
              <Button size="icon" className="code-toggle" aria-label="Toggle plain text editor" onClick={() => void window.amoveShelf.setMode("editor")}><Code2 /></Button>
            </header>
            <div className="files-panel">
                <div className="shelf-items-area">
                  <div className="drop-zone">
                    {cardCount > 0 && <div
                      className="thumbnail-stack"
                      draggable
                      aria-label="Staged items"
                      onDoubleClick={() => void window.amoveShelf.revealItems(itemIds)}
                      onDragStart={(event) => {
                        event.preventDefault();
                        beginDrag(itemIds);
                      }}
                    >
                      {state.items.slice(0, cardCount).map((item) => <ThumbnailCard thumbnail={thumbnails[item.id]} key={item.id} />)}
                    </div>}
                  </div>
                </div>
                {state.items.length > 0 && <button
                  className="shelf-items-toggle"
                  type="button"
                  aria-expanded="false"
                  onClick={() => void window.amoveShelf.setItemsExpanded(true)}
                >
                  <span>{state.items.length} {state.items.length === 1 ? "item" : "items"} in shelf</span>
                  <ChevronDown className="shelf-items-chevron" aria-hidden="true" />
                </button>}
              </div>
          </div>
          {state.items.length > 0 && <Gallery
            active={state.itemsExpanded}
            items={state.items}
            thumbnails={thumbnails}
            view={galleryView}
            onBack={() => void window.amoveShelf.setItemsExpanded(false)}
            onViewChange={setGalleryView}
            onBeginDrag={beginDrag}
          />}
        </>}
  </div>;
}

function Gallery({ active, items, thumbnails, view, onBack, onViewChange, onBeginDrag }: {
  active: boolean;
  items: ShelfItemView[];
  thumbnails: Record<string, ShelfThumbnailView>;
  view: GalleryView;
  onBack: () => void;
  onViewChange: (view: GalleryView) => void;
  onBeginDrag: (ids: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchor = useRef<string | undefined>(undefined);
  const itemKey = items.map((item) => item.id).join(",");
  useEffect(() => {
    const availableIds = new Set(items.map((item) => item.id));
    setSelectedIds((current) => {
      const next = active ? current.filter((id) => availableIds.has(id)) : [];
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
    if (!active || (selectionAnchor.current && !availableIds.has(selectionAnchor.current))) selectionAnchor.current = undefined;
  }, [active, itemKey, items]);

  const selectItem = (id: string, { additive, range }: { additive: boolean; range: boolean }) => {
    if (range && selectionAnchor.current) {
      const anchorIndex = items.findIndex((item) => item.id === selectionAnchor.current);
      const itemIndex = items.findIndex((item) => item.id === id);
      if (anchorIndex >= 0 && itemIndex >= 0) {
        const start = Math.min(anchorIndex, itemIndex);
        const end = Math.max(anchorIndex, itemIndex);
        const rangeIds = items.slice(start, end + 1).map((item) => item.id);
        setSelectedIds((current) => additive ? orderedSelection(items, new Set([...current, ...rangeIds])) : rangeIds);
        return;
      }
    }
    selectionAnchor.current = id;
    setSelectedIds((current) => {
      if (!additive) return [id];
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return orderedSelection(items, next);
    });
  };
  const startItemDrag = (id: string) => {
    const ids = selectedIds.includes(id) ? orderedSelection(items, new Set(selectedIds)) : [id];
    if (!selectedIds.includes(id)) {
      selectionAnchor.current = id;
      setSelectedIds(ids);
    }
    onBeginDrag(ids);
  };
  const totalSize = items.reduce((total, item) => total + item.size, 0);
  return <section className={`gallery-panel ${active ? "is-visible" : "is-hidden"}`} aria-label="Shelf preview" aria-hidden={!active}>
    <header className="gallery-header">
      <Button size="icon" className="gallery-back" aria-label="Back to shelf" onClick={onBack}><ChevronLeft aria-hidden="true" /></Button>
      <div className="gallery-heading">
        <strong>{galleryTitle(items)}</strong>
        <span>{formatBytes(totalSize)}</span>
      </div>
      <div className="gallery-view-toggle" role="group" aria-label="Preview layout">
        <Button size="icon" className="gallery-view-button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => onViewChange("grid")}><Grid2X2 aria-hidden="true" /></Button>
        <Button size="icon" className="gallery-view-button" aria-label="List view" aria-pressed={view === "list"} onClick={() => onViewChange("list")}><List aria-hidden="true" /></Button>
      </div>
    </header>
    <div
      className={`gallery-items ${view}`}
      role="listbox"
      aria-label="Items in shelf"
      aria-multiselectable="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          selectionAnchor.current = undefined;
          setSelectedIds([]);
        }
      }}
    >
      {items.map((item) => {
        const thumbnail = thumbnails[item.id];
        const selected = selectedIds.includes(item.id);
        return <div
          className={`gallery-item ${selected ? "selected" : ""}`}
          role="option"
          aria-selected={selected}
          tabIndex={active ? 0 : -1}
          draggable={active}
          key={item.id}
          onClick={(event) => {
            event.stopPropagation();
            selectItem(item.id, { additive: event.metaKey || event.ctrlKey, range: event.shiftKey });
          }}
          onKeyDown={(event) => {
            if (event.key !== " " && event.key !== "Enter") return;
            event.preventDefault();
            selectItem(item.id, { additive: event.metaKey || event.ctrlKey, range: event.shiftKey });
          }}
          onDragStart={(event) => {
            event.preventDefault();
            startItemDrag(item.id);
          }}
        >
          <div className="gallery-thumbnail">
            {thumbnail?.dataUrl
              ? <img src={thumbnail.dataUrl} alt="" draggable={false} />
              : <span className={`gallery-thumbnail-fallback ${item.isDirectory ? "folder" : "file"}`} aria-hidden="true" />}
          </div>
          <div className="gallery-item-labels">
            <strong className="gallery-item-name" title={item.name}>{item.name}</strong>
            <span className="gallery-item-size">{itemMetadata(item, thumbnail)}</span>
          </div>
        </div>;
      })}
    </div>
  </section>;
}

function orderedSelection(items: ShelfItemView[], selectedIds: Set<string>): string[] {
  return items.filter((item) => selectedIds.has(item.id)).map((item) => item.id);
}

function ThumbnailCard({ thumbnail }: { thumbnail: ShelfThumbnailView | undefined }) {
  return <div className={`thumbnail-card ${thumbnail?.dataUrl ? "has-thumbnail" : ""}`} aria-hidden="true">
    {thumbnail?.dataUrl
      ? <img className="thumbnail-image" src={thumbnail.dataUrl} alt="" />
      : <><span className="thumbnail-fold" /><span className="thumbnail-line long" /><span className="thumbnail-line" /><span className="thumbnail-line short" /></>}
  </div>;
}

const imageExtensions = new Set(["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);

function galleryTitle(items: ShelfItemView[]): string {
  const images = items.length > 0 && items.every((item) => !item.isDirectory && imageExtensions.has(item.name.split(".").pop()?.toLocaleLowerCase() ?? ""));
  const noun = images ? (items.length === 1 ? "Image" : "Images") : (items.length === 1 ? "Item" : "Items");
  return `${items.length} ${noun}`;
}

function itemMetadata(item: ShelfItemView, thumbnail?: ShelfThumbnailView): string {
  const size = formatBytes(item.size);
  return thumbnail?.width && thumbnail.height ? `${size} · ${thumbnail.width}×${thumbnail.height}` : size;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${formatNumber(bytes / 1_000)} KB`;
  if (bytes < 1_000_000_000) return `${formatNumber(bytes / 1_000_000)} MB`;
  return `${formatNumber(bytes / 1_000_000_000)} GB`;
}

function formatNumber(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function filesFromTransfer(dataTransfer: DataTransfer): File[] {
  const files = [...dataTransfer.files];
  if (files.length > 0) return files;
  return [...dataTransfer.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}
