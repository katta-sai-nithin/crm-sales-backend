# Architecture notes

## 1. Layering

```
HTTP request
   │
   ├─ helmet / cors / body parsers / request-id / logger / rate limiter      (app.js)
   │
   ├─ route definitions                                                    (routes/*.js)
   │     ├─ authenticate          → resolves req.user from the access token
   │     ├─ authorize(...roles)   → coarse role gate
   │     └─ validate(zodSchema)   → body / query / params, strict
   │
   ├─ controller                                                          (controllers/*.js)
   │     └─ thin: call a service, shape the response envelope
   │
   ├─ service                                                             (services/*.js)
   │     ├─ business rules and authorization decisions
   │     ├─ builds Mongo filters from allow-lists
   │     ├─ writes timeline entries (optionally inside a transaction)
   │
   └─ model                                                               (models/*.js)
         └─ schema validation, computed fields, indexes
```

Rule of thumb enforced by review: **no business logic lives in a route or controller**, and
**no request object is ever passed straight into a Mongo query**.

## 2. Authorization model

Two layers:

1. **Route level** — `authorize(ROLES.ADMIN, ...)` for capabilities that no record can
   override (user management, deletions, reopen, team reports).
2. **Record level** — `buildScopeFilter(actor, ScopeType.X)` in
   `services/accessScope.service.js` builds the Mongo filter that limits both reads and
   writes to the caller's book of business.

| Role | Scope |
| --- | --- |
| ADMIN | everything |
| SALES_MANAGER | records assigned to self or to a member of their `Team`; leads they created; the shared pool of unassigned leads |
| SALES_EXECUTIVE | records assigned to self; the shared pool of unassigned leads (claimable only by assigning to self) |

Assignment targets are validated by `UserService.assertAssignable`, a single shared rule
used by leads, customers, deals and activities.

## 3. Lead conversion — atomicity design

MongoDB transactions require a replica set or a sharded cluster. The application
*detects* support (`supportsTransactions()` runs a `hello` command once) and refuses the
conversion with `503` when it is unavailable, instead of silently degrading to
non-atomic writes.

Inside the transaction, in order:

1. **Conditional atomic claim** — `Lead.findOneAndUpdate({_id, status:'QUALIFIED', convertedCustomer:null}, ...)`.
   This is the concurrency gate: under parallel requests exactly one transaction can match
   the predicate. The losers abort before writing anything, which yields a clean `409`
   rather than a confusing duplicate-key error.
2. `Customer.create(...)` with `origin = CONVERTED` and `originalLead = lead`.
3. `Deal.create(...)` referencing both `customer` and `lead`.
4. `Lead.updateOne(...)` writing `convertedCustomer` / `convertedDeal`.
5. Four `timeline` entries (`CUSTOMER_CREATED`, `DEAL_CREATED`, `LEAD_CONVERTED`,
   `LEAD_STATUS_CHANGED`) using the **same session**.

The claim happens *first* precisely so that a losing transaction fails at step 1 and rolls
back, rather than half-way through.

Second line of defence: a **unique partial index** on `customers.originalLead`. Even if a
future code path bypassed the service, the storage layer would reject a second customer for
the same lead.

Transient transaction errors are retried up to three times (`runInTransaction`); anything
else propagates and aborts.

## 4. Overdue activities

`Activity.status` is stored as `PENDING` or `COMPLETED`. `OVERDUE` is **derived**:

* `deriveActivityStatus(activity, now)` → used to populate `derivedStatus` on list reads.
* `buildStatusFilter(status, now)` → used so that `?status=OVERDUE` matches
  `not completed AND dueDate < now`.

This makes overdue reporting correct with zero scheduled jobs. The optional maintenance job
(`src/jobs/index.js`, disabled by default) only *persists* the flag so that ad-hoc queries
and BI tools reading `activities.status` directly stay accurate. A completed activity can
never re-enter the overdue set because both the derived function and the filter exclude
`COMPLETED`.

## 5. Money handling

Amounts are `Number` with 2 decimals in a single currency. To avoid binary floating point
drift:

```js
const cents = Math.round((value + Number.EPSILON) * 100);
const weightedCents = Math.round((cents * probability) / 100);
return weightedCents / 100;   // expectedRevenue
```

`Deal` recomputes `expectedRevenue` in a `pre('validate')` hook on every create/update, so
the stored value can never drift from `dealValue` and `probability`, whatever the client
sends.

## 6. Audit trail

`Timeline` is append-only: only a `GET` route exists. Two protections keep it clean:

* `TimelineService.sanitizeValue()` reduces snapshots to `TIMELINE_SAFE_FIELDS`;
* `TimelineService.sanitizeMetadata()` drops any key matching
  `password|token|secret|hash|authorization` and any non-primitive value that is not an id.

Audit entries are written with the optional session so that a multi-document operation and
its audit trail commit together.

## 7. Query construction

`src/utils/query.js` is the single place where query-string parameters are interpreted:

* `parsePagination` — clamps `page`/`limit`, enforces `limit ≤ 100`;
* `parseSort` — validates `sortBy` against a per-collection allow-list;
* `parseDateRange` / `parseEnum` / `parseObjectId` / `parseNumberParam` — typed, validated;
* `buildSearchRegex` — escapes the keyword into a **literal** regex (no ReDoS, no operator
  injection);
* `executePaginatedQuery` — runs the `find` and the `countDocuments` in parallel.

Because aggregation pipelines are not cast by Mongoose, `buildScopeFilter` returns real
`ObjectId` instances so that list queries and analytics queries apply exactly the same
scope.

## 8. Error contract

`normalizeError()` in `middleware/errorHandler.js` maps every known error family
(Zod, Mongoose validation / cast, duplicate key `11000`, JWT expired/invalid, body-parser
errors, rate limiters) onto `ApiError`. Everything else becomes a generic `500` whose
message is replaced by `Internal server error` in production. The response body always has
the same shape:

```json
{ "success": false, "message": "...", "code": "...", "errors": [ { "field": "...", "message": "..." } ] }
```