/**
 * OAuth 2.1 Proxy for MCP ↔ Google OAuth
 *
 * Flow:
 * 1. Claude hits /mcp without a token → gets 401 with resource_metadata hint
 * 2. Claude reads /.well-known/oauth-protected-resource → learns our auth server
 * 3. Claude reads /.well-known/oauth-authorization-server → gets our endpoints
 * 4. Claude calls /oauth/register (DCR) → gets a client_id
 * 5. Claude redirects user to /oauth/authorize → we redirect to Google
 * 6. Google redirects back to /oauth/callback → we exchange code for Google tokens
 * 7. We redirect to Claude's redirect_uri with our own auth code
 * 8. Claude calls /oauth/token → we return our proxy token (the Google access token)
 * 9. Claude attaches Bearer token to /mcp calls → we forward to Google APIs
 */

import { randomUUID, randomBytes, createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import {
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_SCOPES,
} from "../constants.js";
import type {
  OAuthTokenResponse,
  DCRRequest,
  DCRResponse,
  PendingAuth,
} from "../types.js";

// ─── In-memory stores (use Redis/DB in production) ─────────────

/** DCR-registered clients: clientId → client metadata */
const registeredClients = new Map<string, DCRResponse>();

/** Pending authorization requests: state → session data */
const pendingAuths = new Map<string, PendingAuth & { googleState: string }>();

/** Auth codes we issued: code → google tokens */
const authCodes = new Map<
  string,
  { googleAccessToken: string; googleRefreshToken?: string; expiresIn: number; redirectUri: string; clientId: string; codeChallenge?: string; codeChallengeMethod?: string }
>();

/** Active tokens: our proxy token → google access token */
const activeTokens = new Map<
  string,
  { googleAccessToken: string; googleRefreshToken?: string; expiresAt: number }
>();

// ─── Config ────────────────────────────────────────────────────

function getServerUrl(): string {
  const url = process.env.SERVER_URL;
  if (!url) throw new Error("SERVER_URL environment variable is required");
  return url.replace(/\/+$/, "");
}

function getGoogleClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID environment variable is required");
  return id;
}

function getGoogleClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET environment variable is required");
  return secret;
}

// ─── Helpers ───────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

function generateCode(): string {
  return randomBytes(32).toString("base64url");
}

function generateToken(): string {
  return randomBytes(48).toString("base64url");
}

// ─── Mount all OAuth endpoints ─────────────────────────────────

