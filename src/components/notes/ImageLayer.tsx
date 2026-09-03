"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "@/lib/store/react";
import type { ImageBlock } from "@/lib/store/schema";

interface ImageLayerProps {
  blocks: ImageBlock[];
  scale: number;
  interactive: boolean;
  onMove: (block: ImageBlock, x: number, y: number) => void;
  onDelete: (block: ImageBlock) => void;
}

/** Imported images on a page. Draggable in select mode; ink passes through otherwise. */
export function ImageLayer({ blocks, scale, interactive, onMove, onDelete }: ImageLayerProps) {
  return (
    <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {blocks.map((b) => (
        <ImageItem key={b.id} block={b} scale={scale} interactive={interactive} onMove={onMove} onDelete={onDelete} />
      ))}
    </div>
  );
}

function ImageItem({ block, scale, interactive, onMove, onDelete }: { block: ImageBlock; scale: number; interactive: boolean } & Pick<ImageLayerProps, "onMove" | "onDelete">) {
  const store = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    store.getAsset(block.assetId).then((asset) => {
      if (!asset || !active) return;
      objectUrl = URL.createObjectURL(asset.blob);
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [block.assetId, store]);

  const onDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = { startX: ev.clientX, startY: ev.clientY, x: block.x, y: block.y };
  };
  const onMovePointer = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onMove(block, Math.max(0, drag.current.x + (ev.clientX - drag.current.startX) / scale), Math.max(0, drag.current.y + (ev.clientY - drag.current.startY) / scale));
  };
  const onUp = () => {
    drag.current = null;
  };

  return (
    <div
      className={`absolute ${interactive ? "cursor-move ring-1 ring-transparent hover:ring-accent/60" : ""}`}
      style={{ left: block.x * scale, top: block.y * scale, width: block.width * scale, height: block.height * scale, pointerEvents: interactive ? "auto" : "none", touchAction: "none" }}
      onPointerDown={onDown}
      onPointerMove={onMovePointer}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" draggable={false} className="h-full w-full select-none object-fill" />}
      {interactive && (
        <button
          type="button"
          aria-label="Remove image"
          onClick={() => onDelete(block)}
          className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-hard text-xs text-white"
        >
          ×
        </button>
      )}
    </div>
  );
}
