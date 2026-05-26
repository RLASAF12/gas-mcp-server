# Google Apps Script Connector for Claude

> Connect Claude to Google Apps Script. Authenticate with Google and Claude can list, read, edit, deploy, and run your Apps Script projects.

[![MCP](https://img.shields.io/badge/MCP-Connector-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Built by Harel Asaf](https://img.shields.io/badge/Built%20by-Harel%20Asaf-teal)](https://www.linkedin.com/in/harel-asaf/)

## What It Does

Once connected, Claude gets 11 tools for managing your Apps Script projects:

| Tool | Action | Type |
|------|--------|------|
| `gas_list_projects` | Discover all Apps Script projects from Drive | Read |
| `gas_get_project` | Get project metadata (title, creator, dates) | Read |
| `gas_get_content` | Read all source files (.gs, .html, appsscript.json) | Read |
| `gas_update_content` | Write/replace project files | Write |
| `gas_create_project` | Create new standalone or bound project | Write |
| `gas_list_deployments` | List deployments & web app URLs | Read |
| `gas_create_deployment` | Deploy a versioned snapshot | Write |
| `gas_create_version` | Snapshot HEAD as immutable version | Write |
| `gas_list_versions` | List all saved versions | Read |
| `gas_run_function` | Execute a function remotely | Write |
| `gas_get_logs` | View execution history & statuses | Read |

## How It Works

```
User clicks "Connect" in Claude
        ↓
Claude discovers OAuth endpoints (RFC 9728 / RFC 8414)
        ↓
User authenticates with Google
        ↓
Server proxies OAuth — Claude never sees Google tokens
        ↓
Claude calls Apps Script & Drive APIs through the proxy
```

The server acts as an **OAuth proxy**: Claude gets a proxy token, the server maps it to your real Google token on every request.

## Quick Start

### Prerequisites

- Node.js 20+
- A Google Cloud project with Drive API and Apps Script API enabled
- OAuth 2.0 credentials (Web application type)

### Local Development

```bash
git clone https://github.com/RLASAF12/gas-mcp-server.git
cd gas-mcp-server
npm install
cp .env.example .env
# Edit .env with your Google OAuth credentials
npm run dev
```

### Google Cloud Setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable **Google Drive API** and **Apps Script API**
3. Configure OAuth consent screen (External, Testing mode)
4. Create OAuth 2.0 Client ID (Web application)
5. Add redirect URI: `https://YOUR-SERVER-URL/oauth/callback`

### Connect to Claude

**Hosted version (recommended):**
1. In Claude → Settings → Integrations → Add custom connector
2. Enter: `https://gas-mcp-server-51191653129.europe-west1.run.app/mcp`
3. Authenticate with Google when prompted

**Self-hosted:**
1. Deploy the server (see Deployment below)
2. In Claude → Settings → Integrations → Add custom connector
3. Enter your server URL: `https://YOUR-SERVER-URL/mcp`
4. Authenticate with Google when prompted

## Deployment

### Docker

```bash
docker build -t gas-mcp-server .
docker run -p 8080:8080 --env-file .env gas-mcp-server
```

### Google Cloud Run

```bash
chmod +x deploy.sh
./deploy.sh PROJECT_ID REGION YOUR_CLIENT_ID YOUR_CLIENT_SECRET
```

## OAuth Scopes

All scopes are **sensitive** (not restricted). No CASA audit required.

| Scope | Purpose |
|-------|---------|
| `drive.readonly` | List Apps Script files by mimeType |
| `script.projects` | Read/write script source code |
| `script.deployments` | Create and list deployments |
| `script.processes` | View execution logs |

## Architecture

```
gas-mcp-server/
├── src/
│   ├── index.ts                 # Express + MCP + auth middleware
│   ├── constants.ts             # API URLs, scopes
│   ├── types.ts                 # TypeScript interfaces
│   ├── auth/
│   │   └── oauth-proxy.ts       # OAuth 2.1 proxy (DCR, PKCE, token exchange)
│   ├── schemas/
│   │   └── tool-schemas.ts      # Zod input validation
│   ├── services/
│   │   └── google-api-client.ts # Google API HTTP client
│   └── tools/
│       ├── projects.ts          # Project CRUD operations
│       └── deployments.ts       # Deploy, version, run, logs
├── Dockerfile
├── deploy.sh
└── package.json
```

## Security

- Proxy tokens: 48 random bytes (base64url)
- Auth codes: single-use, 10-minute expiry
- PKCE S256 validated on every token exchange
- Google tokens never exposed to Claude

## Privacy

No user data is stored. OAuth tokens are held in server memory only for the duration of your session. No data is persisted to disk or shared with third parties. Revoke access anytime at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## License

MIT

## Author

**Harel Asaf**

- GitHub: [@RLASAF12](https://github.com/RLASAF12)
- LinkedIn: [harel-asaf](https://www.linkedin.com/in/harel-asaf/)
- Email: harel.asaf7@gmail.com
