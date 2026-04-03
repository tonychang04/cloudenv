# cloudenv

Ephemeral full-stack environments per git branch. Read a `docker-compose.yml`, provision isolated environments on [Fly.io](https://fly.io), get a URL back in seconds.

Built for AI coding agents running parallel sessions that need independent staging environments.

## Install

```bash
npm install -g cloudenv
```

## Quick Start

```bash
# Authenticate with Fly.io
cloudenv login --token <your-fly-api-token>

# Spin up an environment from your docker-compose.yml
cloudenv up

# Check status
cloudenv status

# View logs
cloudenv logs <env-name>

# List all environments
cloudenv list

# Tear it down
cloudenv down
```

## Architecture

```
cloudenv up
  |
  v
+------------------+     +----------------------------------+
| 1. DETECT        |     | Compose file detection:          |
|    Find the right|---->|   docker-compose.prod.yml (best) |
|    compose file  |     |   docker-compose.yml             |
+------------------+     |   docker-compose.cloudenv.yml    |
  |                      |   Auto-detect stack (Node/Py/Go) |
  v                      +----------------------------------+
+------------------+     +----------------------------------+
| 2. PREFLIGHT     |     | Scan for issues:                 |
|    Check cloud   |---->|   Bind mounts -> warning         |
|    readiness     |     |   docker.sock -> skip service    |
+------------------+     |   Port conflicts -> error        |
  |                      +----------------------------------+
  v
+------------------+     +----------------------------------+
| 3. BUILD         |     | For services with build:         |
|    Parallel image|---->|   flyctl: native amd64 on Fly    |
|    builds        |     |   Docker: local fallback         |
+------------------+     |   Cache app persists layers      |
  |                      +----------------------------------+
  v
+------------------+     +----------------------------------+
| 4. DEPLOY        |     | Single Fly Machine:              |
|    Multi-container|---->|   All services in one VM         |
|    machine       |     |   Shared localhost network       |
+------------------+     |   /etc/hosts for service names   |
  |                      |   depends_on + healthchecks      |
  v                      +----------------------------------+
+------------------+
| 5. URL           |
|    https://ce-   |
|    app-branch    |
|    .fly.dev      |
+------------------+
```

### Multi-Container Machines

```
docker-compose.yml                 Fly.io
+-----------------+                +--------------------------------------+
| services:       |                | Single Fly Machine (Firecracker VM)  |
|   web:          |   cloudenv up  | +----------+ +------+ +-------+     |
|     image: nginx|  ----------->  | |  nginx   | |  pg  | | redis |     |
|   db:           |                | |  :80     | | :5432| | :6379 |     |
|     image: pg   |                | +----------+ +------+ +-------+     |
|   redis:        |                |        shared localhost network      |
|     image: redis|                |                                      |
+-----------------+                | https://ce-myapp-feature.fly.dev     |
                                   +--------------------------------------+
```

All containers share `localhost`. Your app connects to `db:5432` or `redis:6379` and it just works, exactly like docker-compose. Service names resolve via `/etc/hosts` injection. Container startup follows `depends_on` ordering with health checks.

### Build Pipeline

```
BUILD (parallel):                              CACHE:
  postgres ████░░░░  (wrapper Dockerfile)        ce-cache-{repo} app
  insforge ██████████ (full app build)           persists across deploys
  deno     ██░░░░░░  (wrapper Dockerfile)        "Layer already exists"

  flyctl: builds on Fly's amd64 hardware (fast, no QEMU)
  Docker: local fallback if flyctl not installed
```

First deploy builds all images (~4 min). Subsequent deploys reuse cached layers (~1 min).

## Commands

| Command | Description |
|---------|-------------|
| `cloudenv login` | Store Fly.io API token |
| `cloudenv up` | Provision environment from docker-compose.yml or auto-detect |
| `cloudenv down [name]` | Destroy an environment |
| `cloudenv status [name]` | Check health of an environment |
| `cloudenv list` | Show running environments |
| `cloudenv logs <env> [service]` | View logs from an environment |

## Options

```bash
cloudenv up -f custom-compose.yml    # Custom compose file path
cloudenv up --region lax             # Fly.io region (default: iad)
cloudenv up --name my-env            # Override environment name
cloudenv up --port 7130              # Override public-facing port
cloudenv down --force                # Skip confirmation
cloudenv list --json                 # JSON output
cloudenv status --json               # JSON output
```

## Smart Detection

cloudenv automatically handles real-world compose files:

- **Prod over dev**: Prefers `docker-compose.prod.yml` over `docker-compose.yml`
- **Env var resolution**: `${VAR:-default}` resolved to defaults automatically
- **Build args**: Passed through to Docker/flyctl builders
- **Healthchecks**: Compose healthchecks mapped to Fly container healthchecks
- **Dependency ordering**: `depends_on: condition: service_healthy` respected
- **Port detection**: Skips infra ports (5432, 6379), prefers services with `build:`
- **Preflight checks**: Warns about bind mounts, blocks docker.sock, detects port conflicts
- **Auto-skip**: Services that can't run on Fly (docker.sock) are skipped automatically

## Auto-Detection (no compose file needed)

```bash
cd my-nextjs-project
cloudenv up
# Detected: Node.js 20 + Postgres
# Generated docker-compose.cloudenv.yml
# Building...
# URL: https://ce-myproject-main.fly.dev
```

Supports Node.js, Python, Go. Scans dependencies for databases (prisma -> postgres, redis imports -> redis, etc.). Generates Dockerfile + compose file.

## Claude Code Skill

Install the skill for AI-assisted deployment:

```bash
cp -r cloudenv/.claude/skills/cloudenv-deploy your-project/.claude/skills/
```

Then tell Claude Code: "deploy this to a preview env". The agent analyzes your project, generates wrapper Dockerfiles for bind mounts, resolves env vars, and calls cloudenv.

## Performance

| Scenario | Time |
|----------|------|
| First deploy (cold build) | ~4 min |
| Subsequent deploy (cached) | ~1 min |
| Same-code redeploy | ~30 sec |
| Tear down | ~5 sec |

## Cost

| Resource | Cost |
|----------|------|
| Machine runtime | ~$0.05/hr (shared-cpu-2x, 2GB) |
| Registry storage | Free |
| Shared IPv4 | Free |
| IPv6 | Free |
| Cache app | Free (no machines, just registry) |

Environments cost nothing when destroyed. Only pay for machine runtime while running.

## Requirements

- Node.js >= 18
- [Fly.io](https://fly.io) account with API token
- `flyctl` installed (for remote builds, recommended) OR Docker (local builds, slower on Apple Silicon)

## Development

```bash
npm install
npm test          # Run tests (112 tests)
npm run build     # Compile TypeScript
npm run dev       # Watch mode
```

## License

MIT
