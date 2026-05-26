import { GoogleApiClient, GoogleApiRequestError } from "../services/google-api-client.js";
import { APPS_SCRIPT_API_BASE } from "../constants.js";
import type { DeploymentList, Deployment, VersionList, Version, ExecutionResponse, ProcessList } from "../types.js";
import type { ListDeploymentsInput, CreateDeploymentInput, CreateVersionInput, ListVersionsInput, RunFunctionInput, GetLogsInput } from "../schemas/tool-schemas.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean; structuredContent?: Record<string, unknown> };

function errorResult(err: unknown): ToolResult {
  const message = err instanceof GoogleApiRequestError ? err.toUserMessage() : err instanceof Error ? err.message : "Unknown error";
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

export async function listDeployments(client: GoogleApiClient, params: ListDeploymentsInput): Promise<ToolResult> {
  try {
    const data = await client.get<DeploymentList>(`${APPS_SCRIPT_API_BASE}/projects/${params.scriptId}/deployments`, {
      pageSize: String(params.pageSize), ...(params.pageToken ? { pageToken: params.pageToken } : {}),
    });
    const deps = data.deployments ?? [];
    if (deps.length === 0) return { content: [{ type: "text", text: "No deployments found." }] };
    const md = deps.map(d => {
      const webUrl = d.entryPoints?.find(e => e.entryPointType === "WEB_APP")?.webApp?.url;
      return [`- **${d.deploymentConfig.description ?? d.deploymentId}**`, `  ID: \`${d.deploymentId}\``,
        d.deploymentConfig.versionNumber ? `  Version: ${d.deploymentConfig.versionNumber}` : null,
        webUrl ? `  URL: ${webUrl}` : null].filter(Boolean).join("\n");
    }).join("\n");
    return { content: [{ type: "text", text: md }], structuredContent: data };
  } catch (err) { return errorResult(err); }
}

export async function createDeployment(client: GoogleApiClient, params: CreateDeploymentInput): Promise<ToolResult> {
  try {
    const dep = await client.post<Deployment>(`${APPS_SCRIPT_API_BASE}/projects/${params.scriptId}/deployments`, {
      versionNumber: params.versionNumber, ...(params.description ? { description: params.description } : {}),
    });
    return { content: [{ type: "text", text: `Deployed: \`${dep.deploymentId}\` (v${params.versionNumber})` }], structuredContent: dep };
  } catch (err) { return errorResult(err); }
}

export async function createVersion(client: GoogleApiClient, params: CreateVersionInput): Promise<ToolResult> {
  try {
    const body: Record<string, string> = {};
    if (params.description) body.description = params.description;
    const v = await client.post<Version>(`${APPS_SCRIPT_API_BASE}/projects/${params.scriptId}/versions`, body);
    return { content: [{ type: "text", text: `Version **${v.versionNumber}** created${v.description ? `: ${v.description}` : ""}.` }], structuredContent: v };
  } catch (err) { return errorResult(err); }
}

export async function listVersions(client: GoogleApiClient, params: ListVersionsInput): Promise<ToolResult> {
  try {
    const data = await client.get<VersionList>(`${APPS_SCRIPT_API_BASE}/projects/${params.scriptId}/versions`, {
      pageSize: String(params.pageSize), ...(params.pageToken ? { pageToken: params.pageToken } : {}),
    });
    const versions = data.versions ?? [];
    if (versions.length === 0) return { content: [{ type: "text", text: "No versions. Only HEAD exists." }] };
    const md = versions.map(v => `- **v${v.versionNumber}**${v.description ? ` — ${v.description}` : ""} (${v.createTime ?? "?"})`).join("\n");
    return { content: [{ type: "text", text: md }], structuredContent: data };
  } catch (err) { return errorResult(err); }
}

export async function runFunction(client: GoogleApiClient, params: RunFunctionInput): Promise<ToolResult> {
  try {
    const result = await client.post<ExecutionResponse>(`${APPS_SCRIPT_API_BASE}/scripts/${params.scriptId}:run`, {
      function: params.functionName, ...(params.parameters ? { parameters: params.parameters } : {}), devMode: params.devMode,
    });
    if (result.error) return { content: [{ type: "text", text: `Execution error: ${result.error.message}` }], isError: true };
    const val = result.response?.result;
    const text = val !== undefined ? `\`${params.functionName}\` returned:\n\`\`\`json\n${JSON.stringify(val, null, 2)}\n\`\`\`` : `\`${params.functionName}\` executed (no return value).`;
    return { content: [{ type: "text", text }], structuredContent: { result: val, done: result.done } };
  } catch (err) { return errorResult(err); }
}

export async function getLogs(client: GoogleApiClient, params: GetLogsInput): Promise<ToolResult> {
  try {
    const qp: Record<string, string> = { scriptId: params.scriptId, pageSize: String(params.pageSize) };
    if (params.pageToken) qp.pageToken = params.pageToken;
    if (params.functionName) qp["scriptProcessFilter.functionName"] = params.functionName;
    const data = await client.get<ProcessList>(`${APPS_SCRIPT_API_BASE}/processes`, qp);
    const procs = data.processes ?? [];
    if (procs.length === 0) return { content: [{ type: "text", text: "No recent logs." }] };
    const md = procs.map(p => `- **${p.functionName ?? "?"}** — ${p.processStatus ?? "?"} (${p.duration ?? "?"}) at ${p.startTime ?? "?"}`).join("\n");
    return { content: [{ type: "text", text: md }], structuredContent: data };
  } catch (err) { return errorResult(err); }
}
