# Registry

## Permissions

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
- party:read
- party:update

## Operations

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

### Bookings.cancel

- Permission: bookings:cancel
- Called by: cancel_booking

### Bookings.get

- Permission: bookings:read
- Called by: show_booking

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

### Party.assignRole

- Permission: party:admin
- Called by: assign_role, first_sign_in

### Party.createOrganisation

- Permission: party:admin
- Called by: none

### Party.createPerson

- Permission: party:create
- Called by: first_sign_in

### Party.defineRole

- Permission: party:admin
- Called by: define_role

### Party.deleteRole

- Permission: party:admin
- Called by: none

### Party.isRelated

- Permission: party:read
- Called by: none

### Party.listRoles

- Permission: party:read
- Called by: list_roles

### Party.relate

- Permission: party:admin
- Called by: none

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
- Called by: none

### rename_person

- Permission: party:update
- Called by: none

### show_me

- Permission: party:read
- Called by: none

### show_person

- Permission: party:read
- Called by: none

## Features

### sign_up

- Starts as: system: public sign_up; public sign_up
- Person closure: none
- System closure: identity:create
- Exposed by: web (/api)
- Calls: Identity.signUp (person, inherited system stays system)

### sign_in

- Starts as: system: public sign_in; public sign_in
- Person closure: none
- System closure: identity:sign-in
- Exposed by: web (/api)
- Calls: Identity.signIn (person, inherited system stays system)

### sign_out

- Starts as: person
- Person closure: none
- System closure: none
- Exposed by: web (/api)

### change_password

- Starts as: person
- Person closure: identity:update
- System closure: none
- Exposed by: web (/api)
- Calls: Identity.changePassword (person, inherited system stays system)

### make_booking

- Starts as: person
- Person closure: bookings:write, billing:charge
- System closure: none
- Exposed by: web (/api)
- Calls: Bookings.book (person, inherited system stays system)
- Calls: Billing.initPayment (person, inherited system stays system)

### book_for_partner

- Starts as: person
- Person closure: bookings:write
- System closure: none
- Exposed by: partner (/partner)
- Calls: Bookings.book (person, inherited system stays system)

### cancel_booking

- Starts as: person
- Person closure: bookings:cancel
- System closure: billing:refund
- Exposed by: web (/api)
- Calls: Bookings.cancel (person, inherited system stays system)
- Calls: ⚙ Billing.refund (system: refund after cancel)

### show_booking

- Starts as: person
- Person closure: bookings:read
- System closure: none
- Exposed by: web (/api), mcp (/mcp)
- Calls: Bookings.get (person, inherited system stays system)

### my_bookings

- Starts as: person
- Person closure: bookings:read
- System closure: none
- Exposed by: web (/api), mcp (/mcp)
- Calls: MyStuff.myBookings (person, inherited system stays system)

### first_sign_in

- Starts as: system: new login; hook:new-login
- Person closure: none
- System closure: party:create, identity:bind, party:admin
- Exposed by: in-process only
- Calls: Party.createPerson (person, inherited system stays system)
- Calls: Identity.bindLogin (person, inherited system stays system)
- Calls: ⚙ Party.assignRole (system: default role on first sign-in)

### nightly_cleanup

- Starts as: system: nightly cleanup; schedule:nightly_cleanup
- Person closure: none
- System closure: billing:expire
- Exposed by: in-process only
- Calls: Billing.expirePending (person, inherited system stays system)

### define_role

- Starts as: person
- Person closure: party:admin
- System closure: none
- Exposed by: web (/api)
- Calls: Party.defineRole (person, inherited system stays system)

### list_roles

- Starts as: person
- Person closure: party:read
- System closure: none
- Exposed by: web (/api)
- Calls: Party.listRoles (person, inherited system stays system)

### assign_role

- Starts as: person
- Person closure: party:admin
- System closure: none
- Exposed by: web (/api)
- Calls: Party.assignRole (person, inherited system stays system)

### revoke_role

- Starts as: person
- Person closure: party:admin
- System closure: none
- Exposed by: web (/api)
- Calls: Party.revokeRole (person, inherited system stays system)
