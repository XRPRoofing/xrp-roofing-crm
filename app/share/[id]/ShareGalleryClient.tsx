"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Lock } from "lucide-react";
import PhotoGallery, { type GalleryPhoto } from "@/components/files/PhotoGallery";

type FolderMeta = { address: string; customerName: string; workType: string };

export default function ShareGalleryClient({ shareId }: { shareId: string }) {
  const [folder, setFolder] = useState<FolderMeta | null>(null);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "password" | "error">("loading");
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(
    async (withPassword?: string) => {
      try {
        const query = new URLSearchParams({ id: shareId });
        if (withPassword) query.set("password", withPassword);
        const response = await fetch(`/api/folders/share?${query.toString()}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          setFolder(data.folder);
          setPhotos(data.photos || []);
          setStatus("ready");
          return;
        }
        if (response.status === 401 && data.protected) {
          setStatus("password");
          setMessage(withPassword ? data.error || "Incorrect password." : "");
          return;
        }
        setStatus("error");
        setMessage(data.error || "This share link is unavailable.");
      } catch {
        setStatus("error");
        setMessage("This share link is unavailable.");
      }
    },
    [shareId],
  );

  useEffect(() => {
    // load() owns its own async state transitions (loading -> ready/password/error).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    await load(password);
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white"><FolderOpen className="h-5 w-5" /></span>
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-orange-600">XRP Roofing</p>
            <p className="text-xs font-semibold text-slate-500">Shared project photos</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {status === "loading" && <p className="rounded-[2rem] bg-white p-12 text-center font-bold text-slate-500">Loading gallery…</p>}

        {status === "error" && (
          <div className="rounded-[2rem] bg-white p-12 text-center">
            <p className="text-lg font-black text-[#07183f]">Gallery unavailable</p>
            <p className="mt-2 text-sm font-semibold text-slate-500">{message}</p>
          </div>
        )}

        {status === "password" && (
          <form onSubmit={submitPassword} className="mx-auto max-w-sm rounded-[2rem] bg-white p-8 text-center shadow-sm">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600"><Lock className="h-6 w-6" /></span>
            <h1 className="mt-4 text-xl font-black text-[#07183f]">Password required</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">Enter the password to view this gallery.</p>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className="mt-5 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white" />
            {message && <p className="mt-2 text-sm font-bold text-red-600">{message}</p>}
            <button type="submit" disabled={submitting || !password} className="mt-4 w-full rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-60">{submitting ? "Checking…" : "View gallery"}</button>
          </form>
        )}

        {status === "ready" && folder && (
          <>
            <section className="rounded-[2rem] bg-white p-6 shadow-sm">
              <h1 className="text-2xl font-black text-[#07183f]">{folder.address}</h1>
              <p className="mt-1 font-bold text-slate-600">{folder.customerName}</p>
              <p className="text-sm font-semibold text-slate-500">{folder.workType} · {photos.length} photos</p>
            </section>
            <section className="mt-5 rounded-[2rem] bg-white p-5 shadow-sm">
              {photos.length === 0 ? (
                <p className="p-8 text-center font-semibold text-slate-500">No photos have been added to this project yet.</p>
              ) : (
                <PhotoGallery photos={photos} />
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
