"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Calendar, Camera, Check, Copy, FolderOpen, Lock, Share2, UploadCloud, X } from "lucide-react";
import { buildFoldersFromCrew, type CrmFileFolder } from "@/lib/crm-files";
import { addJobPhotos, loadCrewDataset, loadJobPhotos, subscribeToCrewData } from "@/lib/crew-sync";
import { loadManualFolders, manualFoldersUpdatedEvent } from "@/lib/manual-folders";
import { compressImageToDataUrl } from "@/lib/image-compress";
import PhotoGallery, { type GalleryPhoto } from "@/components/files/PhotoGallery";
import PhotoAnnotator, { type AnnotatedResult, type AnnotatorImage } from "@/components/crm/PhotoAnnotator";

function formatDate(value: string) {
  return new Date(value).toLocaleString();
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
  const editTargetRef = useRef<{ photoType: GalleryPhoto["photoType"] } | null>(null);

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
    const [data, manual] = await Promise.all([loadCrewDataset(), loadManualFolders()]);
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

  // Capture/upload photos straight into this folder — saved instantly, no forced
  // markup step. (Markup/notes are available later per-photo from the gallery.)
  const addPhotos = useCallback(async (files: FileList | null) => {
    if (!files?.length || !folder) return;
    const list = Array.from(files);
    setUploading(true);
    setError("");
    try {
      const dataUrls = await Promise.all(list.map((file) => compressImageToDataUrl(file)));
      await addJobPhotos(folder.jobId, dataUrls.map((dataUrl, index) => ({
        photoType: "Job Photo" as const,
        name: list[index].name || `photo-${Date.now()}-${index + 1}.jpg`,
        dataUrl,
        uploadedBy: "Office",
      })));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to add photos.");
    } finally {
      setUploading(false);
    }
  }, [folder, refresh]);

  // Open the markup editor for an existing photo. Saving produces a NEW flattened
  // image (drawing + note baked in) added back into this same folder.
  const editPhoto = useCallback((photo: GalleryPhoto) => {
    if (!photo.dataUrl) return;
    editTargetRef.current = { photoType: photo.photoType };
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
      await addJobPhotos(folder.jobId, results.map((result) => ({
        photoType: (target?.photoType as "Before" | "Progress" | "After" | "Job Photo") || "Job Photo",
        name: result.name,
        dataUrl: result.dataUrl,
        uploadedBy: "Office",
      })));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save edited photo.");
    }
  }, [folder, refresh]);

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
      <Link href="/crm/files" className="inline-flex items-center gap-2 text-sm font-black text-blue-700"><ArrowLeft className="h-4 w-4" /> Back to all folders</Link>

      {loading ? (
        <section className="rounded-[2rem] border border-slate-200 bg-white p-12 text-center text-slate-500">Loading folder…</section>
      ) : !folder ? (
        <section className="rounded-[2rem] border-2 border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          <FolderOpen className="mx-auto h-12 w-12 text-slate-400" />
          <p className="mt-4 font-black text-[#07183f]">Folder not found</p>
          <p className="mt-1 text-sm text-slate-500">This job folder may have no photos yet.</p>
        </section>
      ) : (
        <>
          <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div className="flex items-start gap-4">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><FolderOpen className="h-7 w-7" /></span>
                <div>
                  <h1 className="text-2xl font-black text-[#07183f]">{folder.address}</h1>
                  <p className="mt-1 font-bold text-slate-600">{folder.customerName}</p>
                  <p className="text-sm font-semibold text-slate-500">{folder.workType}</p>
                  <p className="mt-2 text-xs font-bold text-slate-400">{folder.files.length} photos · Last updated {formatDate(folder.updatedAt)}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className={`inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#07183f] px-4 py-3 font-bold text-white shadow-sm transition hover:bg-blue-900 ${uploading ? "opacity-60" : ""}`}>
                  <Camera className="h-4 w-4" /> Take Photo
                  <input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={uploading} onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} />
                </label>
                <label className={`inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-blue-300 bg-blue-50 px-4 py-3 font-bold text-blue-700 transition hover:bg-blue-100 ${uploading ? "opacity-60" : ""}`}>
                  <UploadCloud className="h-4 w-4" /> Upload
                  <input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} />
                </label>
                <button onClick={() => setShowShare(true)} className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white shadow-sm transition hover:bg-blue-700">
                  <Share2 className="h-4 w-4" /> Share
                </button>
              </div>
            </div>
            {error && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-2 text-sm font-bold text-red-700">{error}</p>}
            {uploading && <p className="mt-3 text-sm font-bold text-blue-600">Saving photos…</p>}
            <p className="mt-3 text-xs font-semibold text-slate-500">Tip: photos save instantly. To draw or add a note, open a photo below and tap <span className="font-black text-slate-700">Edit / Note</span>.</p>
          </section>

          {photos.length === 0 ? (
            <section className="rounded-[2rem] border-2 border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-500">No photos in this folder yet. Use <span className="font-black text-slate-700">Take Photo</span> or <span className="font-black text-slate-700">Upload</span> above to add some.</section>
          ) : (
            <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
              <PhotoGallery photos={photos} onEditPhoto={editPhoto} />
            </section>
          )}
        </>
      )}

      {showShare && folder && <ShareFolderModal folder={folder} onClose={() => setShowShare(false)} />}
      <PhotoAnnotator key={annotatorKey} images={annotatorImages} onComplete={handleAnnotated} onCancel={() => { editTargetRef.current = null; setAnnotatorImages(null); }} />
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-black text-[#07183f]">Share Folder</h2>
            <p className="mt-1 text-sm text-slate-500">{folder.address}</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-600"><X className="h-4 w-4" /></button>
        </div>

        {link ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm font-semibold text-slate-600">Anyone with this link can view all {folder.files.length} photos — no CRM login required.</p>
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
              <input readOnly value={link} className="min-w-0 flex-1 bg-transparent px-2 text-sm font-semibold text-slate-700 outline-none" />
              <button onClick={copy} className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white">
                {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
              </button>
            </div>
            {expiresAt && <p className="text-xs font-bold text-slate-500">Link expires {new Date(expiresAt).toLocaleDateString()}.</p>}
            {password && <p className="text-xs font-bold text-slate-500">Protected with a password — share it separately with the customer.</p>}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500"><Calendar className="h-4 w-4" /> Expiration date (optional)</span>
              <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white" />
            </label>
            <label className="block">
              <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500"><Lock className="h-4 w-4" /> Password (optional)</span>
              <input type="text" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Leave blank for no password" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white" />
            </label>
            {error && <p className="text-sm font-bold text-red-600">{error}</p>}
            <button onClick={generate} disabled={creating} className="w-full rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-60">
              {creating ? "Generating…" : "Generate secure link"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
