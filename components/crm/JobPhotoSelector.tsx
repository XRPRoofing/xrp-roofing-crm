"use client";

import { useEffect, useState } from "react";
import { FolderOpen, Image, X } from "lucide-react";
import { loadJobPhotos, type JobPhoto } from "@/lib/crew-sync";

type JobPhotoSelectorProps = {
  onSelect: (dataUrl: string) => void;
  onClose: () => void;
  jobId?: string;
};

export default function JobPhotoSelector({ onSelect, onClose, jobId }: JobPhotoSelectorProps) {
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [allJobPhotos, setAllJobPhotos] = useState<{ jobName: string; jobId: string; photos: JobPhoto[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeJobId, setActiveJobId] = useState(jobId || "");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        // Load photos from all known jobs
        const jobsRaw = window.localStorage.getItem("xrp-crm-jobs-board");
        const jobs = jobsRaw ? (JSON.parse(jobsRaw) as { id: string; name?: string; address?: string }[]) : [];
        const grouped: typeof allJobPhotos = [];

        // If there's a specific job, load it first
        if (jobId) {
          const jobPhotos = await loadJobPhotos(jobId);
          const job = jobs.find((j) => j.id === jobId);
          if (jobPhotos.length > 0) {
            grouped.push({ jobName: job?.name || job?.address || jobId, jobId, photos: jobPhotos });
          }
        }

        // Load from all other jobs (limit to first 10 for performance)
        const otherJobs = jobs.filter((j) => j.id !== jobId).slice(0, 10);
        for (const job of otherJobs) {
          try {
            const jobPhotos = await loadJobPhotos(job.id);
            if (jobPhotos.length > 0) {
              grouped.push({ jobName: job.name || job.address || job.id, jobId: job.id, photos: jobPhotos });
            }
          } catch { /* skip */ }
        }

        setAllJobPhotos(grouped);
        if (grouped.length > 0) {
          setActiveJobId(grouped[0].jobId);
          setPhotos(grouped[0].photos);
        }
      } catch { /* failed to load */ }
      setLoading(false);
    }
    load();
  }, [jobId]);

  function switchJob(id: string) {
    setActiveJobId(id);
    const group = allJobPhotos.find((g) => g.jobId === id);
    setPhotos(group?.photos || []);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-bold text-gray-900">Select from Job Photos</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Job folder tabs */}
        {allJobPhotos.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b border-gray-100 px-4 py-2">
            {allJobPhotos.map((group) => (
              <button
                key={group.jobId}
                type="button"
                onClick={() => switchJob(group.jobId)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition ${
                  activeJobId === group.jobId
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {group.jobName} ({group.photos.length})
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          )}
          {!loading && photos.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-400">
              <Image className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-2">No photos found in job folders.</p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => onSelect(photo.dataUrl)}
                className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 transition hover:border-blue-400 hover:shadow-md"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.dataUrl} alt={photo.name} className="h-full w-full object-cover" />
                <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/50 to-transparent opacity-0 transition group-hover:opacity-100">
                  <div className="w-full p-2">
                    <p className="truncate text-xs font-bold text-white">{photo.name}</p>
                    <p className="text-[10px] text-white/80">{photo.photoType}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
