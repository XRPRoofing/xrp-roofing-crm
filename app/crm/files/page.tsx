"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FolderOpen, FolderPlus, Search, UploadCloud, X } from "lucide-react";
import { buildFoldersFromCrew, type CrmFileFolder } from "@/lib/crm-files";
import { loadCrewDataset, subscribeToCrewData } from "@/lib/crew-sync";
import { createManualFolder, loadManualFolders, manualFoldersUpdatedEvent, type ManualFolder } from "@/lib/manual-folders";

/** Merge manually-created folders with the auto folders derived from crew jobs.
 *  Manual metadata wins for matching ids (manual photos share the folder id). */
function mergeFolders(crewFolders: CrmFileFolder[], manual: ManualFolder[]): CrmFileFolder[] {
  const crewById = new Map(crewFolders.map((folder) => [folder.id, folder]));
  const manualIds = new Set(manual.map((item) => item.id));
  const manualFolders: CrmFileFolder[] = manual.map((meta) => {
    const match = crewById.get(meta.id);
    return {
      id: meta.id,
      name: meta.name,
      address: meta.address,
      workType: meta.workType,
      jobId: meta.id,
      customerName: meta.customerName || match?.customerName || "",
      updatedAt: match?.updatedAt || meta.createdAt,
      files: match?.files || [],
    };
  });
  return [...manualFolders, ...crewFolders.filter((folder) => !manualIds.has(folder.id))].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function FilesPage() {
  const [folders, setFolders] = useState<CrmFileFolder[]>([]);
  const [search, setSearch] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const filteredFolders = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return folders;

    return folders.filter((folder) => [folder.name, folder.address, folder.workType, folder.customerName].some((value) => value.toLowerCase().includes(query)));
  }, [folders, search]);
  const totalPhotos = folders.reduce((total, folder) => total + folder.files.length, 0);

  const refreshFolders = useCallback(async () => {
    const [data, manual] = await Promise.all([loadCrewDataset(), loadManualFolders()]);
    setFolders(mergeFolders(buildFoldersFromCrew(data.jobs, data.photos), manual));
  }, []);

  useEffect(() => {
    void refreshFolders().catch(() => {});

    const unsubscribe = subscribeToCrewData(() => {
      void refreshFolders().catch(() => {});
    });
    const onManual = () => { void refreshFolders().catch(() => {}); };
    window.addEventListener(manualFoldersUpdatedEvent, onManual);
    return () => {
      unsubscribe();
      window.removeEventListener(manualFoldersUpdatedEvent, onManual);
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

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="Search address, customer, repair, maintenance..." />
          </div>
          <button type="button" onClick={() => setShowNewFolder(true)} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700">
            <FolderPlus className="h-5 w-5" /> New Folder
          </button>
        </div>
      </section>

      {filteredFolders.length === 0 ? (
        <section className="rounded-[2rem] border-2 border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          <UploadCloud className="mx-auto h-12 w-12 text-orange-500" />
          <p className="mt-4 font-black text-[#07183f]">No folders yet</p>
          <p className="mt-1 text-sm text-slate-500">Crew photos sync here into folders automatically — or tap <span className="font-black text-blue-700">New Folder</span> to create one and add photos yourself.</p>
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

      {showNewFolder && (
        <NewFolderModal
          onClose={() => setShowNewFolder(false)}
          onCreated={() => { setShowNewFolder(false); void refreshFolders().catch(() => {}); }}
        />
      )}
    </div>
  );
}

function NewFolderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [workType, setWorkType] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await createManualFolder({ name, address: name, customerName, workType: workType || "General" });
      onCreated();
    } catch {
      setError("Could not create the folder. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={onClose}>
      <form onClick={(event) => event.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">CRM Storage</p>
            <h2 className="mt-1 text-xl font-black text-[#07183f]">New Folder</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-600"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="text-xs font-black uppercase tracking-wide text-slate-500">Folder name / address</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. 123 Main St, Phoenix" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white" />
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-wide text-slate-500">Customer (optional)</span>
            <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Customer name" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white" />
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-wide text-slate-500">Work type (optional)</span>
            <input value={workType} onChange={(event) => setWorkType(event.target.value)} placeholder="e.g. Repair, Inspection" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white" />
          </label>
          {error && <p className="text-sm font-bold text-red-600">{error}</p>}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-black text-slate-500 hover:text-slate-700">Cancel</button>
          <button type="submit" disabled={!name.trim() || saving} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50">{saving ? "Creating…" : "Create Folder"}</button>
        </div>
      </form>
    </div>
  );
}
