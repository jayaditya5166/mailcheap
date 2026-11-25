# Database Architecture & Schema Specification

**Project:** Enterprise AI-First Email Marketing, Event Acquisition & Registration Platform  
**Target Events:** GIPC 2027 & CPVA 2027  
**Module:** Enterprise Contact Database & High-Throughput Importer  
**Updated:** 25 November 2026 (Phase 3 Completed)  

---

## 1. Overview & Multi-Tenant Scoping Principle

The platform utilizes MongoDB Atlas with Mongoose ODM. All customer data models enforce strict account-level isolation through the `accountScoped` plugin (`lib/account-scope.js`).

Every query, update, deletion, aggregation, and `bulkWrite` operation is automatically validated to ensure the presence of an authorized `accountId`. Unscoped cross-tenant operations are blocked at the driver level, ensuring complete tenant data isolation.

---

## 2. Core Contact Model (`models/Contact.js`)

The `Contact` model represents individual delegates, subscribers, prospects, and speakers across all newsletters and events.

### Field Definitions

| Field Name | Type | Modifiers / Default | Description |
| :--- | :--- | :--- | :--- |
| `accountId` | ObjectId | Ref: "Account", Required, Immutable | Enforced tenant owner ID |
| `newsletterId` | ObjectId | Ref: "Newsletter", Required | Event / Publication ID |
| `email` | String | Lowercase, Trim, Required | Normalized subscriber email address |
| `status` | String | Enum: `["active", "pending", "unsubscribed", "bounced", "complained", "dormant"]`, Default: `"active"` | Current delivery state |
| `firstName` | String | Trim | First name for merge tags (`{{first_name}}`) |
| `lastName` | String | Trim | Last name |
| `fullName` | String | Trim | Full name of the contact |
| `company` | String | Trim | Organization, enterprise, or firm name |
| `designation` | String | Trim | Job title or professional role |
| `industry` | String | Trim | Vertical / Sector (e.g. IT, Legal, Pharma, Auto) |
| `country` | String | Trim | Country name or ISO 3166-1 alpha-2 code |
| `city` | String | Trim | City of residence / employment |
| `phone` | String | Trim | Contact / WhatsApp phone number |
| `persona` | String | Trim | Audience classification: `IN_HOUSE_COUNSEL`, `LAW_FIRM`, `STARTUP_RND`, `CPVA_PROSPECT` |
| `gipcStatus` | String | Trim, Default: `"NONE"` | GIPC lifecycle: `NONE`, `INVITED`, `REGISTERED`, `ATTENDED`, `DELEGATE`, `SPEAKER`, `SPONSOR` |
| `cpvaStatus` | String | Trim, Default: `"NONE"` | CPVA lifecycle: `NONE`, `APPLIED`, `QUALIFIED`, `ENROLLED`, `CERTIFIED` |
| `intentScore` | Number | Default: `0`, Min: `0`, Max: `100` | Dynamic behavioral engagement & purchase intent score |
| `engagementScore` | Number | Default: `0`, Min: `0`, Max: `100` | Historical email open and click engagement score |
| `fields` | Mixed | — | Account custom fields (dynamic key-value store) |
| `tags` | [String] | Default: `undefined` | Array of lowercase labels for audience filtering |
| `importId` | ObjectId | Ref: "ContactImport" | Reference to origin import job |
| `source` | String | Trim | Origin channel (`dashboard`, `import`, `api`, `embed`) |
| `sourceDomain` | String | Trim | Referral host for web embeds |
| `subscribedAt` | Date | Default: `Date.now` | Signup / registration timestamp |
| `confirmedAt` | Date | — | Double opt-in confirmation timestamp |
| `unsubscribedAt` | Date | — | Timestamp of unsubscribe |
| `lastSentAt` | Date | — | Timestamp of most recent email dispatch |
| `lastOpenAt` | Date | — | Timestamp of most recent email open |
| `lastClickAt` | Date | — | Timestamp of most recent email link click |
| `stats.sent` | Number | Default: `0` | Total emails sent to this contact |
| `stats.opens` | Number | Default: `0` | Total unique email opens |
| `stats.clicks` | Number | Default: `0` | Total unique email link clicks |
| `imported` | Object | `{ emailsReceived, openRate, clickRate }` | Historical metrics imported from previous platforms |
| `statusChanges` | Array | `[{ from, to, at, via, reason, ... }]` | Append-only immutable status transition audit log |
| `createdAt` | Date | Timestamps: true | Record creation timestamp |
| `updatedAt` | Date | Timestamps: true | Record last update timestamp |

### Indexes & Performance Architecture

