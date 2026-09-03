"use client";

import { useEffect, useRef, useState } from "react";
import { openPdfAsset, renderPdfPage } from "@/lib/pdf/client";
import { useStore } from "@/lib/store/react";

interface PdfPageLayerProps {
  assetId: string;
  pageNumber: number;
  width: number;
  height: number;
  scale: number;
}

/** Draws the imported PDF page underneath the ink. Rendered only while the page is mounted. */
export function PdfPageLayer({ assetId, pageNumber, width, height, scale }: PdfPageLayerProps) {
  const store = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    openPdfAsset(assetId, async () => {
      const asset = await store.getAsset(assetId);
      if (!asset) throw new Error("PDF missing");
      return asset.blob.arrayBuffer();
    })
      .then((doc) => (cancelled ? undefined : renderPdfPage(doc, pageNumber, canvas, scale, dpr)))
      .catch(() => {
        if (!cancelled) setError("This PDF page could not be drawn.");
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, pageNumber, scale, store]);

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0" style={{ width: width * scale, height: height * scale }} aria-hidden="true" />
      {error && <div className="absolute inset-x-0 top-2 text-center text-xs text-warn">{error}</div>}
    </>
  );
}