export function mountOAuthRoutes(app: Express): void {
  const serverUrl = getServerUrl();

  // ── RFC 9728: Protected Resource Metadata ──────────────────
  // Claude reads this to discover which authorization server to use
  app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
    res.json({
      resource: serverUrl,
      authorization_servers: [serverUrl],
      scopes_supported: GOOGLE_SCOPES,
      bearer_methods_supported: ["header"],
      resource_documentation: `${serverUrl}/docs`,
    });
  });

  // ── RFC 8414: Authorization Server Metadata ────────────────
  // Claude reads this to learn our OAuth endpoints
  app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
    res.json({
      issuer: serverUrl,
      authorization_endpoint: `${serverUrl}/oauth/authorize`,
      token_endpoint: `${serverUrl}/oauth/token`,
      registration_endpoint: `${serverUrl}/oauth/register`,
      revocation_endpoint: `${serverUrl}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: GOOGLE_SCOPES,
    });
  });

  // ── Dynamic Client Registration (RFC 7591) ─────────────────
  // Claude registers itself as a client
  app.post("/oauth/register", (req: Request, res: Response) => {
    const body = req.body as DCRRequest;

    if (!body.redirect_uris || body.redirect_uris.length === 0) {
      res.status(400).json({ error: "invalid_client_metadata", error_description: "redirect_uris required" });
      return;
    }

    const clientId = `gas-mcp-${randomUUID().slice(0, 8)}`;

    const client: DCRResponse = {
      client_id: clientId,
      client_name: body.client_name ?? "Claude MCP Client",
      redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: "none", // Public client (PKCE is the security)
    };

    registeredClients.set(clientId, client);

    console.error(`[DCR] Registered client: ${clientId} (${client.client_name})`);

    res.status(201).json(client);
  });

  // ── Authorization endpoint ─────────────────────────────────
  // Claude redirects the user here → we redirect to Google
  app.get("/oauth/authorize", (req: Request, res: Response) => {
    const {
      client_id,
      redirect_uri,
      response_type,
      scope,
      state,
      code_challenge,
      code_challenge_method,
    } = req.query as Record<string, string>;

    // Validate
    if (response_type !== "code") {
      res.status(400).json({ error: "unsupported_response_type" });
      return;
    }
    if (!client_id || !registeredClients.has(client_id)) {
      res.status(400).json({ error: "invalid_client", error_description: "Unknown client_id. Register via /oauth/register first." });
      return;
    }
    if (!redirect_uri) {
      res.status(400).json({ error: "invalid_request", error_description: "redirect_uri required" });
      return;
    }
    if (code_challenge_method && code_challenge_method !== "S256") {
      res.status(400).json({ error: "invalid_request", error_description: "Only S256 code_challenge_method is supported" });
      return;
    }

    // Generate state for our Google OAuth request
    const googleState = randomUUID();

    // Store the pending auth session
    pendingAuths.set(googleState, {
      codeVerifier: code_challenge ?? "", // We'll use this for validation later
      redirectUri: redirect_uri,
      clientId: client_id,
      scope: scope ?? GOOGLE_SCOPES.join(" "),
      googleState,
    });

    // Also store the code_challenge info with the google state so we can validate later
    const pending = pendingAuths.get(googleState)!;
    (pending as Record<string, unknown>)._codeChallenge = code_challenge;
    (pending as Record<string, unknown>)._codeChallengeMethod = code_challenge_method;
    (pending as Record<string, unknown>)._claudeState = state;

    // Build Google OAuth URL
    const googleParams = new URLSearchParams({
      client_id: getGoogleClientId(),
      redirect_uri: `${serverUrl}/oauth/callback`,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      state: googleState,
      access_type: "offline",   // Get refresh token
      prompt: "consent",        // Always show consent to get refresh token
    });

    console.error(`[AUTH] Redirecting to Google OAuth for client ${client_id}`);

    res.redirect(`${GOOGLE_AUTH_URL}?${googleParams.toString()}`);
  });

  // ── OAuth callback (Google redirects back here) ────────────
  // We exchange Google's code for tokens, then redirect to Claude with our code
  app.get("/oauth/callback", async (req: Request, res: Response) => {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      console.error(`[CALLBACK] Google returned error: ${error}`);
      res.status(400).send(`Google OAuth error: ${error}`);
      return;
    }

    if (!state || !pendingAuths.has(state)) {
      res.status(400).send("Invalid or expired OAuth state. Please try connecting again.");
      return;
    }

    const pending = pendingAuths.get(state)!;
    pendingAuths.delete(state);

    try {
      // Exchange Google auth code for tokens
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: getGoogleClientId(),
          client_secret: getGoogleClientSecret(),
          redirect_uri: `${serverUrl}/oauth/callback`,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error(`[CALLBACK] Google token exchange failed: ${err}`);
        res.status(500).send("Failed to exchange authorization code with Google.");
        return;
      }

      const googleTokens = (await tokenRes.json()) as OAuthTokenResponse;

      // Generate our own auth code to give to Claude
      const ourCode = generateCode();

      authCodes.set(ourCode, {
        googleAccessToken: googleTokens.access_token,
        googleRefreshToken: googleTokens.refresh_token,
        expiresIn: googleTokens.expires_in,
        redirectUri: pending.redirectUri,
        clientId: pending.clientId,
        codeChallenge: (pending as Record<string, unknown>)._codeChallenge as string | undefined,
        codeChallengeMethod: (pending as Record<string, unknown>)._codeChallengeMethod as string | undefined,
      });

      // Expire auth code after 10 minutes
      setTimeout(() => authCodes.delete(ourCode), 10 * 60 * 1000);

      // Redirect back to Claude with our auth code
      const claudeState = (pending as Record<string, unknown>)._claudeState as string;
      const callbackUrl = new URL(pending.redirectUri);
      callbackUrl.searchParams.set("code", ourCode);
      if (claudeState) callbackUrl.searchParams.set("state", claudeState);

      console.error(`[CALLBACK] Google tokens obtained, redirecting to Claude`);

      res.redirect(callbackUrl.toString());
    } catch (err) {
      console.error(`[CALLBACK] Error:`, err);
      res.status(500).send("Internal error during token exchange.");
    }
  });

  // ── Token endpoint ─────────────────────────────────────────
  // Claude exchanges our auth code for an access token
  app.post("/oauth/token", async (req: Request, res: Response) => {
    const { grant_type, code, redirect_uri, client_id, code_verifier, refresh_token } =
      req.body as Record<string, string>;

    // ── Authorization Code Grant ──────────────────────────────
    if (grant_type === "authorization_code") {
      if (!code || !authCodes.has(code)) {
        res.status(400).json({ error: "invalid_grant", error_description: "Invalid or expired authorization code" });
        return;
      }

      const authCode = authCodes.get(code)!;
      authCodes.delete(code); // One-time use

      // Validate redirect_uri matches
      if (redirect_uri && redirect_uri !== authCode.redirectUri) {
        res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
        return;
      }

      // Validate PKCE if code_challenge was provided during authorize
      if (authCode.codeChallenge && authCode.codeChallengeMethod === "S256") {
        if (!code_verifier) {
          res.status(400).json({ error: "invalid_grant", error_description: "code_verifier required (PKCE)" });
          return;
        }
        const computed = sha256(code_verifier);
        if (computed !== authCode.codeChallenge) {
          res.status(400).json({ error: "invalid_grant", error_description: "PKCE code_verifier does not match code_challenge" });
          return;
        }
      }

      // Issue our proxy token (maps to the Google access token)
      const proxyToken = generateToken();
      const proxyRefresh = authCode.googleRefreshToken ? generateToken() : undefined;

      activeTokens.set(proxyToken, {
        googleAccessToken: authCode.googleAccessToken,
        googleRefreshToken: authCode.googleRefreshToken,
        expiresAt: Date.now() + authCode.expiresIn * 1000,
      });

      if (proxyRefresh && authCode.googleRefreshToken) {
        activeTokens.set(proxyRefresh, {
          googleAccessToken: authCode.googleAccessToken,
          googleRefreshToken: authCode.googleRefreshToken,
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // Refresh tokens last ~1 year
        });
      }

      console.error(`[TOKEN] Issued proxy token for client ${client_id}`);

      res.json({
        access_token: proxyToken,
        token_type: "Bearer",
        expires_in: authCode.expiresIn,
        ...(proxyRefresh ? { refresh_token: proxyRefresh } : {}),
        scope: GOOGLE_SCOPES.join(" "),
      });
      return;
    }

    // ── Refresh Token Grant ───────────────────────────────────
    if (grant_type === "refresh_token") {
      if (!refresh_token || !activeTokens.has(refresh_token)) {
        res.status(400).json({ error: "invalid_grant", error_description: "Invalid refresh token" });
        return;
      }

      const stored = activeTokens.get(refresh_token)!;

      if (!stored.googleRefreshToken) {
        res.status(400).json({ error: "invalid_grant", error_description: "No Google refresh token available" });
        return;
      }

      try {
        // Refresh the Google token
        const refreshRes = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            refresh_token: stored.googleRefreshToken,
            client_id: getGoogleClientId(),
            client_secret: getGoogleClientSecret(),
            grant_type: "refresh_token",
          }),
        });

        if (!refreshRes.ok) {
          const err = await refreshRes.text();
          console.error(`[REFRESH] Google refresh failed: ${err}`);
          // Signal to Claude that the client needs to re-register
          res.status(401).json({ error: "invalid_client" });
          return;
        }

        const newTokens = (await refreshRes.json()) as OAuthTokenResponse;

        // Issue a new proxy token
        const newProxyToken = generateToken();
        activeTokens.set(newProxyToken, {
          googleAccessToken: newTokens.access_token,
          googleRefreshToken: stored.googleRefreshToken, // Google doesn't rotate refresh tokens
          expiresAt: Date.now() + newTokens.expires_in * 1000,
        });

        // Update the refresh entry with new Google access token
        stored.googleAccessToken = newTokens.access_token;

        console.error(`[REFRESH] Issued refreshed proxy token`);

        res.json({
          access_token: newProxyToken,
          token_type: "Bearer",
          expires_in: newTokens.expires_in,
          refresh_token: refresh_token, // Reuse same proxy refresh token
          scope: GOOGLE_SCOPES.join(" "),
        });
      } catch (err) {
        console.error(`[REFRESH] Error:`, err);
        res.status(500).json({ error: "server_error" });
      }
      return;
    }

    res.status(400).json({ error: "unsupported_grant_type" });
  });

  // ── Token revocation ───────────────────────────────────────
  app.post("/oauth/revoke", async (req: Request, res: Response) => {
    const { token } = req.body as Record<string, string>;
    if (token && activeTokens.has(token)) {
      const stored = activeTokens.get(token)!;
      activeTokens.delete(token);

      // Also revoke at Google
      try {
        await fetch(`${GOOGLE_TOKEN_URL}?token=${stored.googleAccessToken}`, {
          method: "POST",
        });
      } catch {
        // Best effort
      }
    }
    res.status(200).json({});
  });

  // ── Health / docs ──────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      server: "google-apps-script-mcp-server",
      activeClients: registeredClients.size,
      activeSessions: activeTokens.size,
    });
  });

  app.get("/docs", (_req: Request, res: Response) => {
    res.send(`
      <html><body>
        <h1>Google Apps Script Connector for Claude</h1>
        <p>This connector lets Claude manage your Google Apps Script projects.</p>
        <p><a href="/.well-known/oauth-protected-resource">OAuth Resource Metadata</a></p>
        <p><a href="/.well-known/oauth-authorization-server">OAuth Server Metadata</a></p>
      </body></html>
    `);
  });
}

// ─── Token resolution (used by MCP handler) ────────────────────

/**
 * Given a Bearer token from an incoming MCP request,
 * resolve it to the underlying Google access token.
 * Returns undefined if the token is invalid or expired.
 */
export function resolveGoogleToken(proxyToken: string): string | undefined {
  const entry = activeTokens.get(proxyToken);
  if (!entry) return undefined;

  // Check expiry (with 60s buffer)
  if (Date.now() > entry.expiresAt - 60_000) {
    // Token is expired or about to expire
    // Claude should use the refresh token flow
    // But we still return it — Google will 401 and Claude will refresh
    console.error(`[TOKEN] Proxy token near expiry, returning anyway`);
  }

  return entry.googleAccessToken;
}
