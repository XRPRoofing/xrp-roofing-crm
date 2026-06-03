"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Calendar, Check, Copy, FolderOpen, Lock, Share2, X } from "lucide-react";
import { buildFoldersFromCrew, type CrmFileFolder } from "@/lib/crm-files";
import { loadCrewDataset, subscribeToCrewData } from "@/lib/crew-sync";
import PhotoGallery, { type GalleryPhoto } from "@/components/files/PhotoGallery";

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function FolderGalleryPage() {
  const params = useParams<{ folderId: string }>();
  const folderId = decodeURIComponent(params.folderId);

  const [folder, setFolder] = useState<CrmFileFolder | null>(null);
  const [loading, setLoading] = useState(true);
  const [showShare, setShowShare] = useState(false);

  const refresh = useCallback(async () => {
    const data = await loadCrewDataset();
    const match = buildFoldersFromCrew(data.jobs, data.photos).find((item) => item.id === folderId) || null;
    setFolder(match);
    setLoading(false);
  }, [folderId]);

  useEffect(() => {
    let mounted = true;
    void loadCrewDataset()
      .then((data) => {
        if (!mounted) return;
        const match = buildFoldersFromCrew(data.jobs, data.photos).find((item) => item.id === folderId) || null;
        setFolder(match);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    const unsubscribe = subscribeToCrewData(() => {
      void refresh().catch(() => {});
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [folderId, refresh]);

  const photos = useMemo<GalleryPhoto[]>(
    () =>
      (folder?.files || []).map((file) => ({
        id: file.id,
        name: file.name,
        dataUrl: file.dataUrl,
        photoType: file.photoType,
        uploadedBy: file.uploadedBy,
        uploadedAt: file.uploadedAt,
      })),
    [folder],
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
              <button onClick={() => setShowShare(true)} className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white shadow-sm transition hover:bg-blue-700">
                <Share2 className="h-4 w-4" /> Share Folder
              </button>
            </div>
          </section>

          {photos.length === 0 ? (
            <section className="rounded-[2rem] border-2 border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-500">No photos in this folder yet.</section>
          ) : (
            <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
              <PhotoGallery photos={photos} />
            </section>
          )}
        </>
      )}

      {showShare && folder && <ShareFolderModal folder={folder} onClose={() => setShowShare(false)} />}
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
