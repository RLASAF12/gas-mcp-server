import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";

import { mountOAuthRoutes, resolveGoogleToken } from "./auth/oauth-proxy.js";
import { GoogleApiClient } from "./services/google-api-client.js";
import {
  ListProjectsSchema, GetProjectSchema, GetProjectContentSchema,
  UpdateProjectContentSchema, CreateProjectSchema, ListDeploymentsSchema,
  CreateDeploymentSchema, CreateVersionSchema, ListVersionsSchema,
  RunFunctionSchema, GetLogsSchema,
} from "./schemas/tool-schemas.js";
import { listProjects, getProject, getProjectContent, updateProjectContent, createProject } from "./tools/projects.js";
import { listDeployments, createDeployment, createVersion, listVersions, runFunction, getLogs } from "./tools/deployments.js";

// ─── Server init ───────────────────────────────────────────────

const server = new McpServer({
  name: "google-apps-script-mcp-server",
  version: "1.0.0",
});

// ─── Helper: build client from resolved Google token ───────────

function makeClient(googleToken: string): GoogleApiClient {
  return new GoogleApiClient(googleToken);
}

// Placeholder for token passed via request context
let currentRequestGoogleToken: string | undefined;

function getClientForRequest(): GoogleApiClient {
  if (!currentRequestGoogleToken) {
    throw new Error("Not authenticated. Please connect this connector first.");
  }
  return makeClient(currentRequestGoogleToken);
}

// ─── Tool registrations ────────────────────────────────────────

server.registerTool("gas_list_projects", {
  title: "List Apps Script Projects",
  description: `List all Google Apps Script projects in the user's Drive.\nReturns project names, IDs, last modified dates, and editor links.\nUse the scriptId from results for other tools.`,
  inputSchema: ListProjectsSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (params) => listProjects(getClientForRequest(), params));

server.registerTool("gas_get_project", {
  title: "Get Project Details",
  description: `Get metadata for a specific Apps Script project: title, creator, dates, bound document.`,
  inputSchema: GetProjectSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (params) => getProject(getClientForRequest(), params));

server.registerTool("gas_get_content", {
  title: "Get Project Source Code",
  description: `Retrieve all source files (.gs, .html, appsscript.json) from a project.\nOptionally specify a version number; omit for latest HEAD.`,
  inputSchema: GetProjectContentSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (params) => getProjectContent(getClientForRequest(), params));

server.registerTool("gas_update_content", {
  title: "Update Project Source Code",
  description: `Replace all files in a project. WARNING: overwrites ALL files.\nAlways gas_get_content first, modify, then send full file list back.`,
  inputSchema: UpdateProjectContentSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
}, async (params) => updateProjectContent(getClientForRequest(), params));

server.registerTool("gas_create_project", {
  title: "Create New Project",
  description: `Create a new Apps Script project (standalone or bound to a Sheet/Doc).`,
  inputSchema: CreateProjectSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async (params) => createProject(getClientForRequest(), params));

server.registerTool("gas_list_deployments", {
  title: "List Deployments",
  description: `List all deployments for a project, including web app URLs.`,
  inputSchema: ListDeploymentsSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (params) => listDeployments(getClientForRequest(), params));

server.registerTool("gas_create_deployment", {
  title: "Create Deployment",
  description: `Deploy a versioned snapshot. Create a version first with gas_create_version.`,
  inputSchema: CreateDeploymentSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async (params) => createDeployment(getClientForRequest(), params));

server.registerTool("gas_create_version", {
  title: "Create Version",
  description: `Snapshot current HEAD as an immutable version. Required before deploying.`,
  inputSchema: CreateVersionSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async (params) => createVersion(getClientForRequest(), params));

server.registerTool("gas_list_versions", {
  title: "List Versions",
  description: `List all saved versions of a project.`,
  inputSchema: ListVersionsSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (params) => listVersions(getClientForRequest(), params));

server.registerTool("gas_run_function", {
  title: "Run Function",
  description: `Execute a function remotely. Project needs an API-executable deployment.\nSet devMode=true to run HEAD code instead of deployed version.`,
  inputSchema: RunFunctionSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
}, async (params) => runFunction(getClientForRequest(), params));

server.registerTool("gas_get_logs", {
  title: "Get Execution Logs",
  description: `View recent execution history: function names, statuses, durations, timestamps.`,
  inputSchema: GetLogsSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (params) => getLogs(getClientForRequest(), params));

// ─── HTTP Transport with OAuth ─────────────────────────────────

async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mount all OAuth endpoints (well-known, register, authorize, callback, token)
  mountOAuthRoutes(app);

  // MCP endpoint
  app.post("/mcp", async (req, res) => {
    const serverUrl = process.env.SERVER_URL ?? "";

    // Extract Bearer token from Authorization header
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

    // If no token, return 401 with resource_metadata hint (RFC 9728)
    if (!bearerToken) {
      res.status(401).setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${serverUrl}/.well-known/oauth-protected-resource"`
      ).json({ error: "unauthorized", error_description: "Bearer token required. Connect this MCP server to obtain a token." });
      return;
    }

    // Resolve our proxy token → Google access token
    const googleToken = resolveGoogleToken(bearerToken);
    if (!googleToken) {
      res.status(401).setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${serverUrl}/.well-known/oauth-protected-resource", error="invalid_token"`
      ).json({ error: "invalid_token", error_description: "Token expired or invalid. Please reconnect." });
      return;
    }

    // Set the Google token for the current request
    currentRequestGoogleToken = googleToken;

    // Handle MCP request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      currentRequestGoogleToken = undefined;
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "8080");
  app.listen(port, () => {
    console.error(`google-apps-script-mcp-server running on http://localhost:${port}`);
    console.error(`  MCP endpoint: http://localhost:${port}/mcp`);
    console.error(`  OAuth metadata: http://localhost:${port}/.well-known/oauth-protected-resource`);
    console.error(`  Health check: http://localhost:${port}/health`);
  });
}

async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("google-apps-script-mcp-server running on stdio");
}

// ─── Entry point ───────────────────────────────────────────────

const transportMode = process.env.TRANSPORT || "http";
if (transportMode === "stdio") {
  runStdio().catch((err) => { console.error("Fatal:", err); process.exit(1); });
} else {
  runHTTP().catch((err) => { console.error("Fatal:", err); process.exit(1); });
}
