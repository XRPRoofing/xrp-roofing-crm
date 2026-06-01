import type { Lead } from "@/types/crm";

export type CrewJobStatus = "Assigned" | "In Progress" | "Done - Pending Approval" | "Completed";

export type CrewJobCompletion = {
  beforePhotos: string[];
  afterPhotos: string[];
  notes: string;
  materialsUsed?: string;
  submittedAt?: string;
};

export type CrewAssignment = {
  jobId: string;
  assignedCrew: string[];
  status: CrewJobStatus;
  scheduleDate: string;
  jobScope: string;
  jobNotes: string;
  completion: CrewJobCompletion;
  adminNotification?: string;
};

export type CrewJob = Lead & CrewAssignment;

export const crewMembers = ["Juan Dela Cruz", "Pedro Santos", "Mike Johnson"];
export const crewStatuses: CrewJobStatus[] = ["Assigned", "In Progress", "Done - Pending Approval", "Completed"];
export const crewWorkflowStorageKey = "xrp-crm-crew-workflow";
export const jobsStorageKey = "xrp-crm-jobs-board";

export function createDefaultCrewAssignment(job: Lead, index = 0): CrewAssignment {
  return {
    jobId: job.id,
    assignedCrew: [crewMembers[index % crewMembers.length]],
    status: job.stage === "completed" || job.stage === "paid" ? "Completed" : job.stage === "in_progress" ? "In Progress" : "Assigned",
    scheduleDate: job.dueDate || "2026-06-05",
    jobScope: job.roofType || "Roofing work",
    jobNotes: job.lastActivity || "Review job details before starting work.",
    completion: {
      beforePhotos: [],
      afterPhotos: [],
      notes: "",
      materialsUsed: "",
    },
  };
}

export function mergeJobsWithCrewAssignments(jobs: Lead[], assignments: CrewAssignment[]): CrewJob[] {
  return jobs.map((job, index) => {
    const assignment = assignments.find((item) => item.jobId === job.id) || createDefaultCrewAssignment(job, index);
    return { ...job, ...assignment };
  });
}

export function saveCrewAssignments(assignments: CrewAssignment[]) {
  window.localStorage.setItem(crewWorkflowStorageKey, JSON.stringify(assignments));
}

export function readCrewAssignments() {
  if (typeof window === "undefined") return [] as CrewAssignment[];

  const savedAssignments = window.localStorage.getItem(crewWorkflowStorageKey);
  if (!savedAssignments) return [] as CrewAssignment[];

  try {
    return JSON.parse(savedAssignments) as CrewAssignment[];
  } catch {
    return [] as CrewAssignment[];
  }
}

export function readSavedJobs(fallbackJobs: Lead[]) {
  if (typeof window === "undefined") return fallbackJobs;

  const savedJobs = window.localStorage.getItem(jobsStorageKey);
  if (!savedJobs) return fallbackJobs;

  try {
    return JSON.parse(savedJobs) as Lead[];
  } catch {
    return fallbackJobs;
  }
}
