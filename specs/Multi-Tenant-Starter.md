# Organizational Login Specs

## User Scenarios

1. A user is able to start a new organization specifying the name of the organization and signing on via a gmail SSO or email login.
2. A user configures their organization establishing roles and inviting new role based administrators via email
3. An existing user is routed to their organization landing page when they login, and their login is associated with an existing organization.

## Pages

Create four pages

- A default no-org landing page
  - includes welcome content
  - includes a button to sign-up and create an organization
    - Sign-up/Create button starts a popover asking them to choose Google SSO or email login
    - Failure or cancel returns to no-org landing page
    - Success continues to create organization page
    - This user becomes the default admin and has an admin role
- A create organization page
  - A form with the organization name
    - only [A-Za-z0-9] and hyphen allowed
    - name can not already exist or be registered
    - Full Name 255 characters or less
    - Short Name 6 charactures of less
  - Invite member with roles
    - Invite by email
    - roles include
      - Admin
      - Division Chair
      - Music Reviewer
      - Concert Chair
      - Read Only
- An invite landing page
  - after reciept of email and clicking embedded inbite-link users are sent here
  - sign-up button
    - Sign up button starts a popover asking them to choose Google SSO or email login, and a single field to enter their name
    - Failure or cancel returns to no-org landing page
    - Success continues to create organization landing page
    - This user takes the role set by the admin when the invite was created
- A organization landing page
  - the URL is the `base name` + `short-org-name`
  - header nav with Organization name (on-press navigate to organization landing page) in left , and log-out in right
  - a simple message showing `Welcome to $organization you are $role role`

  ## Organization
  - Create database tables with use of Firebase for authentication
    - single firebase tenant
  - multiple organizational tenants inside the application
  - On Login retain information to enable JWT token for backend API authentication
  - Create APIs using hono for backend and use JWT token for authentication
  - Create WebPage on top of APIs

## References

- ./specs/Style.md skelton style settings
- ./reference/solidjs latest solidjs documentation

Below is a first-pass technical design for the **organization onboarding and invitation pages**.

I have made one concrete implementation choice to keep this tight:

* **Frontend**: SolidJS with file-based routes and Solid Router patterns. ([Solid Docs][1])
* **Auth**: Firebase Authentication for Google SSO and email/password. ([Firebase][2])
* **Backend auth**: the frontend sends the Firebase ID token as a Bearer token, and the Hono backend verifies that token with the Firebase Admin SDK before authorizing API access. ([Firebase][3])

That is the cleanest path for v1.

---

# 1. Scope

This design covers these four pages:

* no-org landing page
* create organization page
* invite landing page
* organization landing page

And these scenarios:

1. A new user signs in and creates an organization
2. An admin invites additional organization members with roles
3. An existing user logs in and is routed to their existing organization landing page

---

# 2. Route design

Suggested frontend routes:

* `/`

  * default no-org landing page
* `/create-organization`

  * create organization page
* `/invite/:inviteToken`

  * invite landing page
* `/o/:shortOrgName`

  * organization landing page

Why this shape:

* Solid supports file-based routing cleanly for page creation. ([Solid Docs][1])
* `shortOrgName` is stable, readable, and matches your URL requirement.

---

# 3. Authentication model

## 3.1 Sign-in methods

Supported sign-in methods:

* Google SSO
* email/password

Firebase Authentication supports both flows. ([Firebase][2])

## 3.2 Backend authentication

Recommended v1 approach:

* frontend authenticates with Firebase
* frontend obtains Firebase ID token
* frontend sends `Authorization: Bearer <firebase-id-token>` to Hono APIs
* backend verifies token via Firebase Admin SDK
* backend resolves app user + organization membership + roles
* backend authorizes request

Firebase Admin SDK is the intended backend verification path for ID tokens. ([Firebase][3])

## 3.3 Single Firebase tenant, multiple app tenants

You specified:

* one Firebase tenant
* multiple organizational tenants in the app

So tenancy lives in your database, not Firebase:

* Firebase user identity is global
* org membership and roles are app-owned data

---

# 4. Core page behavior

## 4.1 No-org landing page

Purpose:

* welcome page for users who are not associated with any organization yet

Behavior:

* show welcome content
* show primary CTA: `Sign up / Create Organization`
* clicking CTA opens auth popover:

  * Google SSO
  * Email login
