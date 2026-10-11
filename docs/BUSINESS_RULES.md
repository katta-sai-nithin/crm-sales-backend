# Business rules reference

Quick reference for the rules the API enforces. The full discussion lives in
[README § Business rules](../README.md#17-business-rules).

## Lead status transitions

| From \ To | NEW | CONTACTED | QUALIFIED | UNQUALIFIED | CONVERTED | LOST |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| **NEW** | – | ✅ | ✅ | ✅ | ❌ | ✅ |
| **CONTACTED** | ❌ | – | ✅ | ✅ | ❌ | ✅ |
| **QUALIFIED** | ❌ | ❌ | – | ❌ | ⚠️ conversion endpoint only | ✅ |
| **UNQUALIFIED** | ❌ | ✅ | ✅ | – | ❌ | ✅ |
| **CONVERTED** | ❌ | ❌ | ❌ | ❌ | – | ❌ |
| **LOST** | ❌ | ✅ | ✅ | ❌ | ❌ | – |

## Deal stage transitions

| From \ To | QUALIFICATION | DISCOVERY | PROPOSAL | NEGOTIATION | WON | LOST |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| **QUALIFICATION** | – | ✅ | ✅ | ❌ | ✅ | ✅ |
| **DISCOVERY** | ❌ | – | ✅ | ✅ | ✅ | ✅ |
| **PROPOSAL** | ❌ | ❌ | – | ✅ | ✅ | ✅ |
| **NEGOTIATION** | ❌ | ❌ | ❌ | – | ✅ | ✅ |
| **WON** | ❌ | ❌ | ❌ | ❌ | – | ❌ |
| **LOST** | ❌ | ❌ | ❌ | ❌ | ❌ | – |

Reopening a closed deal: `POST /api/v1/deals/:id/reopen` — ADMIN or SALES_MANAGER only,
`reason` required, clears `closedAt` and `lostReason`.

## Invariants

| # | Rule | Enforced by |
| --- | --- | --- |
| 1 | `dealValue > 0` | Zod schema + Mongoose |
| 2 | `0 ≤ probability ≤ 100`, integer | Zod schema + Mongoose |
| 3 | `expectedRevenue = dealValue × probability / 100`, 2 decimals | `Deal.pre('validate')` |
| 4 | Active deals need a future `expectedClosingDate` | `DealService.assertClosingDateForStage` |
| 5 | `LOST` requires `lostReason` | Zod optional + service + Mongoose |
| 6 | `WON` sets `closedAt` and normalises probability to 100 | `DealService.updateStage` |
| 7 | Closed deals cannot be updated, reassigned or moved | `DealService` |
| 8 | `expectedRevenue`, `createdBy`, `closedAt`, `customer`, `lead` are never client-writable | strict Zod schemas |
| 9 | Only `QUALIFIED` leads convert | `conversion.service` |
| 10 | A lead converts at most once | conditional atomic update **and** unique index |
| 11 | Conversion is all-or-nothing | MongoDB transaction |
| 12 | A customer with deals or activities cannot be deleted | `CustomerService.remove` |
| 13 | A converted lead cannot be deleted | `LeadService.remove` |
| 14 | An activity cannot reference an invisible entity | `ActivityService.assertRelatedEntityAccessible` |
| 15 | Completed activities are never overdue | `deriveActivityStatus` + `buildStatusFilter` |
| 16 | Timeline entries are immutable | no write route exists |
| 17 | Secrets never enter the audit trail | `TIMELINE_SAFE_FIELDS` + metadata redaction |
| 18 | Admins cannot be assignees; inactive users cannot be assigned | `UserService.assertAssignable` |
| 19 | The last active administrator cannot be demoted or deactivated | `UserService.assertNotLastAdmin` |
| 20 | Ownership is never auto-transferred on deactivation | response reports `orphanedRecords` instead |