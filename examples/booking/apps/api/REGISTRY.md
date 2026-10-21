# Registry

## Nodes

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

### MyStuff.myBookings

- Permission: bookings:read
- Called by: my_bookings

### Party.createPerson

- Permission: party:create
- Called by: first_sign_in

### book_for_partner

- Permission: none
- Called by: none
- Calls: Bookings.book (person, inherited system stays system)

### cancel_booking

- Permission: none
- Called by: none
- Calls: Bookings.cancel (person, inherited system stays system)
- Calls: ⚙ Billing.refund (system: refund after cancel)

### first_sign_in

- Permission: none
- Called by: none
- Calls: Party.createPerson (person, inherited system stays system)
- Calls: Identity.bindLogin (person, inherited system stays system)

### make_booking

- Permission: none
- Called by: none
- Calls: Bookings.book (person, inherited system stays system)
- Calls: Billing.initPayment (person, inherited system stays system)

### my_bookings

- Permission: none
- Called by: none
- Calls: MyStuff.myBookings (person, inherited system stays system)

### nightly_cleanup

- Permission: none
- Called by: none
- Calls: Billing.expirePending (person, inherited system stays system)

### show_booking

- Permission: none
- Called by: none
- Calls: Bookings.get (person, inherited system stays system)

## Entries

### make_booking

- Starts as: person
- Person closure: bookings:write, billing:charge
- System closure: none
- Exposed by: web (/api)

### book_for_partner

- Starts as: person
- Person closure: bookings:write
- System closure: none
- Exposed by: partner (/partner)

### cancel_booking

- Starts as: person
- Person closure: bookings:cancel
- System closure: billing:refund
- Exposed by: web (/api)

### show_booking

- Starts as: person
- Person closure: bookings:read
- System closure: none
- Exposed by: web (/api), mcp (/mcp)

### my_bookings

- Starts as: person
- Person closure: bookings:read
- System closure: none
- Exposed by: web (/api), mcp (/mcp)

### first_sign_in

- Starts as: system: new login; hook:new-login
- Person closure: none
- System closure: party:create, identity:bind
- Exposed by: in-process only

### nightly_cleanup

- Starts as: system: nightly cleanup; schedule:nightly_cleanup
- Person closure: none
- System closure: billing:expire
- Exposed by: in-process only
