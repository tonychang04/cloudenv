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

## Commands

| Command | Description |
|---------|-------------|
| `cloudenv login` | Store Fly.io API token |
| `cloudenv up` | Provision environment from docker-compose.yml |
| `cloudenv down [name]` | Destroy an environment |
| `cloudenv status [name]` | Check health of an environment |
| `cloudenv list` | Show running environments |
| `cloudenv logs <env> [service]` | View logs from an environment |

## How It Works

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

1. Reads your `docker-compose.yml` and parses services, ports, environment variables, and dependencies
2. Creates a Fly.io app with a name derived from your repo and branch
3. Provisions **one Fly Machine** with all services as containers sharing a network namespace
4. Injects `/etc/hosts` so service names (db, redis) resolve to `localhost`
5. Allocates public IPs and returns a URL like `https://ce-myrepo-feature-branch.fly.dev`

All containers share `localhost`. Your app connects to `db:5432` or `redis:6379` and it just works, exactly like docker-compose. The web service with `ports:` gets public HTTPS routing.

## Options

```bash
cloudenv up -f custom-compose.yml    # Custom compose file path
cloudenv up --region lax             # Fly.io region (default: iad)
cloudenv up --name my-env            # Override environment name
cloudenv down --force                # Skip confirmation
cloudenv list --json                 # JSON output
cloudenv status --json               # JSON output
```

## Requirements

- Node.js >= 18
- [Fly.io](https://fly.io) account with API token
- Docker (only if your compose file uses `build:` instead of `image:`)

## Development

```bash
npm install
npm test          # Run tests (78 tests)
npm run build     # Compile TypeScript
npm run dev       # Watch mode
```

## License

MIT
