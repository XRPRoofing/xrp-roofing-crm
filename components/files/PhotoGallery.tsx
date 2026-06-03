"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Download, X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";

export type GalleryPhoto = {
  id: string;
  name: string;
  dataUrl: string;
  photoType?: string;
  uploadedBy?: string;
  uploadedAt?: string;
};

function downloadPhoto(photo: GalleryPhoto) {
  const link = document.createElement("a");
  link.href = photo.dataUrl;
  link.download = photo.name || `${photo.id}.jpg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function PhotoGallery({ photos }: { photos: GalleryPhoto[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const close = useCallback(() => {
    setActiveIndex(null);
    setZoomed(false);
  }, []);

  const showAt = useCallback(
    (index: number) => {
      setActiveIndex(((index % photos.length) + photos.length) % photos.length);
      setZoomed(false);
    },
    [photos.length],
  );

  useEffect(() => {
    if (activeIndex === null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") showAt((activeIndex ?? 0) + 1);
      if (event.key === "ArrowLeft") showAt((activeIndex ?? 0) - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, close, showAt]);

  const active = activeIndex === null ? null : photos[activeIndex];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo, index) => (
          <div key={photo.id} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <button type="button" onClick={() => showAt(index)} className="block w-full" aria-label={`Open ${photo.name}`}>
              <Image src={photo.dataUrl} alt={photo.name} width={420} height={320} unoptimized className="h-40 w-full object-cover transition group-hover:scale-105" />
            </button>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-black text-slate-800">{photo.name}</p>
                {photo.photoType && <p className="truncate text-[11px] font-semibold text-slate-400">{photo.photoType}{photo.uploadedBy ? ` · ${photo.uploadedBy}` : ""}</p>}
              </div>
              <button type="button" onClick={() => downloadPhoto(photo)} className="shrink-0 rounded-full bg-slate-100 p-2 text-slate-600 transition hover:bg-blue-50 hover:text-blue-700" aria-label={`Download ${photo.name}`}>
                <Download className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {active && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950/90 p-4" onClick={close}>
          <div className="flex items-center justify-between gap-3 text-white" onClick={(event) => event.stopPropagation()}>
            <div className="min-w-0">
              <p className="truncate text-sm font-black">{active.name}</p>
              <p className="text-xs text-slate-300">{(activeIndex ?? 0) + 1} of {photos.length}</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setZoomed((value) => !value)} className="rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Toggle zoom">
                {zoomed ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}
              </button>
              <button type="button" onClick={() => downloadPhoto(active)} className="rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Download photo">
                <Download className="h-5 w-5" />
              </button>
              <button type="button" onClick={close} className="rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="relative flex flex-1 items-center justify-center overflow-auto" onClick={(event) => event.stopPropagation()}>
            {photos.length > 1 && (
              <button type="button" onClick={() => showAt((activeIndex ?? 0) - 1)} className="absolute left-2 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Previous">
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.dataUrl}
              alt={active.name}
              onClick={() => setZoomed((value) => !value)}
              className={`max-h-full select-none rounded-xl object-contain transition-transform ${zoomed ? "max-w-none scale-150 cursor-zoom-out" : "max-w-full cursor-zoom-in"}`}
            />
            {photos.length > 1 && (
              <button type="button" onClick={() => showAt((activeIndex ?? 0) + 1)} className="absolute right-2 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Next">
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
