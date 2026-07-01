"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Calendar, Camera, Check, ClipboardList, Copy, FileText, FolderOpen, Lock, Share2, UploadCloud, X } from "lucide-react";
import LiveCameraCapture from "@/components/LiveCameraCapture";
import { buildFoldersFromCrew, type CrmFileFolder } from "@/lib/crm-files";
import { addJobPhotos, deleteJobPhoto, loadJobPhotos, subscribeToCrewData, updateJobPhotoType } from "@/lib/crew-sync";
import { ensureManualFolderJob, loadManualFolders, manualFoldersUpdatedEvent } from "@/lib/manual-folders";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { refreshCrewData } from "@/lib/data-cache";
import { compressImageToDataUrl } from "@/lib/image-compress";
import { azDateTime, azDate } from "@/lib/arizona-time";
import PhotoGallery, { type GalleryPhoto } from "@/components/files/PhotoGallery";
import type { JobPhotoType } from "@/lib/crew-sync";
import PhotoAnnotator, { type AnnotatedResult, type AnnotatorImage } from "@/components/crm/PhotoAnnotator";

function formatDate(value: string) {
  return azDateTime(value);
}

export default function FolderGalleryPage() {
  const params = useParams<{ folderId: string }>();
  const folderId = decodeURIComponent(params.folderId);

  const [folder, setFolder] = useState<CrmFileFolder | null>(null);
  const [imagesById, setImagesById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showShare, setShowShare] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [annotatorImages, setAnnotatorImages] = useState<AnnotatorImage[] | null>(null);
  const [annotatorKey, setAnnotatorKey] = useState(0);
  const editTargetRef = useRef<{ photoId: string; photoType: GalleryPhoto["photoType"] } | null>(null);
  const [activePhotoType, setActivePhotoType] = useState<"Before" | "Progress" | "After" | "Job Photo" | "General">("General");
  const [liveCameraOpen, setLiveCameraOpen] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});

  // The crew dataset is metadata-only (no image bytes), so fetch the actual
  // images for this folder's job(s) on demand and key them by photo id.
  const loadFolderImages = useCallback(async (target: CrmFileFolder | null) => {
    if (!target) {
      setImagesById({});
      return;
    }
    const jobIds = Array.from(new Set(target.files.map((file) => file.jobId)));
    const results = await Promise.all(jobIds.map((jobId) => loadJobPhotos(jobId)));
    const map: Record<string, string> = {};
    results.flat().forEach((photo) => {
      if (photo.dataUrl) map[photo.id] = photo.dataUrl;
    });
    setImagesById(map);
  }, []);

  const refresh = useCallback(async () => {
    const [data, manual] = await Promise.all([refreshCrewData(), loadManualFolders()]);
    const crewMatch = buildFoldersFromCrew(data.jobs, data.photos).find((item) => item.id === folderId) || null;
    const meta = manual.find((item) => item.id === folderId) || null;
    // Manual folder metadata (nice name/address) wins; fall back to the
    // crew-derived folder for auto folders.
    const resolved: CrmFileFolder | null = meta
      ? {
          id: meta.id,
          name: meta.name,
          address: meta.address,
          workType: meta.workType,
          jobId: meta.id,
          customerName: meta.customerName || crewMatch?.customerName || "",
          updatedAt: crewMatch?.updatedAt || meta.createdAt,
          files: crewMatch?.files || [],
        }
      : crewMatch;
    setFolder(resolved);
    await loadFolderImages(resolved);
    setLoading(false);
  }, [folderId, loadFolderImages]);

  useEffect(() => {
    void refresh().catch(() => setLoading(false));

    const unsubscribe = subscribeToCrewData(() => {
      void refresh().catch(() => {});
    });
    const onManual = () => { void refresh().catch(() => {}); };
    window.addEventListener(manualFoldersUpdatedEvent, onManual);
    return () => {
      unsubscribe();
      window.removeEventListener(manualFoldersUpdatedEvent, onManual);
    };
  }, [refresh]);

  useAutoRefresh(() => { void refresh().catch(() => {}); });

  // Manual folders need their backing job row to exist before photos can be
  // saved (foreign key). Idempotent + heals folders made before this existed.
  const ensureBackingJob = useCallback(async () => {
    if (!folder || !folder.id.startsWith("manual-")) return;
    await ensureManualFolderJob({
      id: folder.id,
      name: folder.name,
      address: folder.address,
      workType: folder.workType,
      customerName: folder.customerName,
      createdAt: folder.updatedAt || new Date().toISOString(),
    });
  }, [folder]);

  // Capture/upload photos straight into this folder — saved instantly, no forced
  // markup step. (Markup/notes are available later per-photo from the gallery.)
  const addPhotos = useCallback(async (files: FileList | null, photoType: "Before" | "Progress" | "After" | "Job Photo" = "Job Photo") => {
    if (!files?.length || !folder) return;
    const list = Array.from(files);
    setUploading(true);
    setError("");
    try {
      await ensureBackingJob();
      const dataUrls = await Promise.all(list.map((file) => compressImageToDataUrl(file)));
      const photoPayloads = dataUrls.map((dataUrl, index) => ({
        photoType,
        name: list[index].name || `photo-${Date.now()}-${index + 1}.jpg`,
        dataUrl,
        uploadedBy: "Office",
      }));
      await addJobPhotos(folder.jobId, photoPayloads);
      // Optimistic update: show new photos instantly without reloading all crew data.
      // The realtime subscription will reconcile with server-assigned IDs.
      const now = new Date().toISOString();
      const newFiles = photoPayloads.map((p, i) => ({
        id: `optimistic-${Date.now()}-${i}`,
        name: p.name,
        dataUrl: p.dataUrl,
        uploadedAt: now,
        uploadedBy: p.uploadedBy,
        photoType: p.photoType as "Before" | "Progress" | "After" | "Job Photo",
        jobId: folder.jobId,
        jobName: folder.customerName,
      }));
      setFolder((prev) => prev ? { ...prev, files: [...prev.files, ...newFiles] } : prev);
      setImagesById((prev) => {
        const next = { ...prev };
        newFiles.forEach((f) => { next[f.id] = f.dataUrl; });
        return next;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to add photos.");
    } finally {
      setUploading(false);
    }
  }, [folder, ensureBackingJob]);

  // Open the markup editor for an existing photo. Saving replaces the
  // original with the annotated version (same type, new flattened image).
  const editPhoto = useCallback((photo: GalleryPhoto) => {
    if (!photo.dataUrl) return;
    editTargetRef.current = { photoId: photo.id, photoType: photo.photoType };
    setAnnotatorKey((key) => key + 1);
    setAnnotatorImages([{ name: photo.name, dataUrl: photo.dataUrl }]);
  }, []);

  const handleAnnotated = useCallback(async (results: AnnotatedResult[]) => {
    setAnnotatorImages(null);
    const target = editTargetRef.current;
    editTargetRef.current = null;
    if (!folder || results.length === 0) return;
    setError("");
    try {
      await ensureBackingJob();
      // Delete the original photo and add the annotated version
      if (target?.photoId && !target.photoId.startsWith("local-")) {
        try { await deleteJobPhoto(target.photoId); } catch { /* ignore if already gone */ }
      }
      const photoType = (target?.photoType as "Before" | "Progress" | "After" | "Job Photo") || "Job Photo";
      const photoPayloads = results.map((result) => ({
        photoType,
        name: result.name,
        dataUrl: result.dataUrl,
        uploadedBy: "Office",
      }));
      await addJobPhotos(folder.jobId, photoPayloads);
      // Optimistic update: replace deleted photo with annotated version instantly.
      const now = new Date().toISOString();
      const newFiles = photoPayloads.map((p, i) => ({
        id: `optimistic-${Date.now()}-${i}`,
        name: p.name,
        dataUrl: p.dataUrl,
        uploadedAt: now,
        uploadedBy: p.uploadedBy,
        photoType: p.photoType as "Before" | "Progress" | "After" | "Job Photo",
        jobId: folder.jobId,
        jobName: folder.customerName,
      }));
      setFolder((prev) => {
        if (!prev) return prev;
        const filtered = target?.photoId ? prev.files.filter((f) => f.id !== target.photoId) : prev.files;
        return { ...prev, files: [...filtered, ...newFiles] };
      });
      setImagesById((prev) => {
        const next = { ...prev };
        if (target?.photoId) delete next[target.photoId];
        newFiles.forEach((f) => { next[f.id] = f.dataUrl; });
        return next;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save edited photo.");
    }
  }, [folder, ensureBackingJob]);

  const photos = useMemo<GalleryPhoto[]>(
    () =>
      (folder?.files || []).map((file) => ({
        id: file.id,
        name: file.name,
        dataUrl: imagesById[file.id] || file.dataUrl,
        photoType: file.photoType,
        uploadedBy: file.uploadedBy,
        uploadedAt: file.uploadedAt,
      })),
    [folder, imagesById],
  );

  return (
    <div className="space-y-5">
      <Link href="/crm/files" className="inline-flex items-center gap-2 text-sm font-bold text-blue-700"><ArrowLeft className="h-4 w-4" /> Back to all folders</Link>

      {loading ? (
        <section className="rounded-[2rem] border border-gray-200 bg-white p-12 text-center text-gray-500">Loading folder…</section>
      ) : !folder ? (
        <section className="rounded-[2rem] border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center">
          <FolderOpen className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-4 font-bold text-blue-700">Folder not found</p>
          <p className="mt-1 text-sm text-gray-500">This job folder may have no photos yet.</p>
        </section>
      ) : (
        <>
          {/* CompanyCam-style folder header */}
          <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
            {/* Cover photo strip */}
            {photos.length > 0 && photos[0].dataUrl ? (
              <div className="relative h-40 w-full bg-gray-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photos[0].dataUrl} alt="Cover" className="h-full w-full object-cover opacity-80" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <span className="absolute bottom-3 left-4 text-xs font-bold text-white/70">{folder.files.length} photos</span>
              </div>
            ) : (
              <div className="flex h-28 items-center justify-center bg-gray-100">
                <FolderOpen className="h-10 w-10 text-gray-300" />
              </div>
            )}

            {/* Address + meta */}
            <div className="px-5 pt-4 pb-3">
              <h1 className="text-xl font-bold text-blue-700">{folder.address}</h1>
              <p className="mt-0.5 text-sm font-bold text-gray-500">{folder.customerName}{folder.workType ? ` · ${folder.workType}` : ""}</p>
              <p className="mt-1 text-xs font-semibold text-gray-400">Last updated {formatDate(folder.updatedAt)}</p>
            </div>

            {/* Photo type filter tabs */}
            <div className="flex gap-1 overflow-x-auto px-5 pb-3">
              {(["General", "Before", "Progress", "After"] as const).map((t) => {
                const count = t === "General" ? photos.length : photos.filter((p) => p.photoType === t).length;
                return (
                  <button key={t} type="button" onClick={() => setActivePhotoType(t as typeof activePhotoType)}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      activePhotoType === t
                        ? t === "Before" ? "bg-blue-600 text-white" : t === "Progress" ? "bg-orange-500 text-white" : t === "After" ? "bg-blue-600 text-white" : "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}>
                    {t} {count > 0 && <span className="opacity-70">({count})</span>}
                  </button>
                );
              })}
            </div>

            {/* Action row */}
            <div className="flex items-center gap-2 border-t border-gray-100 px-5 py-3 overflow-x-auto">
              <button type="button" disabled={uploading} onClick={() => setLiveCameraOpen(true)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-900 active:scale-95 ${uploading ? "opacity-60" : ""}`}>
                <Camera className="h-4 w-4" /> Camera
              </button>
              <label className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-bold text-blue-700 transition hover:bg-blue-100 ${uploading ? "opacity-60" : ""}`}>
                <UploadCloud className="h-4 w-4" /> Upload
                <input type="file" accept="image/*,video/*" multiple className="hidden" disabled={uploading} onChange={(event) => { void addPhotos(event.target.files, activePhotoType === "General" ? "Job Photo" : activePhotoType); event.target.value = ""; }} />
              </label>
              <button onClick={() => setShowReport(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-50 border border-orange-200 px-4 py-2.5 text-sm font-bold text-orange-700 transition hover:bg-orange-100">
                <ClipboardList className="h-4 w-4" /> Report
              </button>
              <button onClick={() => setShowShare(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700">
                <Share2 className="h-4 w-4" /> Share
              </button>
            </div>

            {error && <p className="mx-5 mb-3 rounded-lg bg-orange-50 px-4 py-2 text-sm font-bold text-orange-700">{error}</p>}
            {uploading && <p className="px-5 pb-3 text-sm font-bold text-blue-600">Saving photos…</p>}
          </section>

          {photos.length === 0 ? (
            <section className="rounded-[2rem] border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center text-gray-500">No photos in this folder yet. Use <span className="font-bold text-gray-700">Camera</span> or <span className="font-bold text-gray-700">Upload</span> above to add some.</section>
          ) : (
            <section className="rounded-[2rem] border border-gray-200 bg-white p-5 shadow-sm">
              <PhotoGallery
                photos={photos}
                activeFilter={activePhotoType}
                onEditPhoto={editPhoto}
                onChangePhotoType={async (photo, newType) => {
                  try {
                    await updateJobPhotoType(photo.id, newType as JobPhotoType);
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed to change photo type.");
                  }
                }}
                onDeletePhoto={async (photoId) => {
                  try {
                    await deleteJobPhoto(photoId);
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed to delete photo.");
                  }
                }}
              />
            </section>
          )}
        </>
      )}

      {showShare && folder && <ShareFolderModal folder={folder} onClose={() => setShowShare(false)} />}
      <PhotoAnnotator key={annotatorKey} images={annotatorImages} onComplete={handleAnnotated} onCancel={() => { editTargetRef.current = null; setAnnotatorImages(null); }} />

      {liveCameraOpen && folder && (() => {
        const accentMap: Record<string, string> = { Before: "bg-blue-600", Progress: "bg-orange-500", After: "bg-blue-600", "Job Photo": "bg-blue-600" };
        const existingCount = (folder.files ?? []).filter((f) => f.photoType === activePhotoType).length;
        return (
          <LiveCameraCapture
            label={activePhotoType === "Job Photo" ? "General" : activePhotoType}
            accentColor={accentMap[activePhotoType] ?? "bg-blue-600"}
            existingCount={existingCount}
            onCapture={async (photo) => {
              // Save directly — no blocking setUploading so shutter stays instant
              await ensureBackingJob();
              await addJobPhotos(folder.jobId, [{
                photoType: activePhotoType === "General" ? "Job Photo" : activePhotoType,
                name: photo.name,
                dataUrl: photo.dataUrl,
                uploadedBy: "Office",
              }]);
              // Refresh gallery in background without blocking next shot
              void refresh();
            }}
            onClose={() => { setLiveCameraOpen(false); void refresh(); }}
          />
        );
      })()}

      {/* Job Report Modal */}
      {showReport && folder && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-white overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4 shadow-sm print:hidden">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-orange-600" />
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-orange-600">Job Report</p>
                <p className="text-sm font-bold text-blue-700">{folder.address}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-900"
              >
                <FileText className="h-4 w-4" /> Print / Save PDF
              </button>
              <button type="button" onClick={() => setShowReport(false)} className="rounded-full bg-gray-100 p-2 text-gray-600 hover:bg-gray-200">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Report body */}
          <div className="mx-auto w-full max-w-2xl space-y-8 px-5 py-8">
            {/* Cover info */}
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-700">{folder.address}</p>
              <p className="mt-1 font-bold text-gray-600">{folder.customerName}</p>
              {folder.workType && <p className="text-sm font-semibold text-gray-500">{folder.workType}</p>}
              <p className="mt-1 text-xs font-semibold text-gray-400">Generated {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
            </div>

            {/* Summary row */}
            <div className="grid grid-cols-4 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
              {(["General", "Before", "Progress", "After"] as const).map((t) => {
                const cnt = t === "General" ? photos.length : photos.filter((p) => p.photoType === t).length;
                return (
                  <div key={t} className="text-center">
                    <p className="text-2xl font-bold text-blue-700">{cnt}</p>
                    <p className="text-xs font-bold text-gray-500">{t}</p>
                  </div>
                );
              })}
            </div>

            {/* Sections per photo type */}
            {(["Before", "Progress", "After", "Job Photo"] as const).map((type) => {
              const group = photos.filter((p) => p.photoType === type);
              if (group.length === 0) return null;
              const label = type === "Job Photo" ? "General" : type;
              return (
                <div key={type}>
                  <div className="mb-3 flex items-center gap-2">
                    <span className={`rounded-lg px-2.5 py-1 text-xs font-bold text-white ${type === "Before" ? "bg-blue-600" : type === "Progress" ? "bg-orange-500" : type === "After" ? "bg-blue-600" : "bg-gray-700"}`}>{label}</span>
                    <span className="text-sm font-bold text-gray-500">{group.length} photo{group.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="space-y-4">
                    {group.map((photo, idx) => (
                      <div key={photo.id} className="flex gap-4 rounded-lg border border-gray-200 bg-white p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.dataUrl} alt={photo.name} className="h-24 w-32 shrink-0 rounded-lg object-cover" />
                        <div className="flex flex-1 flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-700">{idx + 1}</span>
                            <p className="text-xs font-bold text-gray-500">{photo.uploadedBy ?? "Crew"} · {photo.uploadedAt ? azDate(photo.uploadedAt) : ""}</p>
                          </div>
                          <textarea
                            value={reportNotes[photo.id] ?? ""}
                            onChange={(e) => setReportNotes((prev) => ({ ...prev, [photo.id]: e.target.value }))}
                            placeholder="Add findings or notes for this photo…"
                            rows={2}
                            className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-blue-300 focus:bg-white print:border-0 print:bg-transparent print:text-gray-700"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            <p className="text-center text-xs font-semibold text-gray-400">— End of Report · {folder.address} —</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ShareFolderModal({ folder, onClose }: { folder: CrmFileFolder; onClose: () => void }) {
  const [expiresAt, setExpiresAt] = useState("");
  const [password, setPassword] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/folders/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: folder.id,
          jobId: folder.jobId,
          address: folder.address,
          customerName: folder.customerName,
          workType: folder.workType,
          expiresAt: expiresAt || undefined,
          password: password || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create share link");
      setLink(`${window.location.origin}/share/${data.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create share link");
    } finally {
      setCreating(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-blue-700">Share Folder</h2>
            <p className="mt-1 text-sm text-gray-500">{folder.address}</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-gray-100 p-2 text-gray-600"><X className="h-4 w-4" /></button>
        </div>

        {link ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm font-semibold text-gray-600">Anyone with this link can view all {folder.files.length} photos — no CRM login required.</p>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
              <input readOnly value={link} className="min-w-0 flex-1 bg-transparent px-2 text-sm font-semibold text-gray-700 outline-none" />
              <button onClick={copy} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">
                {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
              </button>
            </div>
            {expiresAt && <p className="text-xs font-bold text-gray-500">Link expires {azDate(expiresAt)}.</p>}
            {password && <p className="text-xs font-bold text-gray-500">Protected with a password — share it separately with the customer.</p>}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500"><Calendar className="h-4 w-4" /> Expiration date (optional)</span>
              <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white" />
            </label>
            <label className="block">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500"><Lock className="h-4 w-4" /> Password (optional)</span>
              <input type="text" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Leave blank for no password" className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white" />
            </label>
            {error && <p className="text-sm font-bold text-orange-600">{error}</p>}
            <button onClick={generate} disabled={creating} className="w-full rounded-lg bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-60">
              {creating ? "Generating…" : "Generate secure link"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
