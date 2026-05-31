import { UploadCloud } from "lucide-react";

export default function FilesPage() {
  return <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm"><h1 className="text-3xl font-black text-[#07183f]">Files & Photo Uploads</h1><p className="mt-3 text-slate-600">Drag-and-drop roof inspection photos, documents, previews, and Supabase Storage integration.</p><div className="mt-8 rounded-[2rem] border-2 border-dashed border-slate-300 bg-slate-50 p-12 text-center"><UploadCloud className="mx-auto h-12 w-12 text-orange-500" /><p className="mt-4 font-black">Drop roof photos or documents here</p><p className="mt-1 text-sm text-slate-500">Storage bucket: crm-files</p></div></div>;
}
