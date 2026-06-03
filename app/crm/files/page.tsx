"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { FolderOpen, ImageIcon, Search, UploadCloud } from "lucide-react";
import type { CrmFileFolder } from "@/lib/crm-files";
import { loadCrewDataset, subscribeToCrewData, type JobPhoto, type JobRecord } from "@/lib/crew-sync";

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function createFolderId(address: string) {
  return address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildFolders(jobs: JobRecord[], photos: JobPhoto[]): CrmFileFolder[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const folders = new Map<string, CrmFileFolder>();

  photos.forEach((photo) => {
    const job = jobsById.get(photo.jobId);
    const address = job ? `${job.address}, ${job.city}, AZ` : photo.jobId;
    const folderId = createFolderId(address) || photo.jobId;
    const folder = folders.get(folderId) || {
      id: folderId,
      name: address,
      address,
      workType: job?.jobScope || job?.roofType || "Roofing",
      jobId: photo.jobId,
      customerName: job?.name || "Unknown customer",
      updatedAt: photo.createdAt,
      files: [],
    };
    folder.files.push({
      id: photo.id,
      name: photo.name || `${photo.photoType} photo`,
      dataUrl: photo.dataUrl,
      uploadedAt: photo.createdAt,
      uploadedBy: photo.uploadedBy,
      photoType: photo.photoType,
      jobId: photo.jobId,
      jobName: job?.name || "Unknown customer",
    });
    if (photo.createdAt > folder.updatedAt) folder.updatedAt = photo.createdAt;
    folders.set(folderId, folder);
  });

  return Array.from(folders.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export default function FilesPage() {
  const [folders, setFolders] = useState<CrmFileFolder[]>([]);
  const [search, setSearch] = useState("");
  const filteredFolders = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return folders;

    return folders.filter((folder) => [folder.name, folder.address, folder.workType, folder.customerName].some((value) => value.toLowerCase().includes(query)));
  }, [folders, search]);
  const totalPhotos = folders.reduce((total, folder) => total + folder.files.length, 0);

  const refreshFolders = useCallback(async () => {
    const data = await loadCrewDataset();
    setFolders(buildFolders(data.jobs, data.photos));
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadCrewDataset().then((data) => {
      if (mounted) setFolders(buildFolders(data.jobs, data.photos));
    }).catch(() => {});

    const unsubscribe = subscribeToCrewData(() => {
      void refreshFolders().catch(() => {});
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [refreshFolders]);

  return (
    <div className="space-y-5">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">CRM Storage</p>
            <h1 className="mt-2 text-3xl font-black text-[#07183f]">Files & Photo Uploads</h1>
            <p className="mt-2 text-slate-600">Crew uploaded photos sync here automatically into folders by property address and work type.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-2xl bg-blue-50 px-5 py-3"><p className="text-2xl font-black text-blue-700">{folders.length}</p><p className="text-xs font-black uppercase text-blue-600">Folders</p></div>
            <div className="rounded-2xl bg-orange-50 px-5 py-3"><p className="text-2xl font-black text-orange-700">{totalPhotos}</p><p className="text-xs font-black uppercase text-orange-600">Photos</p></div>
          </div>
        </div>

        <div className="relative mt-5 max-w-xl">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="Search address, customer, repair, maintenance..." />
        </div>
      </section>

      {filteredFolders.length === 0 ? (
        <section className="rounded-[2rem] border-2 border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          <UploadCloud className="mx-auto h-12 w-12 text-orange-500" />
          <p className="mt-4 font-black text-[#07183f]">No synced crew photos yet</p>
          <p className="mt-1 text-sm text-slate-500">When crew members upload before or after photos, a folder will appear here automatically.</p>
        </section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {filteredFolders.map((folder) => (
            <article key={folder.id} className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-black text-[#07183f]"><FolderOpen className="h-5 w-5 text-blue-600" />{folder.name}</div>
                    <h2 className="mt-2 text-xl font-black text-[#07183f]">{folder.workType}</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500">{folder.customerName}</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{folder.files.length} photos</span>
                </div>
                <p className="mt-3 text-xs font-bold text-slate-500">Last updated {formatDate(folder.updatedAt)}</p>
              </div>

              <div className="grid gap-3 p-5 sm:grid-cols-2">
                {folder.files.map((file) => (
                  <div key={file.id} className="rounded-2xl border border-slate-200 bg-white p-2">
                    <Image src={file.dataUrl} alt={file.name} width={420} height={280} unoptimized className="h-40 w-full rounded-xl object-cover" />
                    <div className="mt-3 flex items-start gap-2 px-1 pb-1">
                      <ImageIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-800">{file.name}</p>
                        <p className="mt-1 text-xs font-bold text-slate-500">{file.photoType} photo by {file.uploadedBy}</p>
                        <p className="mt-1 text-xs text-slate-400">{formatDate(file.uploadedAt)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