* cancel or auth failure returns user to `/`
* successful auth checks whether user already belongs to an organization:

  * if yes, redirect to that organization landing page
  * if no, redirect to `/create-organization`

## 4.2 Create organization page

Purpose:

* create the organization and optionally issue invites

Behavior:

* organization form fields:

  * organization name
  * short name
* validations:

  * organization name: 255 chars max
  * short name: 6 chars max
  * characters allowed: `[A-Za-z0-9-]`
  * name must be unique
  * short name must be unique
* current signed-in user becomes:

  * organization owner
  * default admin role
* invite section:

  * invite by email
  * assign role:

    * Admin
    * Division Chair
    * Music Reviewer
    * Concert Chair
    * Read Only

## 4.3 Invite landing page

Purpose:

* accept invitation sent by email

Behavior:

* user opens `/invite/:inviteToken`
* page validates token
* if token invalid or expired, show invite error state
* if valid:

  * show org name
  * show invited role
  * show sign-up button
* sign-up opens auth popover:

  * Google SSO or email login
  * required name field
* success:

  * attach authenticated user to invitation
  * create app user profile if needed
  * create org membership with invited role
  * redirect to `/o/:shortOrgName`

## 4.4 Organization landing page

Purpose:

* initial authenticated org home page

Behavior:

* URL: `/o/:shortOrgName`
* header:

  * left: organization name, links back to org landing
  * right: logout
* body:

  * `Welcome to {organizationName}, you are {role} role`

---

# 5. API design

All authenticated APIs require:

`Authorization: Bearer <firebase-id-token>`

The backend verifies the Firebase token before proceeding. ([Firebase][3])

---

## 5.1 Auth/session bootstrap

### `GET /api/v1/session`

Returns the authenticated user’s app session context.

**Headers**

* `Authorization: Bearer <firebase-id-token>`

**Response**

```json
{
  "user": {
    "id": "usr_123",
    "firebaseUid": "firebase_uid",
    "email": "user@example.com",
    "fullName": "Jane Doe"
  },
  "organizations": [
    {
      "organizationId": "org_123",
      "name": "Performing Arts Festival of the Eastside",
      "shortName": "PAFE",
      "role": "Admin"
    }
  ],
  "defaultOrganizationId": "org_123"
}
```

Use:

* app boot
* redirect logic after login
* navbar/session hydration

---

## 5.2 Organization name availability

### `GET /api/v1/organizations/availability`

Checks whether org name and short name are available.

**Query parameters**

* `name`: string
* `shortName`: string

**Response**

```json
{
  "name": {
    "value": "Performing Arts Festival of the Eastside",
    "isAvailable": true,
    "reason": null
  },
  "shortName": {
    "value": "PAFE",
    "isAvailable": false,
    "reason": "already_registered"
  }
}
```

Validation:

* `[A-Za-z0-9-]`
* short name max 6
* full name max 255

---

## 5.3 Create organization

### `POST /api/v1/organizations`

**Request JSON schema**

```json
{
  "type": "object",
  "required": ["name", "shortName"],
  "properties": {
    "name": {
      "type": "string",
      "maxLength": 255,
      "pattern": "^[A-Za-z0-9-]+(?:[ ][A-Za-z0-9-]+)*$"
    },
    "shortName": {
      "type": "string",
      "maxLength": 6,
      "pattern": "^[A-Za-z0-9-]+$"
    }
  },
  "additionalProperties": false
}
```

**Response JSON schema**

```json
{
  "type": "object",
  "required": ["organization", "membership"],
  "properties": {
    "organization": {
      "type": "object",
      "required": ["id", "name", "shortName", "slug"],
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "shortName": { "type": "string" },
        "slug": { "type": "string" }
      }
    },
    "membership": {
      "type": "object",
      "required": ["role"],
      "properties": {
        "role": {
          "type": "string",
          "enum": ["Admin"]
        }
      }
    }
  }
}
```

Side effects:

* create organization
* attach current user as owner/admin
* create default org membership
* set current org for user if none exists

---

## 5.4 List organization members

### `GET /api/v1/organizations/:organizationId/members`

**Query parameters**
None

**Response**

```json
{
  "members": [
    {
      "membershipId": "mem_123",
      "userId": "usr_123",
      "fullName": "Jane Doe",
      "email": "jane@example.com",
      "role": "Admin",
      "status": "active"
    }
  ]
}
```

Authorization:

* Admin only for v1

