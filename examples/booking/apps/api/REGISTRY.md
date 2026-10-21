# Registry

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

### MyStuff.myBookings

- Permission: bookings:read
- Called by: my_bookings

### Party.createPerson

- Permission: party:create
- Called by: first_sign_in

## Features

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
- System closure: party:create, identity:bind
- Exposed by: in-process only
- Calls: Party.createPerson (person, inherited system stays system)
- Calls: Identity.bindLogin (person, inherited system stays system)

### nightly_cleanup

- Starts as: system: nightly cleanup; schedule:nightly_cleanup
- Person closure: none
- System closure: billing:expire
- Exposed by: in-process only
- Calls: Billing.expirePending (person, inherited system stays system)
