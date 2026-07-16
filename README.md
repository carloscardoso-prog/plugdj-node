# plug.dj (LAN host)

A **local Plug.dj-style** music room: Node.js HTTP + WebSocket host on your machine. Friends join with an invite URL — like a **Minecraft LAN world**. There is **no public room directory**; only people with the link (and password, if you set one) can connect.

## Prerequisites

- **Node.js 18+** (LTS recommended) — [https://nodejs.org/](https://nodejs.org/)
- `npm` (ships with Node)

Optional for YouTube / media downloads: a working [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) install on the host.

## Install & run

### Option A — from source (clone)

**Linux / macOS**

```bash
git clone [<your-repo-url>](https://github.com/carloscardoso-prog/plugdj-node) plug-dj
cd plug-dj
chmod +x install.sh start.sh
./install.sh
./start.sh
```

**Windows**

```bat
git clone [<your-repo-url>](https://github.com/carloscardoso-prog/plugdj-node) plug-dj
cd plug-dj
install.bat
start.bat
```

Then open the URL printed in the terminal (default: **http://localhost:3000/**).

> On Unix, scripts need execute permission: `chmod +x install.sh start.sh`.

### Option B — Releases (future)

When binary / packaged releases exist, download from the GitHub **Releases** tab and run the app directly — no `npm install` required.

### Port / bind

| Variable        | Default     | Meaning                          |
|-----------------|-------------|----------------------------------|
| `PLUGDJ_PORT` / `PORT` | `3000` | HTTP + WebSocket port     |
| `HOST`          | `0.0.0.0`   | Listen on all interfaces (LAN)   |
| `PLUGDJ_DATA_DIR` | `./data`  | Where `server.json` / `rooms.json` are stored |

Example:

```bash
PLUGDJ_PORT=3001 ./start.sh
```

## Rooms & invites

1. Start the host (`./start.sh` / `start.bat`).
2. Open **http://localhost:3000/** — tab **My Rooms** lists rooms on *this* machine.
3. **Create** a room (optional password) → you become the owner.
4. Share an invite URL:

```text
http://<host-ip-or-hostname>:3000/<room-slug>
```

Example: `http://192.168.1.20:3000/neon-beats`

Guests need the slug (and password if set). There is no automatic discovery of other servers on the network.

- **Delete** a room from **My Rooms** (hard-delete; kicks connected clients).
- Closing the host process disconnects everyone; room *metadata* is saved under `data/`, but live queue / DJ / chat are not.

## Project layout

```text
plug-dj/
├── install.sh / install.bat   # Dependency installer
├── start.sh / start.bat       # Start LAN host
├── index.html                 # Home: My Rooms / Join / Create
├── room.html / room.js / room.css
├── client/src/                # Browser services & UI helpers
├── server/src/                # Express + WebSocket + room logic
├── assets/                    # Avatars, backgrounds, icons
├── data/                      # Runtime only (gitignored) — server.json, rooms.json
├── docs/LAN.md                # Identity / persistence notes
└── package.json
```

Identity model (server UUID, room UUID, user UUID): see [`docs/LAN.md`](docs/LAN.md).

## Development

```bash
npm install
npm run dev    # watch mode
npm start      # production-style start
```

## License

**GNU General Public License v3.0 (or later)** — see [LICENSE](LICENSE).

This is free and open-source software. You may run, study, share, and modify it under the GPL-3.0. If you distribute this program (or a modified version), you must keep it free under the same license — including source code. Selling proprietary locked-down forks of this project is not allowed under these terms.
