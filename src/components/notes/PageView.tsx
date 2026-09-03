"use client";

import { useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { InkCanvas, type CanvasTool } from "@/components/ink/InkCanvas";
import { TextBlockEditor } from "@/components/notes/TextBlockEditor";
import { unpackPoints } from "@/lib/ink/geometry";
import type { DrawableStroke } from "@/lib/ink/render";
import type { Page, Stroke, TextBlock } from "@/lib/store/schema";

export type PageTool = CanvasTool | "text" | "select";

export interface PageViewProps {
  page: Page;
  scale: number;
  strokes: Stroke[];
  textBlocks: TextBlock[];
  tool: PageTool;
  color: string;
  size: number;
  focusBlockId?: string | null;
  onStrokeCommit: (stroke: DrawableStroke) => void;
  onErase: (strokeIds: string[]) => void;
  onTextCreate: (x: number, y: number) => void;
  onTextChange: (block: TextBlock, text: string) => void;
  onTextMove: (block: TextBlock, x: number, y: number) => void;
  onTextDelete: (block: TextBlock) => void;
}

const DEFAULT_TEXT_WIDTH = 320;

/**
 * One page: ink canvas underneath, typed text blocks on top. Ink and text
 * share the same page coordinate system so a card's source region can point
 * at either.
 */
export function PageView(props: PageViewProps) {
  const { page, scale, strokes, textBlocks, tool, color, size, focusBlockId } = props;

  const drawable = useMemo<DrawableStroke[]>(
    () => strokes.map((s) => ({ id: s.id, tool: s.tool, color: s.color, size: s.size, points: unpackPoints(s.points, s.count) })),
    [strokes],
  );

  const inkTool: CanvasTool = tool === "text" || tool === "select" ? "pen" : tool;
  const textInteractive = tool === "text" || tool === "select";

  const onPlaceText = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== "text" || ev.target !== ev.currentTarget) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / scale;
    const y = (ev.clientY - rect.top) / scale;
    props.onTextCreate(Math.max(0, Math.min(page.width - DEFAULT_TEXT_WIDTH, x)), Math.max(0, y));
  };

  return (
    <div className="relative" style={{ width: page.width * scale, height: page.height * scale }}>
      <InkCanvas
        width={page.width}
        height={page.height}
        scale={scale}
        background={page.background}
        strokes={drawable}
        tool={inkTool}
        color={color}
        size={size}
        onStrokeCommit={props.onStrokeCommit}
        onErase={props.onErase}
      />
      {/* Text layer. Only catches pointer events for the text/select tools so ink passes through otherwise. */}
      <div
        className="absolute inset-0"
        style={{ pointerEvents: textInteractive ? "auto" : "none", cursor: tool === "text" ? "text" : "default" }}
        onPointerDown={onPlaceText}
      >
        {textBlocks.map((block) => (
          <TextBlockEditor
            key={block.id}
            block={block}
            scale={scale}
            interactive={textInteractive}
            autoFocus={block.id === focusBlockId}
            onChange={(text) => props.onTextChange(block, text)}
            onMove={(x, y) => props.onTextMove(block, x, y)}
            onDelete={() => props.onTextDelete(block)}
          />
        ))}
      </div>
    </div>
  );
}

export { DEFAULT_TEXT_WIDTH };
