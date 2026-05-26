// ─── Drive API types ───────────────────────────────────────────

export interface DriveFile {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  webViewLink?: string;
}

export interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

// ─── Apps Script API types ─────────────────────────────────────

export interface ScriptFile {
  name: string;
  type: "SERVER_JS" | "HTML" | "JSON" | "ENUM_TYPE_UNSPECIFIED";
  source: string;
  lastModifyUser?: { name: string; email: string };
  createTime?: string;
  updateTime?: string;
  functionSet?: { values: Array<{ name: string }> };
}

export interface ScriptProject {
  [key: string]: unknown;
  scriptId: string;
  title: string;
  parentId?: string;
  createTime?: string;
  updateTime?: string;
  creator?: { name: string; email: string };
  lastModifyUser?: { name: string; email: string };
}

export interface ScriptContent {
  [key: string]: unknown;
  scriptId: string;
  files: ScriptFile[];
}

export interface Deployment {
  [key: string]: unknown;
  deploymentId: string;
  deploymentConfig: {
    scriptId: string;
    versionNumber?: number;
    manifestFileName?: string;
    description?: string;
  };
  updateTime?: string;
  entryPoints?: Array<{
    entryPointType: string;
    webApp?: { url: string; entryPointConfig: unknown };
    executionApi?: { entryPointConfig: unknown };
    addOn?: { entryPointConfig: unknown };
  }>;
}

export interface DeploymentList {
  [key: string]: unknown;
  deployments: Deployment[];
  nextPageToken?: string;
}

export interface Version {
  [key: string]: unknown;
  versionNumber: number;
  description?: string;
  createTime?: string;
  scriptId?: string;
}

export interface VersionList {
  [key: string]: unknown;
  versions: Version[];
  nextPageToken?: string;
}

export interface ExecutionRequest {
  function: string;
  parameters?: unknown[];
  devMode?: boolean;
}

export interface ExecutionResponse {
  done: boolean;
  response?: { "@type": string; result: unknown };
  error?: { code: number; message: string; status: string; details?: unknown[] };
}

export interface Process {
  projectName?: string;
  functionName?: string;
  processType?: string;
  processStatus?: string;
  startTime?: string;
  duration?: string;
  userAccessLevel?: string;
  executingUser?: string;
}

export interface ProcessList {
  [key: string]: unknown;
  processes: Process[];
  nextPageToken?: string;
}

// ─── OAuth types ───────────────────────────────────────────────

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface DCRRequest {
  client_name?: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  logo_uri?: string;
  client_uri?: string;
  scope?: string;
}

export interface DCRResponse {
  client_id: string;
  client_secret?: string;
  client_name?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
}

export interface AuthSession {
  googleToken: string;
  googleRefreshToken?: string;
  expiresAt: number;
}

export interface PendingAuth {
  [key: string]: unknown;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  scope: string;
}

// ─── Google API Error ──────────────────────────────────────────

export interface GoogleApiError {
  error: {
    code: number;
    message: string;
    status: string;
    errors?: Array<{ message: string; domain: string; reason: string }>;
  };
}