| Index Keys | Type / Options | Purpose |
| :--- | :--- | :--- |
| `{ newsletterId: 1, email: 1 }` | Unique Compound | Primary uniqueness barrier preventing duplicate contacts within a newsletter |
| `{ accountId: 1, email: 1 }` | Compound | Fast tenant-level lookups for bounce, complaint, and suppression synchronization |
| `{ accountId: 1, persona: 1, subscribedAt: -1 }` | Compound | High-speed filtered queries for AI persona campaigns |
| `{ accountId: 1, gipcStatus: 1 }` | Compound | Fast querying and dynamic suppression of registered GIPC delegates |
| `{ accountId: 1, cpvaStatus: 1 }` | Compound | Fast querying and dynamic suppression of qualified CPVA applicants |
| `{ accountId: 1, company: 1 }` | Compound | B2B account-based marketing (ABM) queries |
| `{ accountId: 1, intentScore: -1 }` | Compound | Prioritized dispatch targeting top-intent leads |
| `{ newsletterId: 1, status: 1, subscribedAt: -1, _id: -1 }` | Compound | Dashboard pagination with deterministic tie-breaking |
| `{ newsletterId: 1, status: 1, lastOpenAt: -1 }` | Compound | Active recipient selection for campaign sends |
| `{ newsletterId: 1, tags: 1, subscribedAt: -1, _id: -1 }` | Compound | Tag-based audience segment queries |

---

## 3. Contact Import Model (`models/ContactImport.js`)

Tracks streaming and batch CSV imports, recording real-time progress, validation exclusions, and cancellation state.

### Field Definitions

| Field Name | Type | Modifiers / Default | Description |
| :--- | :--- | :--- | :--- |
| `accountId` | ObjectId | Ref: "Account", Required | Tenant ID |
| `newsletterId` | ObjectId | Ref: "Newsletter", Required | Target event / publication ID |
| `userId` | ObjectId | — | User who authorized the import |
| `apiKeyId` | ObjectId | — | API key ID (for programmatic imports) |
| `source` | String | Default: `"dashboard"` | Import entry channel |
| `status` | String | Enum: `["processing", "done", "failed", "cancelled"]` | Import lifecycle status |
| `dryRun` | Boolean | Default: `false` | Simulation flag; when true, no database writes are committed |
| `fileName` | String | Max: 200 | Name of uploaded CSV file |
| `total` | Number | Min: 0 | Total expected rows in file |
| `received` | Number | Default: `0` | Total rows received by server |
| `rows` | Number | Default: `0` | Total rows processed through validation pipeline |
| `created` | Number | Default: `0` | Total new contacts inserted |
| `existing` | Number | Default: `0` | Total matching existing contacts updated |
| `dropped` | Object | Counter sub-document | Granular exclusion breakdown (`invalid`, `duplicate`, `suppressed`, `trap`, `role`, `disposable`, `noMail`, etc.) |
| `cancelledAt` | Date | — | Timestamp when import was cancelled by user |
| `cancelledBy` | ObjectId | — | User ID who cancelled the job |
| `startedAt` | Date | — | Processing start timestamp |
| `finishedAt` | Date | — | Processing completion timestamp |
| `error` | String | Max: 300 | Failure description if status is `failed` |

---

## 4. Left-Out Contact Model (`models/LeftOutContact.js`)

Records all addresses excluded during an import, capturing the exact exclusion reason and full original row payload to power the downloadable error report.

### Field Definitions

| Field Name | Type | Description |
| :--- | :--- | :--- |
| `accountId` | ObjectId | Tenant ID |
| `importId` | ObjectId | Associated ContactImport ID |
| `newsletterId` | ObjectId | Newsletter ID |
| `email` | String | Excluded email address |
| `reason` | String | Drop reason: `invalid`, `duplicate`, `suppressed`, `noMail`, `spamDomain`, etc. |
| `canBringBack` | Boolean | Whether an admin can override and bring the address back |
| `contact` | Mixed | Full original row data captured for audit and export |
| `createdAt` | Date | Expiration TTL: auto-expires after 7 days |

---

## 5. Suppression Model (`models/Suppression.js`)

Centralized suppression registry ensuring that contacts who bounced, complained, or unsubscribed are never emailed again.

### Field Definitions

| Field Name | Type | Description |
| :--- | :--- | :--- |
| `accountId` | ObjectId | Tenant ID |
| `email` | String | Suppressed email address (lowercase, trimmed) |
| `reason` | String | Enum: `["bounce", "complaint", "manual", "provider"]` |
| `detail` | String | Context / bounce diagnostic message |
| `createdAt` | Date | Timestamp of suppression |

---

## 6. Migration & Backward Compatibility Strategy

1. **Additive Schema Migration:** All newly introduced fields (`company`, `designation`, `industry`, `city`, `phone`, `persona`, `gipcStatus`, `cpvaStatus`, `intentScore`, `engagementScore`) are purely additive with default values (`NONE` / `0`). Existing contacts remain 100% valid without requiring destructive table rewrites.
2. **Compound Index Building:** Indexes use standard Mongoose background index compilation, creating zero read locks on MongoDB Atlas.
3. **Account Scoping Enforcement:** All queries in `models/Contact.js` and `models/ContactImport.js` remain strictly wrapped with `accountScoped`, preserving isolation across dashboard users and API clients.
