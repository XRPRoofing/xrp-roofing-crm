export type CrmFileRecord = {
  id: string;
  name: string;
  dataUrl: string;
  uploadedAt: string;
  uploadedBy: string;
  photoType: "Before" | "After" | "Job Photo";
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

function createFolderId(address: string) {
  return address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
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
  photoType: "Before" | "After" | "Job Photo";
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
