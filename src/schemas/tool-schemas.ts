import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";

// ─── Shared ────────────────────────────────────────────────────

const pageSize = z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
  .describe("Number of results per page (1-100, default 20)");
const pageToken = z.string().optional().describe("Token for fetching the next page");
const scriptId = z.string().min(1).describe("The Apps Script project ID. Get from gas_list_projects or the script URL.");

// ─── Tool Schemas ──────────────────────────────────────────────

export const ListProjectsSchema = z.object({
  pageSize,
  pageToken,
  searchQuery: z.string().optional().describe("Filter projects whose name contains this string"),
}).strict();

export const GetProjectSchema = z.object({ scriptId }).strict();

export const GetProjectContentSchema = z.object({
  scriptId,
  versionNumber: z.number().int().positive().optional()
    .describe("Specific version to retrieve. Omit for latest HEAD."),
}).strict();

export const UpdateProjectContentSchema = z.object({
  scriptId,
  files: z.array(z.object({
    name: z.string().describe("Filename without extension (e.g. 'Code', 'Utils')"),
    type: z.enum(["SERVER_JS", "HTML", "JSON"]).describe("SERVER_JS for .gs, HTML for .html, JSON for appsscript.json"),
    source: z.string().describe("Full source code"),
  })).min(1).describe("Files to write. REPLACES all project files."),
}).strict();

export const CreateProjectSchema = z.object({
  title: z.string().min(1).max(200).describe("Name for the new project"),
  parentId: z.string().optional().describe("Drive file ID to bind to (Sheet, Doc). Omit for standalone."),
}).strict();

export const ListDeploymentsSchema = z.object({ scriptId, pageSize, pageToken }).strict();

export const CreateDeploymentSchema = z.object({
  scriptId,
  versionNumber: z.number().int().positive().describe("Version number to deploy"),
  description: z.string().max(500).optional().describe("Deployment description"),
}).strict();

export const CreateVersionSchema = z.object({
  scriptId,
  description: z.string().max(500).optional().describe("Version description"),
}).strict();

export const ListVersionsSchema = z.object({ scriptId, pageSize, pageToken }).strict();

export const RunFunctionSchema = z.object({
  scriptId,
  functionName: z.string().min(1).describe("Function to execute (must be exported)"),
  parameters: z.array(z.unknown()).optional().describe("Arguments to pass"),
  devMode: z.boolean().default(false).describe("If true, runs HEAD code instead of deployed version"),
}).strict();

export const GetLogsSchema = z.object({
  scriptId,
  pageSize,
  pageToken,
  functionName: z.string().optional().describe("Filter to a specific function"),
}).strict();

// ─── Inferred types ────────────────────────────────────────────

export type ListProjectsInput = z.infer<typeof ListProjectsSchema>;
export type GetProjectInput = z.infer<typeof GetProjectSchema>;
export type GetProjectContentInput = z.infer<typeof GetProjectContentSchema>;
export type UpdateProjectContentInput = z.infer<typeof UpdateProjectContentSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type ListDeploymentsInput = z.infer<typeof ListDeploymentsSchema>;
export type CreateDeploymentInput = z.infer<typeof CreateDeploymentSchema>;
export type CreateVersionInput = z.infer<typeof CreateVersionSchema>;
export type ListVersionsInput = z.infer<typeof ListVersionsSchema>;
export type RunFunctionInput = z.infer<typeof RunFunctionSchema>;
export type GetLogsInput = z.infer<typeof GetLogsSchema>;
