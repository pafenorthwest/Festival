# Organizational Login Specs

## User Scenarios

1. A user is able to start a new organization specifying the name of the organization and signing on via a gmail SSO or email login.
2. A user configures their organization establishing roles and inviting new role based administrators via email
3. An existing user is routed to their organization landing page when they login, and their login is associated with an existing organization.

## Pages

Create four pages

- A default no-org landing page
  - includes welcome content
  - includes a button to sign-up and start an organization
    - Sign up button starts a popover asking them to choose Google SSO or email login
    - Failure or cancel returns to no-org landing page
    - Success continues to create organization page
    - This user becomes the default admin and has an admin role
- A create organization page
  - A form with the organization name
    - only [a-z] and hyphen allowed
    - name can not already exist or be registered
    - 40 characters or less
  - Invite member with roles
    - Invite by email
    - roles include
      - Admin
      - Division Chair
      - Music Reviewer
      - Concert Chair
      - Read Only
- An invite landing page
  - email invitations are sent here
  - sign-up button
    - Sign up button starts a popover asking them to choose Google SSO or email login, and a single field to enter their name
    - Failure or cancel returns to no-org landing page
    - Success continues to create organization landing page
    - This user takes the role set by the admin when the invite was created
- A organization landing page
  - the URL is the `base name` + `orgainzation name`
  - header nave with Organization name (on-press navigate to organization landing page) in left , and log-out in right
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
