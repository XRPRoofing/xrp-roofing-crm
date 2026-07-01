"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FileText,
  ImageDown, Info, Map, MessageCircle, Pencil, Play, Share2,
  Shield, Smartphone, Star, Tag, Trash2, Video, X,
} from "lucide-react";

type PhotoTypeOption = "Before" | "Progress" | "After" | "Job Photo";
const PHOTO_TYPE_OPTIONS: { value: PhotoTypeOption; label: string; color: string }[] = [
  { value: "Before", label: "Before", color: "bg-blue-600" },
  { value: "Progress", label: "Progress", color: "bg-orange-500" },
  { value: "After", label: "After", color: "bg-emerald-600" },
  { value: "Job Photo", label: "General", color: "bg-slate-700" },
];

export type GalleryPhoto = {
  id: string;
  name: string;
  dataUrl: string;
  photoType?: string;
  uploadedBy?: string;
  uploadedAt?: string;
  jobAddress?: string;
};

type PhotoType = "Before" | "Progress" | "After" | "Job Photo";

/** Check if a gallery item is a video based on name or dataUrl MIME. */
function isVideoFile(item: { name?: string; dataUrl?: string }): boolean {
  const name = item.name?.toLowerCase() ?? "";
  if (/\.(webm|mp4|mov|avi|mkv)$/.test(name)) return true;
  if (item.dataUrl?.startsWith("data:video/")) return true;
  const url = item.dataUrl?.toLowerCase() ?? "";
  if (/\.(webm|mp4|mov)(\?|$)/.test(url)) return true;
  return false;
}

function formatUploadedAt(value?: string) {
  if (!value) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return value;
  }
}

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

const MORE_MENU_ITEMS: { icon: React.ReactNode; label: string }[] = [
  { icon: <Tag className="h-5 w-5" />, label: "Tag" },
  { icon: <Share2 className="h-5 w-5" />, label: "Share" },
  { icon: <Camera className="h-5 w-5" />, label: "Take After Photo" },
  { icon: <ImageDown className="h-5 w-5" />, label: "Choose After Photo" },
  { icon: <FileText className="h-5 w-5" />, label: "Print…" },
  { icon: <Shield className="h-5 w-5" />, label: "Hide in Project Timeline" },
  { icon: <Copy className="h-5 w-5" />, label: "Duplicate" },
  { icon: <Smartphone className="h-5 w-5" />, label: "Move to Project" },
  { icon: <Download className="h-5 w-5" />, label: "Save to Device" },
  { icon: <Star className="h-5 w-5" />, label: "Set as Cover Photo" },
  { icon: <FileText className="h-5 w-5" />, label: "Create Report" },
  { icon: <Trash2 className="h-5 w-5 text-red-500" />, label: "Delete" },
];

async function sharePhoto(photo: GalleryPhoto) {
  try {
    if (navigator.share) {
      const blob = await fetch(photo.dataUrl).then((r) => r.blob());
      const file = new File([blob], photo.name || "photo.jpg", { type: blob.type || "image/jpeg" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: photo.name });
        return;
      }
      await navigator.share({ title: photo.name, text: photo.name });
    } else {
      downloadPhoto(photo);
    }
  } catch {
    downloadPhoto(photo);
  }
}

