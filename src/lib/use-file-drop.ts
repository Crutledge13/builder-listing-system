"use client";

import { useRef, useState, type DragEvent } from "react";

// Lets an upload box take files dragged in from the computer. Without this,
// dropping a file on a "click to choose" box makes the browser open the file
// in the tab instead (tester notes, 28 Oct 2026). Spread `dropProps` on the
// box; `dragging` is true while files are held over it, for a highlight.
export function useFileDrop(onFiles: (files: File[]) => void, disabled = false) {
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child element; count them so the
  // highlight doesn't flicker as the pointer crosses the text inside.
  const depth = useRef(0);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const dropProps = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      if (!disabled) setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Needed for the drop to reach us instead of the browser.
      e.preventDefault();
      e.dataTransfer.dropEffect = disabled ? "none" : "copy";
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) onFiles(files);
    },
  };

  return { dragging, dropProps };
}
