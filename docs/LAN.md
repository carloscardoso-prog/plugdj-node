# LAN host architecture (Minecraft-style)

Local Node process hosts rooms. Clients connect by invite URL or room slug + password. No public discovery.

## Decisions (specified)

| Topic | Choice |
|--------|--------|
| **JSON location** | `PLUGDJ_DATA_DIR` if set, else `./data` next to the project (outside the client bundle). Packaged apps can point this at the OS userData folder. |
| **Host process exits** | All WebSocket clients disconnect immediately. `rooms.json` / `server.json` flush to disk. Live users, queue, DJ, and chat are **not** persisted — empty on next boot. |
| **Port / bind** | Configurable: `PLUGDJ_PORT` or `PORT` (default `3000`), `HOST` (default `0.0.0.0` for LAN). Not auto-detect. |
| **Room delete** | Hard-delete: remove from memory + `rooms.json`, kick connected sockets. |

## Identity

| ID | Where | Meaning |
|----|--------|---------|
| `serverUUID` | `data/server.json` | Stable id for this host instance |
| `roomUUID` | `data/rooms.json` | Opaque room id (`id` in memory) |
| `slug` | URL path | Human invite address (`/neon-beats`) |
| `userUUID` | client profile (`localStorage` / future `profile.json`) | Global client identity |
| `serverIssuedUUID` | `server.json` users + `user.id` in room | Identity of that user **on this server** |

Reconnect: client sends `serverIssuedUUID` from history for that `serverUUID`. Server binds / reuses via `serverStore.resolveIdentity`.

## Files

- `data/server.json` — serverUUID + user bindings  
- `data/rooms.json` — local rooms (`roomUUID`, `slug`, `passwordHash`, …)  
- Client profile — browser `localStorage` key `plugdj-profile` (same schema as `profile.json`)