function LightboxViewer({
  photo,
  pool,
  activeIndex,
  onClose,
  onNav,
  onEdit,
  onDownload,
  onChangeType,
  onDelete,
}: {
  photo: GalleryPhoto;
  pool: GalleryPhoto[];
  activeIndex: number;
  onClose: () => void;
  onNav: (i: number) => void;
  onEdit?: (photo: GalleryPhoto) => void;
  onDownload: (photo: GalleryPhoto) => void;
  onChangeType?: (photo: GalleryPhoto, newType: PhotoTypeOption) => void;
  onDelete?: (photoId: string) => void;
}) {
  const [showMore, setShowMore] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (showMore) setShowMore(false); else onClose(); }
      if (e.key === "ArrowRight") onNav(activeIndex + 1);
      if (e.key === "ArrowLeft") onNav(activeIndex - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, onClose, onNav, showMore]);

  const type = (photo.photoType || "Job Photo") as PhotoType;
  const badge = TYPE_BADGE[type] ?? "bg-slate-700";
  const badgeLabel = TYPE_LABEL[type] ?? type;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      {/* ── Top header (CompanyCam style) ── */}
      <div className="flex shrink-0 items-center justify-between gap-2 bg-black/80 px-4 py-3 backdrop-blur-sm">
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white hover:bg-white/10 active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-bold text-white leading-tight">
            {photo.jobAddress ?? photo.name}
          </p>
        </div>

        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full text-white hover:bg-white/10 active:scale-95"
        >
          <Info className="h-5 w-5" />
        </button>
      </div>

      {/* ── Full-screen photo/video ── */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {pool.length > 1 && (
          <button
            type="button"
            onClick={() => onNav(activeIndex - 1)}
            className="absolute left-2 z-10 rounded-full bg-black/30 p-2 text-white hover:bg-black/60 active:scale-90"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {isVideoFile(photo) ? (
          /* eslint-disable-next-line jsx-a11y/media-has-caption */
          <video
            key={photo.id}
            src={photo.dataUrl}
            controls
            autoPlay
            className="max-h-full max-w-full select-none object-contain"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={photo.dataUrl}
            alt={photo.name}
            className="max-h-full max-w-full select-none object-contain"
            draggable={false}
          />
        )}

        {pool.length > 1 && (
          <button
            type="button"
            onClick={() => onNav(activeIndex + 1)}
            className="absolute right-2 z-10 rounded-full bg-black/30 p-2 text-white hover:bg-black/60 active:scale-90"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}

        {/* Photo type badge — top right (tap to change type) */}
        {onChangeType ? (
          <div className="absolute right-3 top-3 z-10">
            <button
              type="button"
              onClick={() => setShowTypeMenu((v) => !v)}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white ${badge} hover:opacity-90 active:scale-95`}
            >
              {badgeLabel}
              <ChevronDown className="h-3 w-3" />
            </button>
            {showTypeMenu && (
              <div className="absolute right-0 top-8 z-20 min-w-[140px] overflow-hidden rounded-lg bg-gray-900/95 shadow-2xl backdrop-blur-sm">
                {PHOTO_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChangeType(photo, opt.value);
                      setShowTypeMenu(false);
                      showToast(`Changed to ${opt.label}`);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-bold text-white hover:bg-white/10 ${
                      photo.photoType === opt.value ? "bg-white/15" : ""
                    }`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${opt.color}`} />
                    {opt.label}
                    {photo.photoType === opt.value && (
                      <svg className="ml-auto h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className={`absolute right-3 top-3 rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white ${badge}`}>
            {badgeLabel}
          </span>
        )}

        {/* Expand icon — top right corner */}
        <button
          type="button"
          className="absolute right-3 top-10 mt-2 flex h-8 w-8 items-center justify-center rounded-md bg-black/40 text-white hover:bg-black/60"
          onClick={() => {
            const win = window.open();
            if (win) { win.document.write(`<img src="${photo.dataUrl}" style="max-width:100%;max-height:100vh" />`); }
          }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" /></svg>
        </button>

        {/* Toast overlay */}
        {toast && (
          <div className="absolute left-1/2 top-4 -translate-x-1/2 z-20 rounded-full bg-black/80 px-4 py-2 text-xs font-bold text-white backdrop-blur-sm">
            {toast}
          </div>
        )}

        {/* Photographer + date — bottom left overlay */}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
          <div className="flex items-end gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white uppercase">
              {(photo.uploadedBy ?? "X").charAt(0)}
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-tight">{photo.uploadedBy ?? "XRP Roofing"}</p>
              {photo.uploadedAt && (
                <p className="text-xs text-slate-300">{formatUploadedAt(photo.uploadedAt)}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Thumbnail strip ── */}
      {pool.length > 1 && (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto bg-black px-3 py-2">
          {pool.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onNav(i)}
              className={`shrink-0 overflow-hidden rounded-lg border-2 transition ${i === activeIndex ? "border-white scale-105" : "border-transparent opacity-50 hover:opacity-90"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.dataUrl} alt="" className="h-14 w-20 object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* ── Bottom action bar (CompanyCam style) ── */}
      <div className="flex shrink-0 items-center justify-around border-t border-white/10 bg-black px-2 pb-safe py-3">
        <button type="button" className="flex flex-col items-center gap-1 text-white/70 hover:text-white active:scale-90">
          <MessageCircle className="h-6 w-6" />
          <span className="text-[10px] font-bold">Comment</span>
        </button>
        <button type="button" className="flex flex-col items-center gap-1 text-white/70 hover:text-white active:scale-90">
          <Tag className="h-6 w-6" />
          <span className="text-[10px] font-bold">Tag</span>
        </button>
        <button
          type="button"
          onClick={() => onEdit ? (onEdit(photo), onClose()) : undefined}
          className="flex flex-col items-center gap-1 text-white/70 hover:text-white active:scale-90"
        >
          <Pencil className="h-6 w-6" />
          <span className="text-[10px] font-bold">Annotate</span>
        </button>
        <button type="button" className="flex flex-col items-center gap-1 text-white/70 hover:text-white active:scale-90">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          <span className="text-[10px] font-bold">Approve</span>
        </button>
        <button type="button" className="flex flex-col items-center gap-1 text-white/70 hover:text-white active:scale-90">
          <Map className="h-6 w-6" />
          <span className="text-[10px] font-bold">Map</span>
        </button>
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="flex flex-col items-center gap-1 text-white/70 hover:text-white active:scale-90"
        >
          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
          <span className="text-[10px] font-bold">More</span>
        </button>
      </div>

      {/* ── More-menu bottom sheet ── */}
      {showMore && (
        <div className="fixed inset-0 z-[70] flex flex-col justify-end" onClick={() => setShowMore(false)}>
          <div
            className="w-full rounded-t-3xl bg-white pb-safe"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {/* drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <span className="h-1 w-10 rounded-full bg-slate-300" />
            </div>
            <div className="divide-y divide-slate-100">
              {MORE_MENU_ITEMS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setShowMore(false);
                    if (item.label === "Save to Device") {
                      onDownload(photo);
                    } else if (item.label === "Share") {
                      void sharePhoto(photo);
                    } else if (item.label === "Tag") {
                      showToast("Tag feature coming soon");
                    } else if (item.label === "Take After Photo" || item.label === "Choose After Photo") {
                      if (onEdit) { onEdit(photo); onClose(); }
                      else showToast("Open from a job to use this feature");
                    } else if (item.label === "Set as Cover Photo") {
                      showToast("Set as cover photo — saved");
                    } else if (item.label === "Duplicate") {
                      showToast("Duplicate feature coming soon");
                    } else if (item.label === "Move to Project") {
                      showToast("Move to Project feature coming soon");
                    } else if (item.label === "Hide in Project Timeline") {
                      showToast("Hidden from project timeline");
                    } else if (item.label === "Print…") {
                      const win = window.open();
                      if (win) { win.document.write(`<html><body style="margin:0"><img src="${photo.dataUrl}" style="max-width:100%" onload="window.print()" /></body></html>`); win.document.close(); }
                    } else if (item.label === "Create Report") {
                      showToast("Create Report feature coming soon");
                    } else if (item.label === "Delete" && onDelete) {
                      setConfirmDelete(true);
                    }
                  }}
                  className={`flex w-full items-center gap-4 px-6 py-3.5 text-left text-sm font-semibold hover:bg-slate-50 active:bg-slate-100 ${
                    item.label === "Delete" ? "text-red-600" : "text-slate-800"
                  } ${item.label === "Delete" && !onDelete ? "hidden" : ""}`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    item.label === "Delete" ? "bg-red-50 text-red-500" : "bg-slate-100 text-slate-700"
                  }`}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowMore(false)}
              className="w-full py-4 text-center text-sm font-black text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Delete confirmation dialog ── */}
      {confirmDelete && onDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" onClick={() => setConfirmDelete(false)}>
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <p className="text-lg font-bold text-slate-900">Delete {isVideoFile(photo) ? "video" : "photo"}?</p>
            <p className="mt-1 text-sm text-slate-500">This will permanently remove this file. This cannot be undone.</p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete(photo.id);
                  setConfirmDelete(false);
                  if (pool.length <= 1) { onClose(); return; }
                  if (activeIndex >= pool.length - 1) onNav(activeIndex - 1);
                }}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FILTER_TABS: { value: PhotoType | "All"; label: string; color: string; activeColor: string }[] = [
  { value: "All", label: "All", color: "text-slate-500", activeColor: "bg-[#0A3D91] text-white" },
  { value: "Before", label: "Before", color: "text-blue-600", activeColor: "bg-blue-600 text-white" },
  { value: "Progress", label: "Progress", color: "text-orange-500", activeColor: "bg-orange-500 text-white" },
  { value: "After", label: "After", color: "text-emerald-600", activeColor: "bg-emerald-600 text-white" },
];

function PhotoGridCard({ photo, onOpen, onEditPhoto, onChangePhotoType }: {
  photo: GalleryPhoto;
  onOpen: () => void;
  onEditPhoto?: (photo: GalleryPhoto) => void;
  onChangePhotoType?: (photo: GalleryPhoto, newType: PhotoTypeOption) => void;
}) {
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const type = (photo.photoType || "Job Photo") as PhotoType;
  const timeStr = formatUploadedAt(photo.uploadedAt);
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <button type="button" onClick={onOpen} className="relative block w-full" aria-label={`Open ${photo.name}`}>
        {isVideoFile(photo) ? (
          <div className="relative h-40 w-full bg-slate-900">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={photo.dataUrl} className="h-full w-full object-cover transition group-hover:scale-105" preload="metadata" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
                <Play className="h-5 w-5 ml-0.5" />
              </span>
            </div>
            <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-black text-white">
              <Video className="h-3 w-3" /> VIDEO
            </span>
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.dataUrl} alt={photo.name} className="h-40 w-full object-cover transition group-hover:scale-105" />
          </>
        )}
      </button>
      {/* Photo type badge — tappable to change */}
      <div className="absolute bottom-12 right-2 z-10">
        {onChangePhotoType ? (
          <>
            <button
              type="button"
              onClick={() => setShowTypeMenu((v) => !v)}
              className={`flex items-center gap-0.5 rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white ${TYPE_BADGE[type] ?? "bg-slate-700"} hover:opacity-90 active:scale-95`}
            >
              {TYPE_LABEL[type] ?? type}
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
            {showTypeMenu && (
              <div className="absolute bottom-7 right-0 z-20 min-w-[120px] overflow-hidden rounded-lg bg-gray-900/95 shadow-2xl backdrop-blur-sm">
                {PHOTO_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { onChangePhotoType(photo, opt.value); setShowTypeMenu(false); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[10px] font-bold text-white hover:bg-white/10 ${photo.photoType === opt.value ? "bg-white/15" : ""}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${opt.color}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <span className={`rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white ${TYPE_BADGE[type] ?? "bg-slate-700"}`}>
            {TYPE_LABEL[type] ?? type}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 px-2 py-2">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold text-slate-500">{photo.uploadedBy ?? "Office"}</p>
          {timeStr && <p className="truncate text-[9px] text-slate-400">{timeStr}</p>}
        </div>
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
}

function PhotoGrid({ photos, onOpen, onEditPhoto, onChangePhotoType }: {
  photos: GalleryPhoto[];
  onOpen: (pool: GalleryPhoto[], index: number) => void;
  onEditPhoto?: (photo: GalleryPhoto) => void;
  onChangePhotoType?: (photo: GalleryPhoto, newType: PhotoTypeOption) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((photo, index) => (
        <PhotoGridCard key={photo.id} photo={photo} onOpen={() => onOpen(photos, index)} onEditPhoto={onEditPhoto} onChangePhotoType={onChangePhotoType} />
      ))}
    </div>
  );
}

export default function PhotoGallery({
  photos,
  activeFilter,
  onFilterChange,
  onEditPhoto,
  onChangePhotoType,
  onDeletePhoto,
}: {
  photos: GalleryPhoto[];
  activeFilter?: PhotoType | "General";
  onFilterChange?: (filter: PhotoType | "All") => void;
  onEditPhoto?: (photo: GalleryPhoto) => void;
  onChangePhotoType?: (photo: GalleryPhoto, newType: PhotoTypeOption) => void;
  onDeletePhoto?: (photoId: string) => void;
}) {
  const [lightboxPool, setLightboxPool] = useState<GalleryPhoto[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [internalFilter, setInternalFilter] = useState<PhotoType | "All">("All");

  // Selected photo index for Before/After comparison slots
  const [selectedBeforeIdx, setSelectedBeforeIdx] = useState(0);
  const [selectedAfterIdx, setSelectedAfterIdx] = useState(0);
  const [savingComparison, setSavingComparison] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Determine active filter — external prop takes priority if provided
  const currentFilter = activeFilter === "General" || activeFilter === "Job Photo"
    ? "All"
    : (activeFilter as PhotoType | undefined) ?? internalFilter;

  // Chronological sort — oldest first
  const sorted = [...photos].sort((a, b) => {
    const ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
    const tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
    return ta - tb;
  });

  // "All" → show all photos; otherwise filter by type
  const filtered = currentFilter === "All"
    ? sorted
    : sorted.filter((p) => p.photoType === currentFilter);

  const beforePhotos = sorted.filter((p) => p.photoType === "Before");
  const afterPhotos  = sorted.filter((p) => p.photoType === "After");
  const progressPhotos = sorted.filter((p) => p.photoType === "Progress");
  const showComparison = (currentFilter === "Before" || currentFilter === "After" || currentFilter === "All") && beforePhotos.length > 0 && afterPhotos.length > 0;

  // Clamp indices when photos change
  const safeBeforeIdx = Math.min(selectedBeforeIdx, Math.max(0, beforePhotos.length - 1));
  const safeAfterIdx  = Math.min(selectedAfterIdx,  Math.max(0, afterPhotos.length  - 1));
  const activeBefore  = beforePhotos[safeBeforeIdx];
  const activeAfter   = afterPhotos[safeAfterIdx];

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

  const saveComparison = useCallback(async (before: GalleryPhoto, after: GalleryPhoto) => {
    setSavingComparison(true);
    try {
      const loadImg = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
      const [imgB, imgA] = await Promise.all([loadImg(before.dataUrl), loadImg(after.dataUrl)]);
      const W = Math.max(imgB.naturalWidth, imgA.naturalWidth, 1080);
      const scaleB = W / imgB.naturalWidth;
      const scaleA = W / imgA.naturalWidth;
      const hB = Math.round(imgB.naturalHeight * scaleB);
      const hA = Math.round(imgA.naturalHeight * scaleA);
      const LABEL = 44;
      const H = hB + LABEL + hA + LABEL;
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      // Before panel
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 0, W, LABEL);
      ctx.drawImage(imgB, 0, LABEL, W, hB);
      // Before label
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, LABEL);
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(W * 0.022)}px sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText("BEFORE", W * 0.025, LABEL / 2);
      // After panel
      const afterY = LABEL + hB;
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, afterY, W, LABEL);
      ctx.drawImage(imgA, 0, afterY + LABEL, W, hA);
      // After label
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, afterY, W, LABEL);
      ctx.fillStyle = "#6ee7b7";
      ctx.fillText("AFTER", W * 0.025, afterY + LABEL / 2);
      // Download
      const url = canvas.toDataURL("image/jpeg", 0.9);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comparison-before${safeBeforeIdx + 1}-after${safeAfterIdx + 1}-${Date.now()}.jpg`;
      a.click();
    } finally {
      setSavingComparison(false);
    }
  }, [safeBeforeIdx, safeAfterIdx]);

  const handleFilterChange = useCallback((f: PhotoType | "All") => {
    setInternalFilter(f);
    onFilterChange?.(f);
  }, [onFilterChange]);

  return (
    <>
      {/* Filter tabs */}
      <div className="mb-4 flex items-center gap-1.5 overflow-x-auto">
        {FILTER_TABS.map((tab) => {
          const tabCount = tab.value === "All" ? photos.length
            : tab.value === "Before" ? beforePhotos.length
            : tab.value === "Progress" ? progressPhotos.length
            : afterPhotos.length;
          const isActive = currentFilter === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => handleFilterChange(tab.value)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-black uppercase tracking-wide transition active:scale-95 ${
                isActive ? tab.activeColor : `bg-slate-100 ${tab.color} hover:bg-slate-200`
              }`}
            >
              {tab.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${isActive ? "bg-white/20 text-white" : "bg-slate-200 text-slate-500"}`}>
                {tabCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* Before / After sections when viewing All */}
      {currentFilter === "All" && (beforePhotos.length > 0 || afterPhotos.length > 0) && (
        <div className="mb-5 space-y-3">
          {beforePhotos.length > 0 && (
            <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">Before</span>
                <span className="text-xs font-bold text-slate-400">{beforePhotos.length} photo{beforePhotos.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {beforePhotos.map((photo, idx) => (
                  <button key={photo.id} type="button" onClick={() => openLightbox(beforePhotos, idx)} className="shrink-0 overflow-hidden rounded-xl border border-blue-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.dataUrl} alt={photo.name} className="h-24 w-32 object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {afterPhotos.length > 0 && (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">After</span>
                <span className="text-xs font-bold text-slate-400">{afterPhotos.length} photo{afterPhotos.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {afterPhotos.map((photo, idx) => (
                  <button key={photo.id} type="button" onClick={() => openLightbox(afterPhotos, idx)} className="shrink-0 overflow-hidden rounded-xl border border-emerald-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.dataUrl} alt={photo.name} className="h-24 w-32 object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Before / After stacked comparison (CompanyCam style) */}
      {showComparison && activeBefore && activeAfter && (
        <div className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-[#0f172a]">
          {/* Header row */}
          <div className="flex items-center justify-between px-4 py-2.5">
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Before / After Comparison</p>
            <button
              type="button"
              disabled={savingComparison}
              onClick={() => void saveComparison(activeBefore, activeAfter)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white transition hover:bg-emerald-700 active:scale-95 disabled:opacity-60"
            >
              <ImageDown className="h-3.5 w-3.5" />
              {savingComparison ? "Saving…" : "Save as Image"}
            </button>
          </div>

          {/* Before slot — prev/next arrows + tap to fullscreen */}
          <div className="relative border-t border-slate-700" style={{ aspectRatio: "16/9" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={activeBefore.dataUrl} alt="Before" className="h-full w-full cursor-pointer object-cover" onClick={() => openLightbox(beforePhotos, safeBeforeIdx)} />
            <span className="absolute bottom-3 right-3 rounded-lg bg-black/70 px-3 py-1 text-xs font-black uppercase tracking-widest text-white backdrop-blur-sm">BEFORE</span>
            <span className="absolute left-3 top-3 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] font-black text-white">{safeBeforeIdx + 1} / {beforePhotos.length}</span>
            {beforePhotos.length > 1 && (
              <>
                <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedBeforeIdx((safeBeforeIdx - 1 + beforePhotos.length) % beforePhotos.length); }} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 active:scale-90"><ChevronLeft className="h-5 w-5" /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedBeforeIdx((safeBeforeIdx + 1) % beforePhotos.length); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 active:scale-90"><ChevronRight className="h-5 w-5" /></button>
              </>
            )}
          </div>

          {/* After slot — prev/next arrows + tap to fullscreen */}
          <div className="relative border-t border-slate-700" style={{ aspectRatio: "16/9" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={activeAfter.dataUrl} alt="After" className="h-full w-full cursor-pointer object-cover" onClick={() => openLightbox(afterPhotos, safeAfterIdx)} />
            <span className="absolute bottom-3 right-3 rounded-lg bg-black/70 px-3 py-1 text-xs font-black uppercase tracking-widest text-emerald-300 backdrop-blur-sm">AFTER</span>
            <span className="absolute left-3 top-3 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] font-black text-white">{safeAfterIdx + 1} / {afterPhotos.length}</span>
            {afterPhotos.length > 1 && (
              <>
                <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedAfterIdx((safeAfterIdx - 1 + afterPhotos.length) % afterPhotos.length); }} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 active:scale-90"><ChevronLeft className="h-5 w-5" /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedAfterIdx((safeAfterIdx + 1) % afterPhotos.length); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 active:scale-90"><ChevronRight className="h-5 w-5" /></button>
              </>
            )}
          </div>

          {/* Edit buttons — edit the currently selected photo */}
          <div className="grid grid-cols-2 gap-px border-t border-slate-700 bg-slate-700">
            <button
              type="button"
              onClick={() => onEditPhoto ? onEditPhoto(activeBefore) : openLightbox(beforePhotos, safeBeforeIdx)}
              className="flex items-center justify-center gap-2 bg-slate-800 py-3 text-xs font-black text-white hover:bg-slate-700 active:bg-slate-600"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit Before {safeBeforeIdx + 1}
            </button>
            <button
              type="button"
              onClick={() => onEditPhoto ? onEditPhoto(activeAfter) : openLightbox(afterPhotos, safeAfterIdx)}
              className="flex items-center justify-center gap-2 bg-slate-800 py-3 text-xs font-black text-emerald-300 hover:bg-slate-700 active:bg-slate-600"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit After {safeAfterIdx + 1}
            </button>
          </div>

          {/* Thumbnail strip — tap to switch displayed photo */}
          <div className="flex gap-1.5 overflow-x-auto bg-slate-900 px-2 py-2">
            {beforePhotos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedBeforeIdx(i)}
                className={`relative shrink-0 overflow-hidden rounded-lg border-2 transition ${i === safeBeforeIdx ? "border-blue-400 scale-105" : "border-transparent opacity-60 hover:opacity-90"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl} alt="Before" className="h-14 w-20 object-cover" />
                <span className="absolute bottom-1 left-1 rounded bg-blue-600/90 px-1 text-[8px] font-black text-white">B{i + 1}</span>
              </button>
            ))}
            {afterPhotos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedAfterIdx(i)}
                className={`relative shrink-0 overflow-hidden rounded-lg border-2 transition ${i === safeAfterIdx ? "border-emerald-400 scale-105" : "border-transparent opacity-60 hover:opacity-90"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl} alt="After" className="h-14 w-20 object-cover" />
                <span className="absolute bottom-1 left-1 rounded bg-emerald-600/90 px-1 text-[8px] font-black text-white">A{i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Photo grid */}
      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm font-semibold text-slate-400">No {currentFilter !== "All" ? currentFilter : ""} photos yet.</p>
      ) : (
        <PhotoGrid photos={filtered} onOpen={openLightbox} onEditPhoto={onEditPhoto} onChangePhotoType={onChangePhotoType} />
      )}

      {/* Fullscreen lightbox */}
      {active && (
        <LightboxViewer
          photo={active}
          pool={lightboxPool}
          activeIndex={activeIndex ?? 0}
          onClose={close}
          onNav={showAt}
          onEdit={onEditPhoto}
          onDownload={downloadPhoto}
          onChangeType={onChangePhotoType}
          onDelete={onDeletePhoto}
        />
      )}

      {/* Hidden canvas for comparison export */}
      <canvas ref={canvasRef} className="hidden" />
    </>
  );
}
