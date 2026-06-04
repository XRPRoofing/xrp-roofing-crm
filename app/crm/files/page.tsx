"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FolderOpen, Search, UploadCloud } from "lucide-react";
import { buildFoldersFromCrew, type CrmFileFolder } from "@/lib/crm-files";
import { loadCrewDataset, subscribeToCrewData } from "@/lib/crew-sync";

function formatDate(value: string) {
  return new Date(value).toLocaleString();
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
    setFolders(buildFoldersFromCrew(data.jobs, data.photos));
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadCrewDataset().then((data) => {
      if (mounted) setFolders(buildFoldersFromCrew(data.jobs, data.photos));
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
            <p className="crm-board-subtitle mt-2 text-slate-600">Crew uploaded photos sync here automatically into folders by property address and work type.</p>
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
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredFolders.map((folder) => (
            <Link
              key={folder.id}
              href={`/crm/files/${encodeURIComponent(folder.id)}`}
              className="group flex flex-col rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><FolderOpen className="h-6 w-6" /></span>
                <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700">{folder.files.length} {folder.files.length === 1 ? "photo" : "photos"}</span>
              </div>
              <h2 className="mt-4 text-lg font-black leading-snug text-[#07183f]">{folder.address}</h2>
              <p className="mt-1 text-sm font-bold text-slate-600">{folder.customerName}</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-500">{folder.workType}</p>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                <p className="text-xs font-bold text-slate-400">Last updated {formatDate(folder.updatedAt)}</p>
                <span className="flex items-center gap-1 text-xs font-black text-blue-600 opacity-0 transition group-hover:opacity-100">Open <ChevronRight className="h-4 w-4" /></span>
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
