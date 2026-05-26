import { GoogleApiClient, GoogleApiRequestError } from "../services/google-api-client.js";
import { DRIVE_API_BASE, APPS_SCRIPT_API_BASE, APPS_SCRIPT_MIME_TYPE } from "../constants.js";
import type { DriveFileList, ScriptProject, ScriptContent } from "../types.js";
import type { ListProjectsInput, GetProjectInput, GetProjectContentInput, UpdateProjectContentInput, CreateProjectInput } from "../schemas/tool-schemas.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean; structuredContent?: Record<string, unknown> };

function errorResult(err: unknown): ToolResult {
  const message = err instanceof GoogleApiRequestError ? err.toUserMessage() : err instanceof Error ? err.message : "Unknown error";
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

export async function listProjects(client: GoogleApiClient, params: ListProjectsInput): Promise<ToolResult> {
  try {
    let q = `mimeType='${APPS_SCRIPT_MIME_TYPE}' and trashed=false`;
    if (params.searchQuery) q += ` and name contains '${params.searchQuery.replace(/'/g, "\\'")}'`;

    const data = await client.get<DriveFileList>(`${DRIVE_API_BASE}/files`, {
      q, pageSize: String(params.pageSize),
      ...(params.pageToken ? { pageToken: params.pageToken } : {}),
      fields: "nextPageToken,files(id,name,createdTime,modifiedTime,owners,webViewLink)",
      orderBy: "modifiedTime desc",
    });

    const files = data.files ?? [];
    if (files.length === 0) {
      return { content: [{ type: "text", text: params.searchQuery ? `No projects matching "${params.searchQuery}".` : "No Apps Script projects found." }] };
    }

    const md = [`**Found ${files.length} project(s)**${data.nextPageToken ? " (more available)" : ""}`, "",
      ...files.map((f, i) => `${i + 1}. **${f.name}**\n   ID: \`${f.id}\`\n   Modified: ${f.modifiedTime}\n   [Open](https://script.google.com/d/${f.id}/edit)`)
    ].join("\n");

    return { content: [{ type: "text", text: md }], structuredContent: {
      count: files.length, hasMore: !!data.nextPageToken,
      ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
      projects: files.map(f => ({ scriptId: f.id, name: f.name, modified: f.modifiedTime, created: f.createdTime, owner: f.owners?.[0]?.emailAddress ?? "unknown" })),
    }};
  } catch (err) { return errorResult(err); }
}

export async function getProject(client: GoogleApiClient, params: GetProjectInput): Promise<ToolResult> {
  try {
    const p = await client.get<ScriptProject>(`${APPS_SCRIPT_API_BASE}/projects/${params.scriptId}`);
    const md = [`**${p.title}**`, `- ID: \`${p.scriptId}\``, p.parentId ? `- Bound to: \`${p.parentId}\`` : "- Standalone", `- Created: ${p.createTime ?? "?"}`, `- Modified: ${p.updateTime ?? "?"}`, p.creator ? `- Creator: ${p.creator.email}` : ""].filter(Boolean).join("\n");
    return { content: [{ type: "text", text: md }], structuredContent: p };
  } catch (err) { return errorResult(err); }
}

export async function getProjectContent(client: GoogleApiClient, params: GetProjectContentInput): Promise<ToolResult> {
  try {
    const suffix = params.versionNumber !== undefined ? `/versions/${params.versionNumber}` : "";
    const content = await client.get<ScriptContent>(`${APPS_SCRIPT_API_BASE}/projects/${params.scriptId}/content${suffix}`);
    const files = content.files ?? [];
    const md = [`**${files.length} file(s)**${params.versionNumber ? ` — v${params.versionNumber}` : " — HEAD"}`, "",
      ...files.map(f => `### ${f.name}.${f.type === "HTML" ? "html" : f.type === "JSON" ? "json" : "gs"}\n\`\`\`${f.type === "HTML" ? "html" : f.type === "JSON" ? "json" : "javascript"}\n${f.source}\n\`\`\``)
    ].join("\n");
    return { content: [{ type: "text", text: md }], structuredContent: {
      scriptId: content.scriptId,
      files: files.map(f => ({ name: f.name, type: f.type, source: f.source, functions: f.functionSet?.values?.map(v => v.name) ?? [] })),
    }};
  } catch (err) { return errorResult(err); }
}

export async function updateProjectContent(client: GoogleApiClient, params: UpdateProjectContentInput): Promise<ToolResult> {
  try {
    const content = await client.put<ScriptContent>(`${APPS_SCRIPT_API_BASE}/projects/${params.scriptId}/content`, {
      files: params.files.map(f => ({ name: f.name, type: f.type, source: f.source })),
    });
    return { content: [{ type: "text", text: `Updated ${content.files?.length ?? params.files.length} file(s) in \`${params.scriptId}\`.` }], structuredContent: { scriptId: content.scriptId, filesUpdated: content.files?.length ?? params.files.length } };
  } catch (err) { return errorResult(err); }
}

export async function createProject(client: GoogleApiClient, params: CreateProjectInput): Promise<ToolResult> {
  try {
    const body: Record<string, string> = { title: params.title };
    if (params.parentId) body.parentId = params.parentId;
    const p = await client.post<ScriptProject>(`${APPS_SCRIPT_API_BASE}/projects`, body);
    return { content: [{ type: "text", text: `Created **${p.title}**\n- ID: \`${p.scriptId}\`\n- [Open](https://script.google.com/d/${p.scriptId}/edit)` }], structuredContent: p };
  } catch (err) { return errorResult(err); }
}
