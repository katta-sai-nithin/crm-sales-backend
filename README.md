# CRM Sales Management System — Backend

A production-quality **REST API** for managing the complete B2B sales lifecycle:

```
Lead generation → Lead qualification → Customer conversion → Deal management → Deal closure
```

Built with **Node.js + Express 5 + MongoDB (Mongoose)** in JavaScript (ES modules), with
JWT authentication, three-level role based access control, resource-level scoping,
transactional lead conversion, an append-only audit trail, aggregation-based analytics
and automated tests.

> This repository contains the **backend only**. No frontend is included.

---

## Table of contents

1. [Main features](#1-main-features)
2. [Technology stack](#2-technology-stack)
3. [Architecture and directory structure](#3-architecture-and-directory-structure)
4. [MongoDB collection design](#4-mongodb-collection-design)
5. [Entity relationships](#5-entity-relationships)
6. [Installation requirements](#6-installation-requirements)
7. [Local setup](#7-local-setup)
8. [MongoDB Atlas setup](#8-mongodb-atlas-setup)
9. [Environment variables](#9-environment-variables)
10. [Creating the first Admin](#10-creating-the-first-admin)
11. [Running the application](#11-running-the-application)
12. [Authentication flow](#12-authentication-flow)
13. [Roles and permissions](#13-roles-and-permissions)
14. [API endpoint summary](#14-api-endpoint-summary)
15. [Swagger documentation](#15-swagger-documentation)
16. [Postman collection](#16-postman-collection)
17. [Business rules](#17-business-rules)
18. [Indexing and performance decisions](#18-indexing-and-performance-decisions)
19. [Running the tests](#19-running-the-tests)
20. [Seed data](#20-seed-data)
21. [Deployment](#21-deployment)
22. [Security notes](#22-security-notes)
23. [Assumptions and known limitations](#23-assumptions-and-known-limitations)

---

## 1. Main features

| Area | Highlights |
| --- | --- |
| **Authentication** | JWT access + refresh tokens, refresh-token **rotation with reuse detection**, bcrypt hashing, generic login errors, per-account + per-IP rate limiting, HTTP-only refresh cookie, account deactivation enforcement |
| **Authorization** | `ADMIN` / `SALES_MANAGER` / `SALES_EXECUTIVE` roles, resource-level ownership scoping, team scoping, field allowlists on every write |
| **Leads** | Full CRUD, status-transition graph, priority/source filters, safe regex search, secure assignment/reassignment, delete guards |
| **Conversion** | `QUALIFIED` lead → Customer + initial Deal in a single **MongoDB transaction**, concurrency-safe (exactly one winner), complete rollback on failure |
| **Customers** | Manual and converted customers, origin tracking, deals/activities/timeline sub-resources, deletion guards |
| **Deals** | Pipeline stages, server-computed `expectedRevenue`, WON/LOST rules, `closedAt` handling, explicit **reopen** operation, reassignment |
| **Activities** | Calls, emails, meetings, demos, follow-ups, reminders, notes; **derived OVERDUE status** computed in the query layer (no cron dependency) |
| **Timeline** | Append-only audit trail for every important event, previous/new values, secret redaction |
| **Analytics** | Dashboard, pipeline-by-stage, team performance and lead-source reports, all computed with aggregation pipelines and role scoped |
| **Platform** | Centralised validation (Zod), centralised error handling, Helmet, CORS allowlist, rate limits, graceful shutdown, Pino logging, Swagger, Postman, ESLint |

---

## 2. Technology stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js ≥ 20 (tested on 22) |
| Framework | Express 5 |
| Language | JavaScript, ES modules (`"type": "module"`) |
| Database | MongoDB Atlas or local MongoDB 6/7 |
| ODM | Mongoose 9 |
| Auth | `jsonwebtoken` (JWT) |
| Hashing | `bcryptjs` (pure-JS bcrypt — identical algorithm, no native build step) |
| Validation | Zod 4 |
| Docs | `swagger-ui-express` + `swagger-jsdoc` (OpenAPI 3.0.3) |
| Security | `helmet`, `cors`, `express-rate-limit`, `cookie-parser` |
| Config | `dotenv` with startup validation |
| Logging | `pino` / `pino-http` / `pino-pretty` |
| Tests | Vitest + Supertest + `mongodb-memory-server` (replica set) |
| Dev | Nodemon |
| Lint | ESLint 9 (flat config) |

---

## 3. Architecture and directory structure

```
crm-sales-backend/
├── src/
│   ├── app.js                     # Express application (middleware pipeline)
│   ├── server.js                  # Bootstrap: validate env → connect DB → listen → graceful shutdown
│   ├── config/
│   │   ├── database.js            # Mongoose connection, redacted URI logging
│   │   ├── env.js                 # Typed config + startup validation
│   │   ├── logger.js              # Pino with redaction of secrets
│   │   └── swagger.js             # OpenAPI definition (components) + jsdoc merge
│   ├── constants/                 # Enums, transition graphs, pagination rules
│   │   ├── roles.js  lead.js  customer.js  deal.js  activity.js
│   │   ├── timeline.js  pagination.js  http.js  index.js
│   ├── models/                    # Mongoose schemas, hooks and indexes
│   │   ├── User.js  (also exports Team)
│   │   ├── RefreshToken.js  Lead.js  Customer.js  Deal.js  Activity.js
│   │   ├── Timeline.js  index.js
│   ├── routes/                    # Express routers + OpenAPI JSDoc blocks
│   │   ├── index.js  auth.routes.js  user.routes.js  lead.routes.js
│   │   ├── customer.routes.js  deal.routes.js  activity.routes.js
│   │   ├── analytics.routes.js  health.routes.js
│   ├── controllers/               # HTTP layer: parse -> call service -> shape response
│   ├── services/                  # Business logic, authorization, transactions
│   │   ├── auth.service.js  token.service.js  user.service.js
│   │   ├── accessScope.service.js  lead.service.js  customer.service.js
│   │   ├── deal.service.js  activity.service.js  conversion.service.js
│   │   ├── analytics.service.js  timeline.service.js
│   ├── middleware/
│   │   ├── authenticate.js  authorize.js  validate.js
│   │   ├── errorHandler.js  rateLimiter.js  asyncHandler.js
│   ├── validators/                # Reusable Zod schemas (strict)
│   │   ├── common.validator.js  auth.validator.js
│   │   ├── crm.validator.js  deal.validator.js  index.js
│   ├── utils/
│   │   ├── ApiError.js  ApiResponse.js  query.js  money.js
│   │   ├── sanitize.js  objectId.js
│   ├── jobs/
│   │   └── index.js               # Optional maintenance job (persists OVERDUE flag)
│   └── scripts/
│       ├── bootstrapAdmin.js  seed.js
├── tests/
│   ├── setup/                     # globalSetup (in-memory replica set), per-file DB, helpers
│   ├── unit/utils.test.js
│   └── integration/               # auth, users, leads, conversion, customers, deals,
│                                  # activities, analytics, smoke
├── docs/                          # Architecture / design notes
├── postman/                       # Collection + development environment
├── scripts/smoke.js               # Live end-to-end smoke check
├── .env.example
├── .gitignore  eslint.config.js  vitest.config.js
├── package.json
└── README.md
```

### Layering rules

```
route  ->  middleware (auth/role/validation)  ->  controller  ->  service  ->  model
```

* **Routes** contain no business logic, only middleware wiring and OpenAPI docs.
* **Controllers** only translate HTTP ↔ service calls and shape the response envelope.
* **Services** own all business rules, authorization decisions and database writes.
* **Models** own schema validation, computed fields and indexes.

---

## 4. MongoDB collection design

| Collection | Purpose | Key fields | Notable indexes |
| --- | --- | --- | --- |
| `users` | CRM accounts | `name, email(unique, lowercase), phone, passwordHash(select:false), role, isActive, team, lastLoginAt` | `{email}` unique, `{role, isActive}`, text `{name, email}` |
| `teams` | Manager → team membership | `name, members[User]` | implicit on `members` |
| `refreshtokens` | Refresh sessions | `user, tokenHash(select:false), familyId, expiresAt(TTL), revokedAt, replacedByTokenHash, userAgent, ip` | `{tokenHash}`, `{user, revokedAt}`, TTL `{expiresAt}` |
| `leads` | Top of funnel | `name, email, phone, company, source, status, priority, assignedTo, description, createdBy, convertedCustomer, convertedDeal, convertedAt` | `{status, createdAt}`, `{assignedTo, status, createdAt}`, `{status, priority, source, createdAt}`, `{createdBy, createdAt}`, `{email}`, text `{name, company, email}` |
| `customers` | Converted / manual accounts | `name, email, phone, company, address, originalLead, assignedTo, status, origin, notes` | **unique partial `{originalLead}`**, `{assignedTo, status, createdAt}`, `{createdAt}`, `{email}`, text `{name, company, email}` |
| `deals` | Pipeline items | `name, lead, customer, assignedTo, dealValue, probability, expectedRevenue, currency, expectedClosingDate, stage, description, lostReason, createdBy, closedAt` | `{stage, expectedClosingDate}`, `{customer, createdAt}`, `{assignedTo, stage, createdAt}`, `{stage, createdAt}`, `{createdBy, createdAt}`, text `{name}` |
| `activities` | Tasks / follow-ups | `type, title, description, assignedTo, dueDate, status, relatedEntityType, relatedEntityId, createdBy, completedAt` | `{assignedTo, status, dueDate}`, `{relatedEntityType, relatedEntityId, createdAt}`, `{type, createdAt}`, `{status, dueDate}`, text `{title, description}` |
| `timelines` | Append-only audit | `action, entityType, entityId, entityLabel, performedBy, previousValue, newValue, metadata, ip, createdAt` | `{entityType, entityId, createdAt}`, `{performedBy, createdAt}`, `{action, createdAt}`, `{createdAt}` |

All collections use `timestamps` (`createdAt` / `updatedAt`) except `timelines`, which is
create-only by design.

---

## 5. Entity relationships

```
              ┌──────────────── Team ────────────────┐
              │ members[]                             │
              └──────────────┬───────────────────────┘
                             │ (manager scope)
   User ──────────┬──────────┴───────────┬───────────────┐
     ▲            │                      │               │
     │        assignedTo             assignedTo     assignedTo
     │            │                      │               │
  createdBy    Lead ──────────originalLead──▶ Customer ◀──customer── Deal
                  │                            ▲                │
                  │                            │                │ lead
                  │  convertedCustomer         └── deals[] ────┘
                  │  convertedDeal
                  └──▶ Activity (relatedEntityType/relatedEntityId: LEAD|CUSTOMER|DEAL|USER)
                               
  Timeline: polymorphic (entityType + entityId) → append-only audit entries
  RefreshToken: user ──▶ sessions (hash only)
```

* Every relationship uses **ObjectId references**; no duplicated embedded copies.
* `Activity.relatedEntityType` + `relatedEntityId` is a polymorphic reference because an
  activity may belong to a lead, a customer, a deal or a user.
* `Timeline` uses the same polymorphic pattern so one collection can audit every entity.

---

## 6. Installation requirements

* **Node.js ≥ 20** (`node -v`)
* **npm ≥ 10** (`npm -v`)
* **MongoDB** — one of:
  * a local MongoDB 6/7 server, **ideally as a replica set** (transactions),
  * a **MongoDB Atlas** free/shared cluster (supports transactions on every tier).

Check your environment:

```bash
node -v
npm -v
mongod --version   # only for a local server
```

---

## 7. Local setup

```bash
# 1. install dependencies
npm install

# 2. create your local configuration
cp .env.example .env        # Windows PowerShell:  Copy-Item .env.example .env

# 3. generate two different random JWT secrets and paste them into .env
node -e "console.log('ACCESS :', require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('REFRESH:', require('crypto').randomBytes(48).toString('hex'))"

# 4. point MONGODB_URI at your database (see section 8 for Atlas)

# 5. create the first administrator (see section 10)
npm run bootstrap-admin

# 6. (optional) create demo users and sample CRM data
npm run seed

# 7. start the API with hot reload
npm run dev
```

The API listens on <http://localhost:5000> by default.

### Transactions in local development

Lead conversion uses a MongoDB **transaction**, which requires a replica set or a sharded
cluster. A plain standalone `mongod` will *not* work for conversion (the API detects this
and returns `503` instead of pretending to be atomic).

```bash
# start a single node replica set
mongod --replSet rs0 --dbpath ./data/db

# in another shell, initiate it once
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'

# then use this URI in .env
MONGODB_URI=mongodb://127.0.0.1:27017/crm_sales_db?replicaSet=rs0
```

MongoDB Atlas is also a valid option and already runs as a replica set, so no local
`rs.initiate()` is needed (section 8).

---

## 8. MongoDB Atlas setup

1. **Create a free cluster**
   * Sign in at <https://www.mongodb.com/atlas> → **Create** → choose the free **M0** tier.
   * Pick a cloud provider and region close to your application.

2. **Create a database user**
   * **Database Access** → **Add New Database User**.
   * Authentication method **Password**.
   * Username e.g. `crm_app_user`, generate a strong password (Atlas shows it **once** —
     store it in a password manager, never in git).
   * Role: **Read and write to any database**.

3. **Allow your IP address**
   * **Network Access** → **Add IP Address**.
   * For local development click *Allow access from anywhere* (`0.0.0.0/0`) — convenient but
     only acceptable for a throwaway development cluster.
   * For production, add the **static egress IP** of your host instead.

4. **Add a database user to the access list (if required)**
   * **Database Access** → the same user → **Add another database user** / ensure it is
     listed under the cluster.

5. **Copy the connection string**
   * **Database** → **Connect** → *Drivers* → **Node.js**.
   * It looks like:
     `mongodb+srv://crm_app_user:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

6. **Put it in `.env`** (and add the database name after the host):

   ```dotenv
   MONGODB_URI=mongodb+srv://crm_app_user:<password>@cluster0.xxxxx.mongodb.net/crm_sales_db?retryWrites=true&w=majority
   ```

7. **Verify indexes are built**
   * In Atlas, your cluster now has the `crm_sales_db` database with the collections listed
     in section 4 once you create your first record. Indexes are created automatically in
     development (`autoIndex`), and can be built manually in production with:
     `Mongoose.syncIndexes()`.

---

## 9. Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` / `test` / `production` |
| `PORT` | no | `5000` | HTTP port |
| `MONGODB_URI` | **yes** | — | MongoDB connection string (Atlas or local) |
| `MONGO_DB_NAME` | no | from URI | Overrides the database name in the URI |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | no | `10000` | Fail fast if the DB is unreachable |
| `MONGO_MAX_POOL_SIZE` | no | `20` | Driver connection pool size |
| `JWT_ACCESS_SECRET` | **yes** | dev-only derived secret | ≥ 32 chars, must differ from the refresh secret |
| `JWT_REFRESH_SECRET` | **yes** | dev-only derived secret | ≥ 32 chars |
| `JWT_ACCESS_EXPIRES_IN` | no | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | no | `7d` | Refresh token lifetime |
| `JWT_ISSUER` / `JWT_AUDIENCE` | no | `crm-sales-api` / `crm-sales-client` | JWT claim validation |
| `BCRYPT_SALT_ROUNDS` | no | `12` (`4` in test) | Password hashing cost |
| `CORS_ORIGIN` | no | `http://localhost:3000` | Comma-separated allowlist of browser front-ends (same-origin is always allowed) |
| `CORS_CREDENTIALS` | no | `true` | Send `Access-Control-Allow-Credentials` |
| `RATE_LIMIT_ENABLED` | no | `true` | Master switch for rate limiting |
| `RATE_LIMIT_WINDOW_MS` | no | `900000` | Global limiter window |
| `RATE_LIMIT_MAX_REQUESTS` | no | `100` | Global limiter max per window |
| `AUTH_RATE_LIMIT_WINDOW_MS` | no | `900000` | Credential limiter window |
| `AUTH_RATE_LIMIT_MAX_REQUESTS` | no | `10` | Credential limiter max per window/IP+email |
| `JSON_BODY_LIMIT` | no | `1mb` | Request body size cap |
| `TRUST_PROXY` | no | `false` | Set `true` behind a reverse proxy so rate limiting sees real IPs |
| `REFRESH_TOKEN_IN_COOKIE` | no | `true` | Also set an HTTP-only refresh cookie |
| `REFRESH_COOKIE_NAME` | no | `refreshToken` | Cookie name |
| `REFRESH_COOKIE_PATH` | no | `/api/v1/auth` | Restricts the cookie to auth routes |
| `REFRESH_COOKIE_SECURE` | no | `true` in production | `Secure` flag |
| `REFRESH_COOKIE_SAMESITE` | no | `Strict` | `Strict` / `Lax` / `None` |
| `INITIAL_ADMIN_NAME` | for bootstrap | — | First admin display name |
| `INITIAL_ADMIN_EMAIL` | for bootstrap | — | First admin email |
| `INITIAL_ADMIN_PASSWORD` | for bootstrap | — | First admin password (must pass the policy) |
| `SEED_DEMO_DATA` | no | `false` | Allow the demo seeder |
| `SEED_FORCE` | no | `false` | Wipe collections before seeding (dev only) |
| `SEED_DEMO_PASSWORD` | no | generated | Fixed demo password instead of a random one |
| `JOBS_ENABLED` | no | `false` | Run the maintenance job scheduler |
| `OVERDUE_JOB_INTERVAL_MS` | no | `3600000` | Maintenance job interval |
| `LOG_LEVEL` | no | `info` | Pino level |
| `LOG_PRETTY` | no | `true` in dev | Human-readable logs |
| `SWAGGER_ENABLED` | no | `true` outside production | Serve `/api-docs` |
| `DEAL_CURRENCY` | no | `USD` | Currency label for monetary values |
| `SHUTDOWN_TIMEOUT_MS` | no | `10000` | Graceful shutdown budget |
| `APP_NAME` / `APP_VERSION` | no | `CRM Sales Management API` / `1.0.0` | Reported by `/health` and Swagger |

**Startup validation**: with `NODE_ENV=production` the app refuses to start unless both JWT
secrets are present, at least 32 characters long, different from each other and not
placeholder strings. Any other invalid value fails fast with a readable message.

---

## 10. Creating the first Admin

Public registration **always** creates a `SALES_EXECUTIVE` — nobody can self-promote to
administrator. The first administrator is created with a dedicated bootstrap command that
reads its credentials from environment variables (never hardcoded):

```bash
# in .env
INITIAL_ADMIN_NAME=CRM Administrator
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=<generate a strong one>

npm run bootstrap-admin
```

Expected output:

```
Administrator created: admin@example.com (id=65f0...)
```

The script:

* refuses to run when any `INITIAL_ADMIN_*` variable is missing;
* refuses well-known/default passwords (`password`, `admin123`, `changeme`, …);
* enforces ≥ 12 characters with lower + upper + digit + symbol;
* is **idempotent** — re-running reports `already exists - nothing to do`;
* refuses to overwrite an existing non-admin account with the same email.

Afterwards an administrator can create further accounts with `POST /api/v1/users`.

---

## 11. Running the application

```bash
npm run dev     # nodemon, development
npm start       # plain node, production mode
npm run lint    # ESLint
```

| Script | Description |
| --- | --- |
| `npm run dev` | Development server with auto reload |
| `npm start` | Production server |
| `npm test` | Full test suite (unit + integration) |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Coverage report (`coverage/`) |
| `npm run seed` | Create the admin + demo data |
| `npm run bootstrap-admin` | Create/verify the first administrator |
| `npm run free-port` | Report (and with `--kill` stop) whatever holds `PORT` — fixes `EADDRINUSE` crash-loops |
| `npm run spec:audit` | Live quality report of the served OpenAPI document |
| `npm run smoke -- <url> <email> <password>` | End-to-end smoke check against a running server |
| `npm run lint` / `npm run lint:fix` | Lint |

### Health check

```bash
curl http://localhost:5000/api/v1/health
```

```json
{
  "success": true,
  "message": "CRM Sales Management API is healthy",
  "data": {
    "status": "ok",
    "service": "CRM Sales Management API",
    "version": "1.0.0",
    "environment": "development",
    "uptimeSeconds": 1234,
    "database": { "connected": true, "state": "connected", "transactionsSupported": true },
    "responseTimeMs": 2,
    "timestamp": "2026-01-01T00:00:00.000Z"
  }
}
```

It returns `503` with `"status": "degraded"` when the database is unreachable — never
credentials, host names or driver internals.

---

## 12. Authentication flow

```
POST /api/v1/auth/login
        │
        ├─► { accessToken (15m, stateless), refreshToken (7d, single use) }
        │
        ├─► refreshToken is ALSO set as an HttpOnly cookie
        │   (Path=/api/v1/auth; Secure; SameSite=Strict)
        │
        ├─► only sha256(refreshToken) is stored in `refreshtokens`
        │
Client sends:  Authorization: Bearer <accessToken>
        │
POST /api/v1/auth/refresh   { refreshToken }
        ├─► verifies signature + type + expiry
        ├─► revokes the presented token (reason: rotated)
        ├─► issues a NEW token in the same "family"
        └─► presenting an already rotated token revokes the WHOLE family
            (reuse detection) and returns 401
        │
POST /api/v1/auth/logout
        └─► revokes the presented refresh session (or all sessions)
```

### Browser clients vs. API clients

* **Browser / SPA** — the refresh token is delivered as a cookie with
  `HttpOnly` (invisible to JavaScript, so an XSS bug cannot steal it),
  `Secure` (HTTPS only) and `SameSite=Strict` (never sent cross-site).
  The cookie path is restricted to `/api/v1/auth`.
  If you must deploy a cross-site frontend (different site) you need
  `SameSite=None; Secure` **plus** CSRF protection (double-submit token or the
  `SameSite` cookie + `Origin` check) — this API does not ship CSRF tokens, so
  prefer a same-site deployment.
* **API clients (Postman, curl, mobile)** — send
  `Authorization: Bearer <accessToken>`; the refresh token can be passed in the
  JSON body or the cookie.

### CORS behaviour

CORS is implemented with a dynamic allowlist (`src/app.js`) that follows three rules:

1. **Same-origin is always allowed.** The API serves its own Swagger UI at `/api-docs`,
   and the browser sends `Origin: http://localhost:5000` for those XHR calls — without
   this rule the docs page would be unable to call the API it documents. Same-origin
   traffic is not a cross-site threat, so it is matched on the `Host` header (proxy-safe,
   no scheme guessing).
2. **Configured origins** (`CORS_ORIGIN`) are reflected back with
   `Access-Control-Allow-Credentials: true`. The concrete origin is echoed, never `*`,
   because `*` is illegal together with credentials.
3. **Any other origin gets no CORS headers — and never an error.** A rejected origin
   still receives the normal API response; the *browser* is what blocks it. A
   cross-origin policy violation is not a server fault, so it must not become a `500`
   (there is a regression test for this).

Clients without an `Origin` header (curl, Postman, server-to-server, health probes) are
never affected.

### About logout and stateless access tokens

Access tokens are **stateless JWTs**: they cannot be revoked server-side. Logging out
revokes the refresh session, so no *new* access token can be minted, but an access token
that was already issued stays usable until it expires (default 15 minutes). Three options if
you need immediate revocation:

1. shorten `JWT_ACCESS_EXPIRES_IN` (e.g. `5m`);
2. keep a short-lived `tokenVersion` claim on the user and reject tokens whose version is
   older than the user's (not implemented here — the account `isActive` check already gives
   you the common case of immediate lockout on deactivation);
3. move to opaque access tokens with a server-side store (heavier).

---

## 13. Roles and permissions

| Capability | ADMIN | SALES_MANAGER | SALES_EXECUTIVE |
| --- | :---: | :---: | :---: |
| See all records | ✅ | own team + self | own records only |
| Create a lead | ✅ | ✅ | ✅ (auto-assigned to self) |
| Assign a lead to someone else | ✅ (any active sales user) | own team | ❌ |
| Claim an unassigned lead | ✅ | ✅ | ✅ (assigns to self) |
| Delete a lead | ✅ | ✅ (own book) | ❌ |
| Convert a lead | ✅ | ✅ | ✅ (own lead) |
| Create a customer manually | ✅ | ✅ | ❌ |
| Delete a customer | ✅ | ✅ | ❌ |
| Create/update a deal | ✅ | ✅ | ✅ (own deal) |
| Move a deal stage | ✅ | ✅ | ✅ (own deal) |
| Reopen a closed deal | ✅ | ✅ | ❌ |
| Delete a deal | ✅ | ✅ | ❌ |
| Complete an activity | ✅ | ✅ | ✅ (own) |
| Delete an activity | ✅ | ✅ | ✅ (own, created by them) |
| Read a user timeline | ✅ | ✅ | ❌ |
| Create / edit / deactivate users | ✅ | ❌ | ❌ |
| List users | ✅ | ✅ (never sees ADMIN accounts) | ❌ |
| Dashboard / pipeline | ✅ (system-wide) | team scoped | own records |
| Team performance report | ✅ (optionally `?team=<id>`) | own team | ❌ (403) |

**Scoping rules**

* `SALES_MANAGER` scope = records assigned to the manager **or** to a member of their
  `Team` document (plus leads they created, and the shared pool of unassigned leads).
* `SALES_EXECUTIVE` scope = records whose `assignedTo` is themselves (+ unassigned leads
  they may claim).
* A record outside the caller's scope returns **404**, not 403, so the API cannot be used to
  probe for the existence of other people's data.

---

## 14. API endpoint summary

Base URL: `/api/v1`. All routes except `GET /health`, `POST /auth/register` and
`POST /auth/login` require `Authorization: Bearer <accessToken>`.

### Authentication
| Method | Endpoint | Roles | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | public | Create a SALES_EXECUTIVE account |
| POST | `/auth/login` | public | Access + refresh token pair |
| POST | `/auth/refresh` | public | Rotate the refresh token |
| POST | `/auth/logout` | any | Revoke the refresh session |
| GET | `/auth/me` | any | Current user profile |
| PATCH | `/auth/password` | any | Change own password (revokes all sessions) |

### Users
| Method | Endpoint | Roles |
| --- | --- | --- |
| GET | `/users/me` | any |
| GET | `/users` | ADMIN, SALES_MANAGER |
| POST | `/users` | ADMIN |
| GET | `/users/assignable` | ADMIN, SALES_MANAGER |
| GET | `/users/:id` | ADMIN, SALES_MANAGER |
| PATCH | `/users/:id` | ADMIN |
| PATCH | `/users/:id/status` | ADMIN |
| DELETE | `/users/:id` | ADMIN |

### Leads
| Method | Endpoint | Roles |
| --- | --- | --- |
| POST | `/leads` | any |
| GET | `/leads` | any (scoped) |
| GET | `/leads/:id` | any (scoped) |
| PATCH | `/leads/:id` | any (scoped) |
| PATCH | `/leads/:id/status` | any (scoped) |
| PATCH | `/leads/:id/assignment` | any (scoped + role rules) |
| DELETE | `/leads/:id` | ADMIN, SALES_MANAGER |
| POST | `/leads/:id/convert` | any (scoped) |
| GET | `/leads/:id/timeline` | any (scoped) |

### Customers
| Method | Endpoint | Roles |
| --- | --- | --- |
| POST | `/customers` | ADMIN, SALES_MANAGER |
| GET | `/customers` | any (scoped) |
| GET | `/customers/:id` | any (scoped) |
| PATCH | `/customers/:id` | any (scoped) |
| PATCH | `/customers/:id/assignment` | ADMIN, SALES_MANAGER |
| DELETE | `/customers/:id` | ADMIN, SALES_MANAGER |
| GET | `/customers/:id/deals` | any (scoped) |
| GET | `/customers/:id/activities` | any (scoped) |
| GET | `/customers/:id/timeline` | any (scoped) |

### Deals
| Method | Endpoint | Roles |
| --- | --- | --- |
| POST | `/deals` | any (scoped) |
| GET | `/deals` | any (scoped) |
| GET | `/deals/:id` | any (scoped) |
| PATCH | `/deals/:id` | any (scoped) |
| PATCH | `/deals/:id/stage` | any (scoped) |
| POST | `/deals/:id/reopen` | ADMIN, SALES_MANAGER |
| PATCH | `/deals/:id/assignment` | any (scoped + role rules) |
| DELETE | `/deals/:id` | ADMIN, SALES_MANAGER |
| GET | `/deals/:id/activities` | any (scoped) |
| GET | `/deals/:id/timeline` | any (scoped) |

### Activities & timeline
| Method | Endpoint | Roles |
| --- | --- | --- |
| POST | `/activities` | any (related entity must be visible) |
| GET | `/activities` | any (scoped) |
| GET | `/activities/:id` | any (scoped) |
| PATCH | `/activities/:id` | any (scoped) |
| PATCH | `/activities/:id/complete` | any (own activity for executives) |
| DELETE | `/activities/:id` | any (own, created by them) |
| GET | `/timeline/:entityType/:entityId` | any (entity must be visible) |

### Analytics & system
| Method | Endpoint | Roles |
| --- | --- | --- |
| GET | `/analytics/dashboard` | any (scoped) |
| GET | `/analytics/pipeline` | any (scoped) |
| GET | `/analytics/team-performance` | ADMIN, SALES_MANAGER |
| GET | `/analytics/lead-sources` | any (scoped) |
| GET | `/health` | public |

### Query parameters for list endpoints

`page`, `limit` (default 10, max 100), `sortBy` (allow-listed only), `sortOrder`
(`asc`/`desc`), `search`, `dateFrom`, `dateTo` plus module filters
(`status`, `priority`, `source`, `assignedTo`, `createdBy`, `stage`, `customer`,
`minValue`, `maxValue`, `closingFrom`, `closingTo`, `type`, `dueFrom`, `dueTo`,
`relatedEntityType`, `relatedEntityId`, `role`, `isActive`, `origin`, …).

### Response envelopes

```jsonc
// success
{
  "success": true,
  "message": "Leads fetched successfully",
  "data": [ /* … */ ],
  "pagination": {
    "page": 1, "limit": 10, "totalRecords": 42, "totalPages": 5,
    "hasNextPage": true, "hasPreviousPage": false
  }
}

// error
{
  "success": false,
  "message": "Invalid lead status transition from NEW to CONVERTED",
  "code": "BUSINESS_RULE_VIOLATION",
  "errors": [{ "field": "status", "message": "Not allowed" }]
}
```

Status codes: `200` OK · `201` Created · `400` validation · `401` unauthenticated ·
`403` forbidden · `404` not found (also used for "exists but not visible") · `409`
conflict/duplicate · `422` business-rule violation · `429` rate limited ·
`500` unexpected error · `503` service unavailable (e.g. transactions unsupported).

### Example: create → qualify → convert

```bash
BASE=http://localhost:5000/api/v1

# 1. login
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"<your password>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')

# 2. create a lead
LEAD=$(curl -s -X POST $BASE/leads -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Acme Corporation","email":"buyer@acme.example","company":"Acme","source":"WEBSITE","priority":"HIGH"}')
LEAD_ID=$(echo "$LEAD" | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.id')

# 3. qualify it
curl -s -X PATCH $BASE/leads/$LEAD_ID/status -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"QUALIFIED"}'

# 4. convert it into a customer + deal (single transaction)
curl -s -X POST $BASE/leads/$LEAD_ID/convert -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"dealName":"Acme - Platform Licence","dealValue":25000,"probability":60,"expectedClosingDate":"2027-06-30T00:00:00.000Z","stage":"PROPOSAL"}'
```

Conversion response (abridged):

```json
{
  "success": true,
  "message": "Lead converted successfully",
  "data": {
    "lead":     { "id": "…", "status": "CONVERTED", "convertedCustomer": "…", "convertedDeal": "…" },
    "customer": { "id": "…", "name": "Acme Corporation", "origin": "CONVERTED", "originalLead": "…" },
    "deal":     { "id": "…", "dealValue": 25000, "probability": 60, "expectedRevenue": 15000, "stage": "PROPOSAL" }
  }
}
```

---

## 15. Swagger documentation

With `SWAGGER_ENABLED=true` (the default outside production):

* **Swagger UI** — <http://localhost:5000/api-docs>
* **Raw OpenAPI JSON** — <http://localhost:5000/api-docs.json>

The specification is generated from the `@openapi` JSDoc blocks that live in
`src/routes/*.js`, so the documentation always matches the routes that actually exist.
It includes the bearer security scheme, per-operation role notes, path/query parameters,
request bodies, success and error responses, and shared component schemas.

Every one of the 54 operations carries an explicit **`operationId`** (`listLeads`,
`convertLead`, `getDashboard`, …). This is not cosmetic:

* it is required to generate typed SDKs and clients from the document;
* it keeps Swagger UI deep links (`#/operations/<tag>/<operationId>`) stable and shareable;
* Swagger UI encodes whitespace in those URL segments as `_` and logs
  *"Deprecated: escaping deep link whitespace with `_` is unsupported"* — so operation IDs
  and tag names are asserted to be whitespace-free and underscore-free.

`npm run lint` and `tests/unit/openapi.test.js` enforce this, and `npm run spec:audit`
prints a live quality report of the served document (operations without an `operationId`,
missing summaries/responses, duplicate IDs, undocumented error statuses).

### Troubleshooting

**`EADDRINUSE` / the server keeps crash-looping under nodemon** — something else is
already listening on `PORT`. The startup failure now prints the exact remedy:

```bash
npm run free-port            # report the process holding the port
npm run free-port -- --kill  # stop it (SIGTERM first, so it shuts down cleanly)
PORT=5001 npm run dev        # or just move to another port
```

**"Try it out" returns `400` on an endpoint** — a `400` always means the payload itself is
malformed, never that your credentials are wrong (that is a `401`). The response body names
every problem:

```json
{
  "success": false,
  "message": "Request validation failed",
  "code": "VALIDATION_ERROR",
  "errors": [
    { "field": "email", "message": "email is required", "code": "invalid_type" },
    { "field": "body", "message": "Unexpected field(s) not allowed: \"role\"", "code": "unrecognized_keys" }
  ]
}
```

Make sure you are sending `Content-Type: application/json` and only the fields the
operation's schema declares — the request schemas are strict, so an extra field is
rejected. Common causes: an empty or malformed field, or a `form-encoded` body.

---

## 16. Postman collection

```
postman/CRM-Sales-Management.postman_collection.json
postman/environment.development.json
```

Import steps:

1. Postman → **Import** → select `postman/CRM-Sales-Management.postman_collection.json`.
2. **Import** `postman/environment.development.json` (contains `baseUrl`, `accessToken`,
   `refreshToken`, `adminEmail`, `execEmail` … — **no real credentials**).
3. Select the *CRM Sales Management - Development* environment.
4. Fill in `adminPassword` (or `execPassword`) with the password **you** configured.
5. Run **Auth → Login (admin)** — test scripts store `accessToken` / `refreshToken`
   in the collection variables automatically; every other request already uses them.
6. Work top-down: `Create lead` → `Change lead status (QUALIFIED)` →
   `Convert lead to customer + deal` → `Create activity` → `Dashboard`.

Demo passwords come from `npm run seed` output (or set `SEED_DEMO_PASSWORD`).

---

## 17. Business rules

### Lead status transitions

```
NEW ──────► CONTACTED ──────► QUALIFIED ──────► CONVERTED (terminal, conversion endpoint only)
 │               │                │
 │               ├──► UNQUALIFIED ┤
 │               └──► LOST ◄─────┘
 └──► UNQUALIFIED / LOST

LOST  ──► CONTACTED | QUALIFIED        (a lost lead can be reworked)
UNQUALIFIED ──► CONTACTED | QUALIFIED | LOST
```

* `CONVERTED` is **terminal** and can only be reached through `POST /leads/:id/convert`.
* An invalid transition returns `422` with the list of allowed next states.
* A converted lead cannot be edited, reassigned or deleted.

### Lead assignment

* Target must **exist**, be **active**, and hold `SALES_MANAGER` or `SALES_EXECUTIVE`.
  Administrators can never be assigned.
* `ADMIN` → any active sales user. `SALES_MANAGER` → self or their own team.
  `SALES_EXECUTIVE` → self only.
* `assignedTo` cannot be changed through `PATCH /leads/:id` (the schema rejects it).
* Every change writes a `LEAD_ASSIGNED` / `LEAD_REASSIGNED` timeline entry with the
  previous and the new assignee.

### Lead conversion (atomic)

1. The lead must be `QUALIFIED` and not already converted.
2. All validation happens **before** any write.
3. Inside a MongoDB **transaction**:
   * an atomic conditional update claims the lead
     (`findOneAndUpdate({_id, status:'QUALIFIED', convertedCustomer:null})`),
   * the Customer is created with `origin = CONVERTED` and `originalLead = lead`,
   * the Deal is created referencing **both** the customer and the lead, inheriting the
     lead's assignee (or an explicitly validated one),
   * the lead is updated to `CONVERTED` with `convertedCustomer` / `convertedDeal`,
   * four timeline entries are written **inside the same transaction**.
4. Concurrency: the conditional update guarantees exactly one winner; the **unique partial
   index on `customers.originalLead`** guarantees at the storage layer that a lead can never
   produce two customers. Losers receive `409 Conflict`.
5. If the deployment does not support transactions (standalone `mongod`), the endpoint
   returns **503** rather than pretending to be atomic.
6. Any failure aborts the transaction: no orphaned customer, no orphaned deal, no audit
   entry.

### Customers

* A customer created through `POST /customers` has `origin = MANUAL` and
  `originalLead = null`; only `ADMIN` and `SALES_MANAGER` may do this. A converted customer
  always has `origin = CONVERTED` and a non-null `originalLead`.
* A customer that still owns **deals** or **activities** cannot be deleted (`422`).
  Deleting a converted customer also unlinks the `convertedCustomer` pointer on the lead so
  the data stays consistent.

### Deals and money

| Rule | Behaviour |
| --- | --- |
| `dealValue` | must be `> 0`, max `999,999,999.99` |
| `probability` | integer between `0` and `100` |
| `expectedRevenue` | **always** `dealValue × probability / 100`, computed on the server from integer cents, rounded half-up to 2 decimals. A client supplying it is rejected (`400`). |
| Currency | a single currency for the whole system (`DEAL_CURRENCY`, default `USD`); amounts are stored as `Number` with 2-decimal precision |
| `expectedClosingDate` | required; must be in the **future** for an active stage |
| `WON` | probability normalised to 100, `closedAt` set, `lostReason` cleared; deal value must be valid |
| `LOST` | `lostReason` is **required** |
| `closedAt` | maintained by the server, never by the client |
| Closed → open | **forbidden** through `PATCH /deals/:id/stage` (`422`) |
| Reopen | only through `POST /deals/:id/reopen` (ADMIN / SALES_MANAGER, reason required) — clears `closedAt` / `lostReason`, logs `DEAL_REOPENED` |
| Closed deals | cannot be modified or reassigned |

Stage graph:

```
QUALIFICATION ─► DISCOVERY ─► PROPOSAL ─► NEGOTIATION ─► WON
      │               │            │              │        (terminal)
      └───────────────┴────────────┴──────────────┴──► LOST (terminal, lostReason required)
```

### Activities

* `relatedEntityType` + `relatedEntityId` must reference an **existing** entity that the
  caller is allowed to see (otherwise `404`, which avoids existence disclosure).
* `CALL`, `EMAIL`, `MEETING`, `DEMO`, `FOLLOW_UP`, `REMINDER` **require** a `dueDate`.
  `NOTE` does not.
* **OVERDUE is derived at read time**: an activity is overdue when it is not `COMPLETED`
  and its `dueDate` is in the past. Every list response carries both `status` (stored) and
  `derivedStatus` (effective), and the `status` query filter matches the *derived* value:
  * `status=OVERDUE` → not completed **and** `dueDate < now`
  * `status=PENDING` → not completed **and** (`dueDate` is null **or** `dueDate >= now`)
  * `status=COMPLETED` → completed
* A **completed activity is never reported as overdue again**; `completedAt` is set and
  cannot be un-set. Completing twice returns `422`.
* The optional maintenance job (`JOBS_ENABLED=true`) only *persists* the OVERDUE flag so
  that ad-hoc queries and BI tools reading `activities.status` stay accurate. **Reporting
  never depends on it.**
* Sales Executives may only complete activities assigned to them, and only delete
  activities they created.

### Timeline / audit

* **Append-only**: the API exposes only a read endpoint — there is no update or delete
  route for timeline entries anywhere.
* Recorded events include lead created/assigned/reassigned/status changed/priority changed,
  customer created, lead converted, deal created/assigned/stage changed/won/lost/reopened,
  activity created/completed/updated/deleted, and user created/activated/deactivated.
* `previousValue` / `newValue` are reduced through a **field allowlist**
  (`TIMELINE_SAFE_FIELDS`) and metadata keys matching `password|token|secret|hash` are
  dropped, so secrets can never enter the audit trail.
* Reading a timeline re-checks access to the referenced record.

### Analytics definitions

| Metric | Definition |
| --- | --- |
| Lead conversion rate | `converted leads ÷ eligible leads × 100`, where an **eligible** lead is one that reached at least the QUALIFIED stage (currently `QUALIFIED`, `CONVERTED`, `UNQUALIFIED` or `LOST`). A zero denominator yields `0`. |
| Deal win rate | `won ÷ (won + lost) × 100`, zero denominator yields `0`. |
| Won revenue | Sum of `dealValue` for `stage = WON` — **actual** revenue. |
| Open expected revenue | Sum of `expectedRevenue` for the four open stages — **forecast**, never mixed with won revenue. |
| Weighted pipeline | Sum of `expectedRevenue` over all deals. |
| Dashboard scope | ADMIN: system-wide · SALES_MANAGER: own team + self · SALES_EXECUTIVE: own records only. |
| Team performance | Per user: assigned leads, converted leads, qualified leads, open/won/lost deals, won revenue, open expected revenue, pending/completed activities, plus derived rates. |

---

## 18. Indexing and performance decisions

Indexes are declared on the schemas and built automatically outside production
(`autoIndex`). Each one exists because of a concrete access pattern:

| Index | Query it serves |
| --- | --- |
| `users { email }` unique | login and email-collision checks |
| `users { role, isActive }` | assignable-user picker, active-admin guard |
| `leads { status, createdAt }` | default lead list and dashboard grouping |
| `leads { assignedTo, status, createdAt }` | executive/manager scoped lead lists |
| `leads { status, priority, source, createdAt }` | combined status+priority+source filters |
| `leads { createdBy, createdAt }` | "created by me" scoping |
| `leads text { name, company, email }` | free-text lookup |
| `customers` unique partial `{ originalLead }` | **database-level guarantee** that a lead converts once, even under concurrent requests |
| `customers { assignedTo, status, createdAt }` | scoped customer list |
| `deals { stage, expectedClosingDate }` | pipeline report and open-deal forecast |
| `deals { customer, createdAt }` | `GET /customers/:id/deals` |
| `deals { assignedTo, stage, createdAt }` | scoped deal list + team performance |
| `activities { assignedTo, status, dueDate }` | "my tasks", pending and overdue dashboards |
| `activities { relatedEntityType, relatedEntityId, createdAt }` | activities of a lead / customer / deal |
| `timelines { entityType, entityId, createdAt }` | the exact access pattern of `GET /timeline/:entityType/:entityId` |
| `refreshtokens` TTL `{ expiresAt }` | automatic cleanup of expired sessions |

Deliberately **not** indexed: low-cardinality fields that are always combined with a
high-cardinality one (for example a standalone `users.isActive`), and `text` indexes for
fields that are only ever searched through escaped literal regexes (`search=` uses
case-insensitive literal matching rather than `$text` so partial words work).

Additional performance choices:

* list endpoints run **one** `countDocuments` and **one** `find` (in parallel via
  `Promise.all`) — never N+1;
* analytics uses aggregation pipelines with `$lookup` + `$group` instead of pulling
  documents into Node;
* only fixed projections are selected for populated references;
* `sanitizeFilter` is **off** because it would also rewrite legitimate internal operator
  queries — NoSQL injection is instead defended by strict Zod schemas (typed, allow-listed
  query values), the Express 5 "simple" query parser (so `?email[$ne]=` stays a literal
  key) and allow-listed filter construction in `src/utils/query.js`.

---

## 19. Running the tests

```bash
npm test                  # everything (unit + integration)
npm run test:unit
npm run test:integration
npm run test:coverage
```

The suite runs against **`mongodb-memory-server` in replica-set mode**, started by
`tests/setup/globalSetup.js`. A replica set is required because lead conversion uses MongoDB
transactions. Each test file gets its **own database** (`crm_sales_test_<hash>`) so files
can run in parallel without interfering, and the setup refuses to delete anything if the
connected database name does not look like a test database.

> If a `MONGODB_URI` pointing at a real cluster exists in your shell, the suite prints a
> notice and **overrides it** with the in-memory server — it never touches your real data.

### Coverage of the specification

| Area | Examples |
| --- | --- |
| Authentication | registration, login, case-insensitive email, generic failure message, inactive account, malformed/expired/forged token, refresh rotation, reuse detection, logout revocation, all-device logout, password change, no `passwordHash` in responses |
| Authorization | admin-only operations, manager team restrictions, executive ownership restrictions, invisible records → 404, invalid assignment targets, role elevation attempts, manager cannot read ADMIN accounts, last-admin protection |
| Leads | CRUD, validation, mass-assignment rejection, search (literal regex), filtering, sorting allow-list, pagination, status transitions, assignment/reassignment, unassigned pool claiming, timeline audit entries |
| Conversion | qualified conversion, relationship integrity, repeated conversion → 409, **concurrent conversion → exactly one 201**, **transaction rollback on failure → no orphans**, non-QUALIFIED → 422, unique index enforcement |
| Customers & deals | CRUD, deletion guards, expected-revenue calculation, value/probability validation, WON/LOST rules, closed-deal transition restrictions, reopen flow, ownership restrictions, deal filters |
| Activities & analytics | creation, completion, `completedAt`, derived OVERDUE (query and job), timeline generation, dashboard metrics, pipeline aggregation, team-performance authorization |
| Unit | money rounding, regex escaping, allow-list picking, pagination/sort/date parsing, activity status derivation, conversion rate, error normalisation, Zod message humanisation, URI sanitisation |
| OpenAPI | unique `operationId` per operation, whitespace/underscore-free operation IDs and tags, every operation has a summary and responses, and every documented endpoint is probed on the real app to prove it exists (a phantom endpoint would answer `404`, not `401`) |
| Platform | CORS allow-list / same-origin / preflight / unknown-origin-never-500, Helmet headers, structured 404, malformed JSON, oversized payload, request id, no stack-trace leakage |

---

## 20. Seed data

```bash
npm run seed
```

What it creates:

* the administrator from `INITIAL_ADMIN_*` (or skips if it already exists);
* a demo team and three sample users (1 manager, 2 executives);
* 6 sample leads across all sources / statuses / priorities;
* one of those leads is converted through the **real transactional conversion flow**,
  producing a genuine `lead → customer → deal` chain;
* 2 manual customers and 4 deals (open, won, lost) with consistent `expectedRevenue`;
* 5 activities including one **overdue** and one **completed**.

Safety properties:

* passwords are **generated at run time** (or taken from `SEED_DEMO_PASSWORD`) and printed
  once — nothing is hardcoded in the repository;
* the script refuses to run when `NODE_ENV=production` unless `SEED_FORCE=true`;
* it is idempotent — re-running never duplicates users or records;
* demo emails use the reserved `.test` TLD (RFC 2606) so they can never collide with real
  addresses.

Sample logins (passwords printed by the command):

| Role | Email |
| --- | --- |
| Administrator | the `INITIAL_ADMIN_EMAIL` you configured |
| Sales Manager | `manager@demo.crm` |
| Sales Executive | `eve@demo.crm`, `eli@demo.crm` |

To wipe and re-create the demo dataset: `SEED_FORCE=true npm run seed` (development only).

---

## 21. Deployment

The app targets any Node.js host (Render, Railway, Fly.io, Heroku, a VPS, Cloud Run, ECS…).

### 1. Provision the database

Use **MongoDB Atlas** (any paid tier; M0 also supports transactions) or a self-hosted
replica set. Copy the connection string.

### 2. Configure the environment (see section 9)

Minimum for production:

```dotenv
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/crm_sales_db?retryWrites=true&w=majority
JWT_ACCESS_SECRET=<48+ random bytes, hex>
JWT_REFRESH_SECRET=<a different 48+ random bytes, hex>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=https://your-frontend.example.com
TRUST_PROXY=true
RATE_LIMIT_MAX_REQUESTS=300
RATE_LIMIT_ENABLED=true
REFRESH_COOKIE_SECURE=true
LOG_LEVEL=info
SWAGGER_ENABLED=false
```

Secrets must come from the platform's secret manager (Render/Railway "Environment",
AWS Secrets Manager, Vault) — never from a committed file.

### 3. Build & run

```bash
npm ci --omit=dev
npm start

# one-off, first administrator
INITIAL_ADMIN_NAME=… INITIAL_ADMIN_EMAIL=… INITIAL_ADMIN_PASSWORD=… npm run bootstrap-admin
```

### 4. Indexes in production

`autoIndex` is disabled in production to avoid a slow start. Build the indexes once:

```js
// node -e "import('./src/models/index.js').then(async m => { await Promise.all(Object.values(m).map(M => M.syncIndexes())); process.exit(0) })"
```

or simply run `NODE_ENV=development` once against the production database in a controlled
window. Mongoose keeps in sync on subsequent model compilation with `autoIndex: false`.

### 5. Post-deployment verification checklist

- [ ] `GET /api/v1/health` returns `200` with `database.connected: true` and
      `transactionsSupported: true` (if `false`, conversion will return `503`).
- [ ] `npm run bootstrap-admin` created the administrator.
- [ ] `POST /api/v1/auth/login` with the admin credentials returns `200`.
- [ ] `GET /api/v1/analytics/dashboard` returns real numbers.
- [ ] Create a lead → qualify → convert; verify the customer and deal are created.
- [ ] `GET /api/v1/leads` with a **Sales Executive** token only returns their own records.
- [ ] Confirm the platform's health check points at `/api/v1/health`.
- [ ] Confirm `TRUST_PROXY=true` if behind a proxy, so rate limiting sees real client IPs.
- [ ] Confirm `CORS_ORIGIN` contains exactly your production front-end origin.
- [ ] Confirm logs are collected and contain no secrets (redaction is on by default).
- [ ] Confirm `SIGTERM` triggers a graceful shutdown (no dropped connections).

**No deployment has been performed as part of this work** — no hosting credentials were
available, so no public URL is claimed.

---

## 22. Security notes

| Concern | Implementation |
| --- | --- |
| Password hashing | bcrypt with cost 12 (4 in tests); `passwordHash` is `select: false` and stripped from every `toJSON` |
| Token storage | refresh tokens are stored only as a SHA-256 hash (high-entropy input, so a fast hash is appropriate); family revocation on reuse |
| Brute force | per-IP + per-email rate limit on credential endpoints, plus an in-memory account lockout after repeated failures |
| User enumeration | login always answers `Invalid email or password`; out-of-scope records return `404` |
| Validation errors | central `humanizeZodIssues` turns Zod internals into actionable messages (`email is required`, `password must be at most 128 characters`, `Unexpected field(s) not allowed: "role"`), one message per field |
| Mass assignment | every write path uses a strict Zod schema (unknown keys → `400`) plus explicit allow-lists in services |
| NoSQL injection | Express 5 simple query parser, strict typed Zod query schemas, allow-listed filter construction, `$`-operator stripping helpers |
| Unsafe sorting | `sortBy` is validated against a per-collection allow-list; arbitrary field names are rejected |
| ReDoS | search keywords are escaped into literal regular expressions |
| Security headers | Helmet, with a CSP tailored for Swagger UI |
| CORS | dynamic allowlist + same-origin auto-allow; an unknown origin gets no CORS headers instead of a 500 |
| Payload size | `express.json({ limit: '1mb' })` |
| Secret logging | Pino redaction of `authorization`, `cookie`, `password*`, `*token*`, `*secret*`, `*hash*`; connection URIs logged with the password replaced by `***` |
| Error responses | stack traces, driver messages and internal details are hidden; unexpected errors return a generic `Internal server error` in production |
| Audit integrity | timeline entries are append-only and reduced through a safe-field allow-list |
| Graceful shutdown | `SIGTERM`/`SIGINT` stop accepting connections, drain requests, close Mongoose, then exit |

---

## 23. Assumptions and known limitations

**Documented assumptions**

1. **Team model** — a "team" is a `Team` document whose `members` are the manager's
   reports. An empty/absent team means the manager's book is only their own records.
   `User.team` links a manager to their team.
2. **Unassigned lead pool** — leads without an assignee are visible to every sales user so
   they can be claimed. This is what makes "claim" work for executives.
3. **Administrators do not carry a sales book** — they cannot be assignees and do not appear
   in team reports.
4. **Manual customers** — created only by ADMIN / SALES_MANAGER with `origin = MANUAL`.
5. **Closing date rules** — required and in the future for *active* stages; a closed deal may
   keep a past date.
6. **Single currency** — all amounts use `DEAL_CURRENCY` (default `USD`) with 2-decimal
   precision; `expectedRevenue` is rounded half-up from integer cents.
7. **Conversion rate denominator** — eligible = qualified + converted + unqualified + lost.
8. **Overdue status** — derived on read; the optional job only persists the flag.

**Known limitations**

* Access tokens cannot be revoked before they expire (see
  [section 12](#about-logout-and-stateless-access-tokens)). Deactivating an account *does*
  take effect immediately.
* Rate limiting and the account lockout use an **in-memory** store, so they are per process.
  For a multi-instance deployment, swap in a shared store
  (`rate-limit-redis` / `rate-limit-mongo`).
* Public registration is always enabled and always creates a `SALES_EXECUTIVE`. If you do not
  want self-service sign-up, remove the `/auth/register` route (or gate it behind an
  `ALLOW_PUBLIC_REGISTRATION` flag of your own).
* Emails are **not** globally unique on leads or customers — the same person may legitimately
  appear as several leads. Only `users.email` is unique.
* There is no file upload, email notification, or password-reset e-mail flow.
* No caching layer; every read hits MongoDB. Aggregation reports are intentionally
  uncached so that numbers are always fresh.
* `findOneAndUpdate` on the lead during conversion is the concurrency gate; the unique
  index on `customers.originalLead` is the second line of defence. Both are exercised by
  tests (`conversion.test.js`).

---

## License

MIT