import type { Lead } from "@/types/crm";

export type CrewJobStatus = "Assigned" | "In Progress" | "On Work" | "Mark Done" | "Completed" | "Proceed to Invoice" | "Done Payment";

export type CrewJobCompletion = {
  beforePhotos: string[];
  progressPhotos: string[];
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

export const crewMembers = ["Jonathan", "Adrian"];
export const crewStatuses: CrewJobStatus[] = ["Assigned", "In Progress", "On Work", "Mark Done", "Completed", "Proceed to Invoice", "Done Payment"];
export const crewWorkflowStorageKey = "xrp-crm-crew-workflow";
export const jobsStorageKey = "xrp-crm-jobs-board";

export function cleanAssignedCrewMembers(assignedCrew: string[], index = 0) {
  const validCrew = assignedCrew.filter((member) => crewMembers.includes(member));
  return validCrew.length > 0 ? validCrew : [crewMembers[index % crewMembers.length]];
}

function cleanAssignedCrew(assignedCrew: string[], index = 0) {
  return cleanAssignedCrewMembers(assignedCrew, index);
}

export function createDefaultCrewAssignment(job: Lead, index = 0): CrewAssignment {
  return {
    jobId: job.id,
    assignedCrew: [crewMembers[index % crewMembers.length]],
    status: job.stage === "completed" ? "Completed" : job.stage === "in_progress" ? "In Progress" : "Assigned",
    scheduleDate: "2026-06-05",
    jobScope: job.roofType || "Roofing work",
    jobNotes: job.lastActivity || "Review job details before starting work.",
    completion: {
      beforePhotos: [],
      progressPhotos: [],
      afterPhotos: [],
      notes: "",
      materialsUsed: "",
    },
  };
}

export function mergeJobsWithCrewAssignments(jobs: Lead[], assignments: CrewAssignment[]): CrewJob[] {
  return jobs.map((job, index) => {
    const assignment = assignments.find((item) => item.jobId === job.id) || createDefaultCrewAssignment(job, index);
    return { ...job, ...assignment, assignedCrew: cleanAssignedCrew(assignment.assignedCrew, index) };
  });
}

export function saveCrewAssignments(assignments: CrewAssignment[]) {
  window.localStorage.setItem(crewWorkflowStorageKey, JSON.stringify(assignments));
  window.dispatchEvent(new Event("crm-crew-workflow-updated"));
}

export function saveCrewJobs(jobs: Lead[]) {
  window.localStorage.setItem(jobsStorageKey, JSON.stringify(jobs));
  window.dispatchEvent(new Event("crm-crew-workflow-updated"));
}

export function readCrewAssignments() {
  if (typeof window === "undefined") return [] as CrewAssignment[];

  const savedAssignments = window.localStorage.getItem(crewWorkflowStorageKey);
  if (!savedAssignments) return [] as CrewAssignment[];

  try {
    const assignments = JSON.parse(savedAssignments) as CrewAssignment[];
    const cleanedAssignments = assignments.map((assignment, index) => ({ ...assignment, assignedCrew: cleanAssignedCrew(assignment.assignedCrew, index) }));
    window.localStorage.setItem(crewWorkflowStorageKey, JSON.stringify(cleanedAssignments));
    return cleanedAssignments;
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
