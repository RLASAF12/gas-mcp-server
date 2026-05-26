// Google API endpoints
export const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
export const APPS_SCRIPT_API_BASE = "https://script.googleapis.com/v1";

// Google OAuth endpoints
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

// MIME type for Apps Script projects in Drive
export const APPS_SCRIPT_MIME_TYPE = "application/vnd.google-apps.script";

// Pagination defaults
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// Response character limit
export const CHARACTER_LIMIT = 50_000;

// Google OAuth scopes — all sensitive (NOT restricted), so no CASA audit
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",     // List script projects
  "https://www.googleapis.com/auth/script.projects",     // Read/write script content
  "https://www.googleapis.com/auth/script.deployments",  // Manage deployments
  "https://www.googleapis.com/auth/script.processes",    // View execution logs
] as const;
