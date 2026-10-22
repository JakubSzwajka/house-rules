# Registry

## Mounts

- @example/api/modules/billing/Billing: Billing.expirePending, Billing.initPayment, Billing.refund
- @example/api/modules/bookings/Bookings: Bookings.book, Bookings.cancel, Bookings.get
- @example/api/read-models/my-bookings/MyStuff: MyStuff.myBookings
- booking/AuditTrail: AuditTrail.mine, AuditTrail.recent
- identity: Identity.bindLogin, Identity.changePassword, Identity.signIn, Identity.signUp
- party: Party.acceptInvitation, Party.assignRole, Party.canAdminOrganisation, Party.createInvitation, Party.createOrganisation, Party.createPerson, Party.defineRole, Party.deleteRole, Party.isRelated, Party.listInvitations, Party.listMembers, Party.listPeople, Party.listRoles, Party.myAccess, Party.myOrganisations, Party.relate, Party.revokeInvitation, Party.revokeRole, Party.rolesOf, Party.showOrganisation, Party.unrelate, rename_person, show_me, show_person

## Ways

- mcp (mcp: /mcp): my_bookings, show_booking
- partner (http: /partner): book_for_partner
- web (http: /api): accept_invitation, assign_role, cancel_booking, change_password, create_invitation, create_organisation, define_role, delete_role, list_invitations, list_members, list_people, list_permissions, list_roles, make_booking, my_activity, my_bookings, my_organisations, my_profile, recent_audit, remove_member, revoke_invitation, revoke_role, show_booking, sign_in, sign_out, sign_up

## Permissions

- audit:read
- billing:charge
- billing:expire
- billing:refund
- bookings:cancel
- bookings:read
- bookings:write
- identity:bind
- identity:create
- identity:sign-in
- identity:update
- party:admin
- party:create
- party:create-organisation
- party:read
- party:update

## Operations

### AuditTrail.mine

- Permission: none
- Called by: my_activity

### AuditTrail.recent

- Permission: audit:read
- Called by: recent_audit

### Billing.expirePending

- Permission: billing:expire
- Called by: nightly_cleanup

### Billing.initPayment

- Permission: billing:charge
- Called by: make_booking

### Billing.refund

- Permission: billing:refund
- Called by: cancel_booking

### Bookings.book

- Permission: bookings:write
- Called by: book_for_partner, make_booking
- Calls: Party.isRelated (person, inherited system stays system)
- Calls: Party.canAdminOrganisation (person, inherited system stays system)

### Bookings.cancel

- Permission: bookings:cancel
- Called by: cancel_booking
- Calls: Party.isRelated (person, inherited system stays system)
- Calls: Party.canAdminOrganisation (person, inherited system stays system)

### Bookings.get

- Permission: bookings:read
- Called by: show_booking
- Calls: Party.isRelated (person, inherited system stays system)

### Identity.bindLogin

- Permission: identity:bind
- Called by: first_sign_in

### Identity.changePassword

- Permission: identity:update
- Called by: change_password

### Identity.signIn

- Permission: identity:sign-in
- Called by: sign_in

### Identity.signUp

- Permission: identity:create
- Called by: sign_up

### MyStuff.myBookings

- Permission: bookings:read
- Called by: my_bookings

### Party.acceptInvitation

- Permission: party:read
- Called by: accept_invitation

### Party.assignRole

- Permission: party:admin
- Called by: accept_invitation, assign_role, create_organisation, first_sign_in

### Party.canAdminOrganisation

- Permission: party:read
- Called by: Bookings.book, Bookings.cancel

### Party.createInvitation

- Permission: party:admin
- Called by: create_invitation

### Party.createOrganisation

- Permission: party:create-organisation
- Called by: create_organisation

### Party.createPerson

- Permission: party:create
- Called by: first_sign_in

### Party.defineRole

- Permission: party:admin
- Called by: define_role

### Party.deleteRole

- Permission: party:admin
- Called by: delete_role

### Party.isRelated

- Permission: party:read
- Called by: Bookings.book, Bookings.cancel, Bookings.get

### Party.listInvitations

- Permission: party:admin
- Called by: list_invitations

### Party.listMembers

- Permission: party:read
- Called by: list_members

### Party.listPeople

- Permission: party:admin
- Called by: list_people

### Party.listRoles

- Permission: party:read
- Called by: list_roles

### Party.myAccess

- Permission: party:read
- Called by: list_permissions, my_profile

### Party.myOrganisations

- Permission: party:read
- Called by: my_organisations

### Party.relate

- Permission: party:admin
- Called by: none

### Party.revokeInvitation

- Permission: party:admin
- Called by: revoke_invitation

### Party.revokeRole

- Permission: party:admin
- Called by: revoke_role

### Party.rolesOf

- Permission: party:read
- Called by: none

### Party.showOrganisation

- Permission: party:read
- Called by: none

### Party.unrelate

- Permission: party:admin
- Called by: remove_member

### rename_person

- Permission: party:update
- Called by: none

### show_me

- Permission: party:read
- Called by: my_profile

### show_person

- Permission: party:read
- Called by: none

## Features

### accept_invitation

