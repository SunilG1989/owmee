# Owmee OPS6 Dispatch Console

> **Status (2026-05): legacy / not the primary admin UI.**
>
> This Vite + React app shipped in Sprint 4 Pass 3 and covers FE dispatch,
> FE list/earnings, FE-assisted listings, audit log, and stuck workflows. It
> still works against the same backend, but `node_modules/` is not committed
> and no one has installed it in months.
>
> The current ops-facing admin is the server-rendered Jinja2 hub at
> `backend/app/admin_web/` (mounted at `/admin/*` on the FastAPI app). It
> covers disputes, refunds, returns, pickup hub, dispatch queue, and
> transaction detail — the surfaces ops actually uses at hyperlocal pilot
> scale. New admin features should land there, not here.
>
> Keep this Vite app around until its FE-management pages (assign FE,
> create FE, FE earnings) are ported into `admin_web/`. After that it can
> be deleted.
>
> If you do need to run it locally: `cd admin && npm install && npm run dev`.

Sprint 4 Pass 3 admin web app. Minimal Vite + React + TypeScript + Tailwind.

## Quick start

```bash
cd admin
npm install
npm run dev
```

Opens on http://localhost:3001.

On first run, use the **"Bootstrap super admin (dev only)"** link on the login
page to create a SUPER_ADMIN account (available only when the backend is in
non-production mode).

## Backend connection

In dev, Vite proxies `/v1/*` to `http://localhost:8000`. For production, set
`VITE_API_BASE` at build time:

```bash
VITE_API_BASE=https://api.owmee.in npm run build
```

## Pages

- `/dispatch` — queue of all FE visits, filterable by status
- `/visits/:id` — detail view with FE + category + slot picker; assign/reassign
- `/fes` — Field executive list; create new FEs (attaches `fe` role to a user)
- `/fe-listings` — FE-assisted listings review queue; approve/reject with ops stamping

## RBAC

All endpoints are gated by the backend:
- Read endpoints (queue, visit detail, FE list): any admin role
- Write endpoints (assign, approve, reject, create FE): L2_REVIEWER+
- SUPER_ADMIN bypasses all role gates

## Session

Admin tokens live in `localStorage` under `owmee_admin_token`. Tokens expire
after 15 minutes — the UI currently requires re-login after expiry; silent
refresh is a Pass 4 item.
