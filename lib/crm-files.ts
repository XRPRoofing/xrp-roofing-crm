import type { JobPhoto, JobRecord } from "@/lib/crew-sync";

export type CrmFileRecord = {
  id: string;
  name: string;
  dataUrl: string;
  uploadedAt: string;
  uploadedBy: string;
  photoType: "Before" | "Progress" | "After" | "Job Photo";
  jobId: string;
  jobName: string;
};

export type CrmFileFolder = {
  id: string;
  name: string;
  address: string;
  workType: string;
  jobId: string;
  customerName: string;
  updatedAt: string;
  files: CrmFileRecord[];
};

export const crmFilesStorageKey = "xrp-crm-files-dashboard";

export function createFolderId(address: string) {
  return address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * Build job folders from the crew dataset (jobs + photos). One job = one folder,
 * keyed by property address. Shared by the Files board and the folder gallery.
 */
export function buildFoldersFromCrew(jobs: JobRecord[], photos: JobPhoto[]): CrmFileFolder[] {
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

export function readCrmFileFolders() {
  if (typeof window === "undefined") return [] as CrmFileFolder[];

  const savedFolders = window.localStorage.getItem(crmFilesStorageKey);
  if (!savedFolders) return [] as CrmFileFolder[];

  try {
    return JSON.parse(savedFolders) as CrmFileFolder[];
  } catch {
    return [] as CrmFileFolder[];
  }
}

export function saveCrmFileFolders(folders: CrmFileFolder[]) {
  window.localStorage.setItem(crmFilesStorageKey, JSON.stringify(folders));
  window.dispatchEvent(new Event("crm-files-updated"));
}

export function syncCrewPhotosToFiles(input: {
  jobId: string;
  customerName: string;
  address: string;
  workType: string;
  uploadedBy: string;
  photoType: "Before" | "Progress" | "After" | "Job Photo";
  photos: { name: string; dataUrl: string }[];
}) {
  if (typeof window === "undefined" || input.photos.length === 0) return;

  const now = new Date().toISOString();
  const folderId = createFolderId(input.address);
  const folders = readCrmFileFolders();
  const nextFiles: CrmFileRecord[] = input.photos.map((photo, index) => ({
    id: `${folderId}-${Date.now()}-${index}`,
    name: photo.name,
    dataUrl: photo.dataUrl,
    uploadedAt: now,
    uploadedBy: input.uploadedBy,
    photoType: input.photoType,
    jobId: input.jobId,
    jobName: input.customerName,
  }));
  const existingFolder = folders.find((folder) => folder.id === folderId);
  const nextFolder: CrmFileFolder = {
    id: folderId,
    name: input.address,
    address: input.address,
    workType: input.workType,
    jobId: input.jobId,
    customerName: input.customerName,
    updatedAt: now,
    files: [...(existingFolder?.files || []), ...nextFiles],
  };
  const nextFolders = existingFolder ? folders.map((folder) => folder.id === folderId ? nextFolder : folder) : [nextFolder, ...folders];

  saveCrmFileFolders(nextFolders);
}

/**
 * Save payment documents to a customer's file folder under a "Payment Documents" subfolder.
 * Automatically creates the folder if it doesn't exist.
 */
export function savePaymentDocumentsToCustomerFiles(input: {
  customerName: string;
  address: string;
  jobId: string;
  invoiceNumber: string;
  uploadedBy: string;
  documents: { name: string; dataUrl: string }[];
  checkImage?: string | null;
}) {
  if (typeof window === "undefined") return;
  if (!input.checkImage && input.documents.length === 0) return;

  const now = new Date().toISOString();
  const folderId = createFolderId(input.address) || `payment-${Date.now()}`;
  const folders = readCrmFileFolders();

  const allFiles: CrmFileRecord[] = [];

  if (input.checkImage) {
    allFiles.push({
      id: `${folderId}-check-${Date.now()}`,
      name: `Check - ${input.invoiceNumber}`,
      dataUrl: input.checkImage,
      uploadedAt: now,
      uploadedBy: input.uploadedBy,
      photoType: "Job Photo",
      jobId: input.jobId,
      jobName: `Payment Doc - ${input.customerName}`,
    });
  }

  input.documents.forEach((doc, index) => {
    allFiles.push({
      id: `${folderId}-doc-${Date.now()}-${index}`,
      name: `${doc.name} - ${input.invoiceNumber}`,
      dataUrl: doc.dataUrl,
      uploadedAt: now,
      uploadedBy: input.uploadedBy,
      photoType: "Job Photo",
      jobId: input.jobId,
      jobName: `Payment Doc - ${input.customerName}`,
    });
  });

  const existingFolder = folders.find((folder) => folder.id === folderId);
  const nextFolder: CrmFileFolder = {
    id: folderId,
    name: input.address || `${input.customerName} - Payments`,
    address: input.address,
    workType: "Payment Documents",
    jobId: input.jobId,
    customerName: input.customerName,
    updatedAt: now,
    files: [...(existingFolder?.files || []), ...allFiles],
  };
  const nextFolders = existingFolder
    ? folders.map((folder) => folder.id === folderId ? nextFolder : folder)
    : [nextFolder, ...folders];

  saveCrmFileFolders(nextFolders);
}