- Starts as: person
- Person closure: party:read
- System closure: party:admin
- Exposed by: web (http: /api)
- Calls: Party.acceptInvitation (person, inherited system stays system)
- Calls: ⚙ Party.assignRole (system: role delegated by organisation invitation)

### assign_role

- Starts as: person
- Person closure: party:admin
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.assignRole (person, inherited system stays system)

### book_for_partner

- Starts as: person
- Person closure: bookings:write, party:read
- System closure: none
- Exposed by: partner (http: /partner)
- Calls: Bookings.book (person, inherited system stays system)

### cancel_booking

- Starts as: person
- Person closure: bookings:cancel, party:read
- System closure: billing:refund
- Exposed by: web (http: /api)
- Calls: Bookings.cancel (person, inherited system stays system)
- Calls: ⚙ Billing.refund (system: refund after cancel)

### change_password

- Starts as: person
- Person closure: identity:update
- System closure: none
- Exposed by: web (http: /api)
- Calls: Identity.changePassword (person, inherited system stays system)

### create_invitation

- Starts as: person
- Person closure: party:admin
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.createInvitation (person, inherited system stays system)

### create_organisation

- Starts as: person
- Person closure: party:create-organisation
- System closure: party:admin
- Exposed by: web (http: /api)
- Calls: Party.createOrganisation (person, inherited system stays system)
- Calls: ⚙ Party.assignRole (system: creator of organisation)

### define_role

- Starts as: person
- Person closure: party:admin
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.defineRole (person, inherited system stays system)

### delete_role

- Starts as: person
- Person closure: party:admin
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.deleteRole (person, inherited system stays system)

### first_sign_in

- Starts as: system: new login; hook:new-login
- Person closure: none
- System closure: party:create, identity:bind, party:admin
- Exposed by: in-process only
- Calls: Party.createPerson (person, inherited system stays system)
- Calls: Identity.bindLogin (person, inherited system stays system)
- Calls: ⚙ Party.assignRole (system: default role on first sign-in)

### list_invitations

- Starts as: person
- Person closure: party:admin
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.listInvitations (person, inherited system stays system)

### list_members

- Starts as: person
- Person closure: party:read
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.listMembers (person, inherited system stays system)

### list_people

- Starts as: person
- Person closure: party:admin
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.listPeople (person, inherited system stays system)

### list_permissions

- Starts as: person
- Person closure: party:read
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.myAccess (person, inherited system stays system)

### list_roles

- Starts as: person
- Person closure: party:read
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.listRoles (person, inherited system stays system)

### make_booking

- Starts as: person
- Person closure: bookings:write, party:read, billing:charge
- System closure: none
- Exposed by: web (http: /api)
- Calls: Bookings.book (person, inherited system stays system)
- Calls: Billing.initPayment (person, inherited system stays system)

### my_activity

- Starts as: person
- Person closure: none
- System closure: none
- Exposed by: web (http: /api)
- Calls: AuditTrail.mine (person, inherited system stays system)

### my_bookings

- Starts as: person
- Person closure: bookings:read
- System closure: none
- Exposed by: mcp (mcp: /mcp), web (http: /api)
- Calls: MyStuff.myBookings (person, inherited system stays system)

### my_organisations

- Starts as: person
- Person closure: party:read
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.myOrganisations (person, inherited system stays system)

### my_profile

- Starts as: person
- Person closure: party:read
- System closure: none
- Exposed by: web (http: /api)
- Calls: show_me (person, inherited system stays system)
- Calls: Party.myAccess (person, inherited system stays system)

### nightly_cleanup

- Starts as: system: nightly cleanup; schedule:nightly_cleanup
- Person closure: none
- System closure: billing:expire
- Exposed by: in-process only
- Calls: Billing.expirePending (person, inherited system stays system)

### recent_audit

- Starts as: person
- Person closure: audit:read
- System closure: none
- Exposed by: web (http: /api)
- Calls: AuditTrail.recent (person, inherited system stays system)

### remove_member

- Starts as: person
- Person closure: party:admin
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.unrelate (person, inherited system stays system)

### revoke_invitation

- Starts as: person
- Person closure: party:admin
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.revokeInvitation (person, inherited system stays system)

### revoke_role

- Starts as: person
- Person closure: party:admin
- System closure: none
- Exposed by: web (http: /api)
- Calls: Party.revokeRole (person, inherited system stays system)

### show_booking

- Starts as: person
- Person closure: bookings:read, party:read
- System closure: none
- Exposed by: mcp (mcp: /mcp), web (http: /api)
- Calls: Bookings.get (person, inherited system stays system)

### sign_in

- Starts as: system: public sign_in; public sign_in
- Person closure: none
- System closure: identity:sign-in
- Exposed by: web (http: /api)
- Calls: Identity.signIn (person, inherited system stays system)

### sign_out

- Starts as: person
- Person closure: none
- System closure: none
- Exposed by: web (http: /api)

### sign_up

- Starts as: system: public sign_up; public sign_up
- Person closure: none
- System closure: identity:create
- Exposed by: web (http: /api)
- Calls: Identity.signUp (person, inherited system stays system)