---

## 5.5 Create invite

### `POST /api/v1/organizations/:organizationId/invites`

**Request JSON schema**

```json
{
  "type": "object",
  "required": ["email", "role"],
  "properties": {
    "email": {
      "type": "string",
      "format": "email",
      "maxLength": 320
    },
    "role": {
      "type": "string",
      "enum": [
        "Admin",
        "Division Chair",
        "Music Reviewer",
        "Concert Chair",
        "Read Only"
      ]
    }
  },
  "additionalProperties": false
}
```

**Response JSON schema**

```json
{
  "type": "object",
  "required": ["invite"],
  "properties": {
    "invite": {
      "type": "object",
      "required": [
        "id",
        "email",
        "role",
        "status",
        "expiresAt"
      ],
      "properties": {
        "id": { "type": "string" },
        "email": { "type": "string" },
        "role": { "type": "string" },
        "status": {
          "type": "string",
          "enum": ["pending"]
        },
        "expiresAt": { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

Side effects:

* create invite record
* create one-time invite token
* send email with invite URL

---

## 5.6 Get invite details

### `GET /api/v1/invites/:inviteToken`

Public endpoint, but rate-limited.

**Query parameters**
None

**Response**

```json
{
  "invite": {
    "organizationName": "Performing Arts Festival of the Eastside",
    "shortName": "PAFE",
    "role": "Division Chair",
    "email": "invitee@example.com",
    "status": "pending",
    "isValid": true,
    "expiresAt": "2026-04-19T22:00:00Z"
  }
}
```

This is used to render the invite landing page before signup.

---

## 5.7 Accept invite

### `POST /api/v1/invites/:inviteToken/accept`

Requires authenticated Firebase user.

**Request JSON schema**

```json
{
  "type": "object",
  "required": ["fullName"],
  "properties": {
    "fullName": {
      "type": "string",
      "maxLength": 255
    }
  },
  "additionalProperties": false
}
```

**Response JSON schema**

```json
{
  "type": "object",
  "required": ["organization", "membership", "user"],
  "properties": {
    "organization": {
      "type": "object",
      "required": ["id", "name", "shortName", "slug"],
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "shortName": { "type": "string" },
        "slug": { "type": "string" }
      }
    },
    "membership": {
      "type": "object",
      "required": ["role", "status"],
      "properties": {
        "role": { "type": "string" },
        "status": {
          "type": "string",
          "enum": ["active"]
        }
      }
    },
    "user": {
      "type": "object",
      "required": ["id", "fullName", "email"],
      "properties": {
        "id": { "type": "string" },
        "fullName": { "type": "string" },
        "email": { "type": "string" }
      }
    }
  }
}
```

Side effects:

* create or update app user profile
* create org membership using invited role
* mark invite accepted
* invalidate invite token

---

## 5.8 Get organization landing payload

### `GET /api/v1/organizations/:shortOrgName/landing`

**Query parameters**
None

**Response**

```json
{
  "organization": {
    "id": "org_123",
    "name": "Performing Arts Festival of the Eastside",
    "shortName": "PAFE"
  },
  "viewer": {
    "userId": "usr_123",
    "fullName": "Jane Doe",
    "role": "Division Chair"
  }
}
```

Use:

* org landing page
* header/nav hydration

---

## 5.9 Logout

Frontend-only with Firebase client SDK. No backend endpoint required for v1.

---

# 6. Database tables

Below is the minimum normalized schema for the org and invitation flows.

---

## 6.1 `app_user`

App-owned user profile tied to Firebase identity.

```sql
create table app_user (
  id uuid primary key,
  firebase_uid varchar(128) not null unique,
  email varchar(320) not null unique,
  full_name varchar(255),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Notes:

* `firebase_uid` is the durable auth linkage
* email is unique in v1

---

## 6.2 `organization`

```sql
create table organization (
  id uuid primary key,
  name varchar(255) not null unique,
  short_name varchar(6) not null unique,
  slug varchar(64) not null unique,
  created_by_user_id uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (short_name ~ '^[A-Za-z0-9-]+$')
);
```

Notes:

* `slug` can be the route-safe base if you later want more than `short_name`
* if you want name with spaces, validate in application layer and store raw string

---

## 6.3 `organization_role`

Use enum or reference table. I prefer enum for v1.

```sql
create type organization_role as enum (
  'Admin',
  'Division Chair',
  'Music Reviewer',
  'Concert Chair',
  'Read Only'
);
```

---

## 6.4 `organization_membership`

Maps users to orgs and roles.

```sql
create table organization_membership (
  id uuid primary key,
  organization_id uuid not null references organization(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  role organization_role not null,
  status varchar(32) not null default 'active',
  invited_by_user_id uuid references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
```

Suggested `status` values:

* active
* suspended
* removed

---

## 6.5 `organization_invite`

```sql
create table organization_invite (
  id uuid primary key,
  organization_id uuid not null references organization(id) on delete cascade,
  email varchar(320) not null,
  role organization_role not null,
  invited_by_user_id uuid not null references app_user(id),
  status varchar(32) not null default 'pending',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Suggested `status` values:

* pending
* accepted
* expired
* revoked

---

## 6.6 `organization_invite_token`

Store only a hash, not raw token.

```sql
create table organization_invite_token (
  invite_id uuid primary key references organization_invite(id) on delete cascade,
  token_hash varchar(255) not null unique,
  created_at timestamptz not null default now()
);
```

Pattern:

* email contains raw token
* database stores hash
* incoming token is hashed and matched

---

## 6.7 `user_default_organization`

Supports routing existing users to their preferred org.

```sql
create table user_default_organization (
  user_id uuid primary key references app_user(id) on delete cascade,
  organization_id uuid not null references organization(id) on delete cascade,
  updated_at timestamptz not null default now()
);
```

---

# 7. Indexes

```sql
create index idx_org_membership_user_id
  on organization_membership(user_id);

create index idx_org_membership_org_id
  on organization_membership(organization_id);

create index idx_org_invite_org_id
  on organization_invite(organization_id);

create index idx_org_invite_email
  on organization_invite(lower(email));

create unique index idx_org_name_lower
  on organization(lower(name));

create unique index idx_org_short_name_lower
  on organization(lower(short_name));
```

I would enforce case-insensitive uniqueness for:

* organization name
* short name
* invite email matching behavior

---

# 8. Backend authorization rules

## Admin

Can:

* create organization invites
* view org members
* manage org settings later

## Division Chair / Music Reviewer / Concert Chair / Read Only

Can:

* access organization landing page
* future permissions depend on domain features

## Route guard model

Every authenticated request should:

1. verify Firebase token
2. resolve `app_user`
3. resolve org membership for route org
4. enforce role policy

---

# 9. Hono endpoint shape

Suggested Hono structure:

```ts
/api/v1/session
/api/v1/organizations/availability
/api/v1/organizations
/api/v1/organizations/:organizationId/members
/api/v1/organizations/:organizationId/invites
/api/v1/invites/:inviteToken
/api/v1/invites/:inviteToken/accept
/api/v1/organizations/:shortOrgName/landing
```

Hono is a good fit for middleware-based auth and route organization. ([Hono][4])

---

# 10. Page flow diagram

```mermaid
flowchart TD
    A[User visits /] --> B{Authenticated?}

    B -- No --> C[Show no-org landing page]
    C --> D[Click Sign up / Create Organization]
    D --> E[Auth popover: Google SSO or Email Login]

    E -- Cancel or Failure --> C
    E -- Success --> F[GET /api/v1/session]

    B -- Yes --> F

    F --> G{Has organization membership?}
    G -- Yes --> H[Redirect to /o/:shortOrgName]
    G -- No --> I[Redirect to /create-organization]

    I --> J[Create organization form]
    J --> K[Validate name + short name]
    K --> L[POST /api/v1/organizations]
    L --> M[Create org + assign Admin role]
    M --> N[Optional invite members]
    N --> O[POST /api/v1/organizations/:organizationId/invites]
    O --> H

    P[User clicks invite email link] --> Q[/invite/:inviteToken]
    Q --> R[GET /api/v1/invites/:inviteToken]
    R --> S{Invite valid?}
    S -- No --> T[Show invite invalid/expired state]
    S -- Yes --> U[Show invite landing page]
    U --> V[Auth popover + full name field]
    V -- Cancel or Failure --> A
    V -- Success --> W[POST /api/v1/invites/:inviteToken/accept]
    W --> H

    H --> X[Organization landing page]
    X --> Y[Show welcome message with role]
```

---

# 11. Frontend page/component breakdown

## `/`

Components:

* `NoOrgLandingPage`
* `AuthMethodPopover`

Calls:

* none until auth succeeds
* after auth: `GET /api/v1/session`

## `/create-organization`

Components:

* `CreateOrganizationPage`
* `OrganizationForm`
* `InviteMembersPanel`

Calls:

* `GET /api/v1/organizations/availability`
* `POST /api/v1/organizations`
* `POST /api/v1/organizations/:organizationId/invites`

## `/invite/:inviteToken`

Components:

* `InviteLandingPage`
* `InviteSummaryCard`
* `InviteAcceptAuthPopover`

Calls:

* `GET /api/v1/invites/:inviteToken`
* `POST /api/v1/invites/:inviteToken/accept`

## `/o/:shortOrgName`

Components:

* `OrganizationLandingPage`
* `OrganizationHeader`

Calls:

* `GET /api/v1/organizations/:shortOrgName/landing`

---

# 12. Validation rules

## Organization name

Business rules you gave:

* full name <= 255
* short name <= 6
* only `[A-Za-z0-9]` and hyphen allowed
* name cannot already exist
* short name cannot already exist

I would implement them as:

### Full name

* allow spaces between tokens
* allow only letters, digits, spaces, hyphens
* trim leading/trailing whitespace
* canonicalize repeated internal spaces if desired

Pattern:

```regex
^[A-Za-z0-9-]+(?: [A-Za-z0-9-]+)*$
```

### Short name

Pattern:

```regex
^[A-Za-z0-9-]{1,6}$
```

---

# 13. Error states

## No-org landing

* auth canceled
* auth failed

## Create organization

* name invalid
* short name invalid
* name already taken
* short name already taken
* network/server error

## Invite landing

* invite token invalid
* invite expired
* invite already accepted
* invite email mismatch, if you later enforce email binding

## Organization landing

* authenticated but not member of org
* org not found

---

# 14. Recommended implementation choices

## 14.1 Use Firebase ID token directly

Do not mint a second custom app JWT in v1 unless there is a strong need.
Use Firebase ID token as the backend bearer token and verify it server-side. That is the straightest supported design. ([Firebase][3])

## 14.2 Keep org routing by `shortName`

Use:

* `/o/:shortOrgName`

Do not use numeric IDs in the primary user-facing URL.

## 14.3 Store invite token hash only

Never persist raw invite token.

## 14.4 Case-insensitive uniqueness

Treat org names and short names as case-insensitive unique values.

---

# 15. Suggested file layout

For SolidStart or file-based Solid routing:

```text
src/routes/index.tsx
src/routes/create-organization.tsx
src/routes/invite/[inviteToken].tsx
src/routes/o/[shortOrgName].tsx

src/components/auth/AuthMethodPopover.tsx
src/components/organization/OrganizationForm.tsx
src/components/organization/InviteMembersPanel.tsx
src/components/organization/OrganizationHeader.tsx

src/lib/api/session.ts
src/lib/api/organizations.ts
src/lib/api/invites.ts

src/server/api/session.ts
src/server/api/organizations.ts
src/server/api/invites.ts
```

Solid’s routing and navigation model is a good fit for this page decomposition. ([Solid Docs][1])

---

# 16. Main unresolved choices

These are the only decisions I would push back to product before coding:

1. Should an invite be restricted to the invited email address only, or can any authenticated user with the token accept it?
2. Can one user belong to multiple organizations in v1?
3. Is the organization creator always permanently an Admin, or can that be changed later?
4. Should the invite flow require name entry only for first-time users, or every time until profile is complete?

My recommendation:

* bind invite acceptance to invited email
* allow multi-org membership in schema now
* allow creator role management later, but guarantee one admin exists
* only require full name when missing from profile

If you want, I can take this one step further and turn it into:

* a **Postgres migration draft**
* a **Hono route skeleton in TypeScript**
* or a **page-by-page frontend implementation spec for SolidJS**

[1]: https://docs.solidjs.com/solid-start/building-your-application/routing?utm_source=chatgpt.com "Routing - Solid Docs"
[2]: https://firebase.google.com/docs/auth?utm_source=chatgpt.com "Firebase Authentication"
[3]: https://firebase.google.com/docs/auth/admin/verify-id-tokens?utm_source=chatgpt.com "Verify ID Tokens | Firebase Authentication - Google"
[4]: https://hono.dev/docs/?utm_source=chatgpt.com "Hono - Web framework built on Web Standards"
