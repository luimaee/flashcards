"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Region } from "@/lib/notes/region";

interface RegionSelectLayerProps {
  scale: number;
  /** A region to show as already selected (e.g. a card's source). */
  highlight?: Region | null;
  onSelect: (region: Region) => void;
  onClear: () => void;
}

/**
 * Marquee selection over a page. Drag on empty space to select a rectangle
 * in page units. Text blocks and images sit above this layer so they stay
 * draggable in select mode.
 */
export function RegionSelectLayer({ scale, highlight, onSelect, onClear }: RegionSelectLayerProps) {
  const [drag, setDrag] = useState<Region | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const toPage = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    return { x: (ev.clientX - rect.left) / scale, y: (ev.clientY - rect.top) / scale };
  };

  const shown = drag ?? highlight ?? null;

  return (
    <div
      className="absolute inset-0"
      style={{ touchAction: "none", cursor: "crosshair" }}
      onPointerDown={(ev) => {
        if (ev.target !== ev.currentTarget) return;
        ev.preventDefault();
        ev.currentTarget.setPointerCapture(ev.pointerId);
        const p = toPage(ev);
        origin.current = p;
        setDrag([p.x, p.y, p.x, p.y]);
        onClear();
      }}
      onPointerMove={(ev) => {
        if (!origin.current) return;
        const p = toPage(ev);
        setDrag([origin.current.x, origin.current.y, p.x, p.y]);
      }}
      onPointerUp={(ev) => {
        if (!origin.current) return;
        const p = toPage(ev);
        const region: Region = [
          Math.min(origin.current.x, p.x),
          Math.min(origin.current.y, p.y),
          Math.max(origin.current.x, p.x),
          Math.max(origin.current.y, p.y),
        ];
        origin.current = null;
        setDrag(null);
        if (region[2] - region[0] > 8 && region[3] - region[1] > 8) onSelect(region);
      }}
      onPointerCancel={() => {
        origin.current = null;
        setDrag(null);
      }}
    >
      {shown && (
        <div
          className="pointer-events-none absolute rounded-sm border-2 border-accent bg-accent/10"
          style={{
            left: Math.min(shown[0], shown[2]) * scale,
            top: Math.min(shown[1], shown[3]) * scale,
            width: Math.abs(shown[2] - shown[0]) * scale,
            height: Math.abs(shown[3] - shown[1]) * scale,
          }}
        />
      )}
    </div>
  );
}
