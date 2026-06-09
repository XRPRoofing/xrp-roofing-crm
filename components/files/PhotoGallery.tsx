"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Pencil, X, ZoomIn, ZoomOut } from "lucide-react";

export type GalleryPhoto = {
  id: string;
  name: string;
  dataUrl: string;
  photoType?: string;
  uploadedBy?: string;
  uploadedAt?: string;
};

type PhotoType = "Before" | "Progress" | "After" | "Job Photo";

function downloadPhoto(photo: GalleryPhoto) {
  const link = document.createElement("a");
  link.href = photo.dataUrl;
  link.download = photo.name || `${photo.id}.jpg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const TYPE_LABEL: Record<PhotoType, string> = { Before: "BEFORE", Progress: "PROGRESS", After: "AFTER", "Job Photo": "GENERAL" };
const TYPE_BADGE: Record<PhotoType, string> = { Before: "bg-blue-600", Progress: "bg-orange-500", After: "bg-emerald-600", "Job Photo": "bg-slate-700" };

export default function PhotoGallery({
  photos,
  activeFilter,
  onEditPhoto,
}: {
  photos: GalleryPhoto[];
  activeFilter?: PhotoType | "General";
  onEditPhoto?: (photo: GalleryPhoto) => void;
}) {
  const [lightboxPool, setLightboxPool] = useState<GalleryPhoto[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);

  // "General" or undefined → show all photos; otherwise filter by type
  const filtered = !activeFilter || activeFilter === "General" || activeFilter === "Job Photo"
    ? photos
    : photos.filter((p) => p.photoType === activeFilter);

  const beforePhotos = photos.filter((p) => p.photoType === "Before");
  const afterPhotos  = photos.filter((p) => p.photoType === "After");
  const showComparison = (activeFilter === "Before" || activeFilter === "After") && beforePhotos.length > 0 && afterPhotos.length > 0;

  const openLightbox = useCallback((pool: GalleryPhoto[], index: number) => {
    setLightboxPool(pool);
    setActiveIndex(index);
    setZoomed(false);
  }, []);

  const close = useCallback(() => { setActiveIndex(null); setZoomed(false); }, []);

  const showAt = useCallback((index: number) => {
    setActiveIndex(((index % lightboxPool.length) + lightboxPool.length) % lightboxPool.length);
    setZoomed(false);
  }, [lightboxPool.length]);

  useEffect(() => {
    if (activeIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") showAt((activeIndex ?? 0) + 1);
      if (e.key === "ArrowLeft") showAt((activeIndex ?? 0) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, close, showAt]);

  const active = activeIndex === null ? null : lightboxPool[activeIndex];

  return (
    <>
      {/* Before / After stacked comparison (CompanyCam style) */}
      {showComparison && (
        <div className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-[#0f172a]">
          <p className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-400">Before / After Comparison</p>
          {/* Before stack */}
          <div className="relative border-t border-slate-700" style={{ aspectRatio: "16/9" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={beforePhotos[beforePhotos.length - 1].dataUrl} alt="Before" className="h-full w-full object-cover" />
            <span className="absolute bottom-3 right-3 rounded-lg bg-black/70 px-3 py-1 text-xs font-black uppercase tracking-widest text-white backdrop-blur-sm">BEFORE</span>
            {beforePhotos.length > 1 && <span className="absolute left-3 top-3 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] font-black text-white">{beforePhotos.length} photos</span>}
          </div>
          {/* After stack */}
          <div className="relative border-t border-slate-700" style={{ aspectRatio: "16/9" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={afterPhotos[afterPhotos.length - 1].dataUrl} alt="After" className="h-full w-full object-cover" />
            <span className="absolute bottom-3 right-3 rounded-lg bg-black/70 px-3 py-1 text-xs font-black uppercase tracking-widest text-emerald-300 backdrop-blur-sm">AFTER</span>
            {afterPhotos.length > 1 && <span className="absolute left-3 top-3 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] font-black text-white">{afterPhotos.length} photos</span>}
          </div>
          {/* Edit buttons */}
          <div className="grid grid-cols-2 gap-px border-t border-slate-700 bg-slate-700">
            <button type="button" onClick={() => openLightbox(beforePhotos, 0)} className="flex items-center justify-center gap-2 bg-slate-800 py-3 text-xs font-black text-white hover:bg-slate-700 active:bg-slate-600">
              <Pencil className="h-3.5 w-3.5" /> Edit Before
            </button>
            <button type="button" onClick={() => openLightbox(afterPhotos, 0)} className="flex items-center justify-center gap-2 bg-slate-800 py-3 text-xs font-black text-emerald-300 hover:bg-slate-700 active:bg-slate-600">
              <Pencil className="h-3.5 w-3.5" /> Edit After
            </button>
          </div>
          {/* Thumbnail strip */}
          <div className="flex gap-1.5 overflow-x-auto bg-slate-900 px-2 py-2">
            {beforePhotos.map((p, i) => (
              <button key={p.id} type="button" onClick={() => openLightbox(beforePhotos, i)} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl} alt="Before" className="h-14 w-20 rounded-lg object-cover opacity-80 hover:opacity-100" />
                <span className="absolute bottom-1 left-1 rounded bg-blue-600/80 px-1 text-[8px] font-black text-white">B{i + 1}</span>
              </button>
            ))}
            {afterPhotos.map((p, i) => (
              <button key={p.id} type="button" onClick={() => openLightbox(afterPhotos, i)} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl} alt="After" className="h-14 w-20 rounded-lg object-cover opacity-80 hover:opacity-100" />
                <span className="absolute bottom-1 left-1 rounded bg-emerald-600/80 px-1 text-[8px] font-black text-white">A{i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Photo grid */}
      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm font-semibold text-slate-400">No {activeFilter && activeFilter !== "General" ? activeFilter : ""} photos yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((photo, index) => {
            const type = (photo.photoType || "Job Photo") as PhotoType;
            return (
              <div key={photo.id} className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                <button type="button" onClick={() => openLightbox(filtered, index)} className="relative block w-full" aria-label={`Open ${photo.name}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.dataUrl} alt={photo.name} className="h-40 w-full object-cover transition group-hover:scale-105" />
                  <span className={`absolute bottom-2 right-2 rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white ${TYPE_BADGE[type] ?? "bg-slate-700"}`}>
                    {TYPE_LABEL[type] ?? type}
                  </span>
                </button>
                <div className="flex items-center justify-between gap-1 px-2 py-2">
                  <p className="min-w-0 truncate text-[10px] font-bold text-slate-500">{photo.uploadedBy ?? "Office"}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    {onEditPhoto && photo.dataUrl && (
                      <button type="button" onClick={() => onEditPhoto(photo)} className="rounded-full bg-orange-50 p-1.5 text-orange-600 hover:bg-orange-100" title="Edit / Note">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button type="button" onClick={() => downloadPhoto(photo)} className="rounded-full bg-slate-100 p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-700" title="Download">
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fullscreen lightbox */}
      {active && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/95" onClick={close}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
            <div className="min-w-0">
              <p className="truncate text-sm font-black">{active.name}</p>
              <p className="text-xs text-slate-400">{(activeIndex ?? 0) + 1} of {lightboxPool.length} · {active.photoType}</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setZoomed((v) => !v)} className="rounded-full bg-white/10 p-2 hover:bg-white/20">
                {zoomed ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}
              </button>
              {onEditPhoto && active.dataUrl && (
                <button type="button" onClick={() => { onEditPhoto(active); close(); }} className="inline-flex items-center gap-1.5 rounded-full bg-orange-500 px-3 py-2 text-sm font-black hover:bg-orange-600">
                  <Pencil className="h-4 w-4" /> Edit
                </button>
              )}
              <button type="button" onClick={() => downloadPhoto(active)} className="rounded-full bg-white/10 p-2 hover:bg-white/20">
                <Download className="h-5 w-5" />
              </button>
              <button type="button" onClick={close} className="rounded-full bg-white/10 p-2 hover:bg-white/20">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="relative flex flex-1 items-center justify-center overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {lightboxPool.length > 1 && (
              <button type="button" onClick={() => showAt((activeIndex ?? 0) - 1)} className="absolute left-2 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.dataUrl}
              alt={active.name}
              onClick={() => setZoomed((v) => !v)}
              className={`max-h-full select-none object-contain transition-transform ${zoomed ? "scale-150 cursor-zoom-out" : "max-w-full cursor-zoom-in"}`}
            />
            {lightboxPool.length > 1 && (
              <button type="button" onClick={() => showAt((activeIndex ?? 0) + 1)} className="absolute right-2 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </div>
          {/* Thumbnail strip in lightbox */}
          {lightboxPool.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto bg-black/80 px-3 py-2">
              {lightboxPool.map((p, i) => (
                <button key={p.id} type="button" onClick={() => showAt(i)} className={`shrink-0 overflow-hidden rounded-lg border-2 transition ${i === activeIndex ? "border-white" : "border-transparent opacity-60 hover:opacity-100"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.dataUrl} alt="" className="h-14 w-20 object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
