# App map

```text
LAYERS   ways-in → features → operations → modules / read models; composition wires (fixed header,
         not extracted from layout)

WAYS
 mcp  mcp /mcp  [2 features]  src/ways-in/mcp/way.ts
  Mean: ask the human
  ├─ my_bookings  person  src/features/my-bookings/index.ts  needs bookings:read
  │   └─ MyBookings.myBookings
  └─ show_booking  person  src/features/show-booking/index.ts  needs bookings:read party:read
      └─ Bookings.get → Party.isRelated
 new-login  hook slot @house-rules/identity/FirstSignIn  [1 features]
 src/ways-in/hooks/first-sign-in.ts
  Mean: allow
  └─ first_sign_in  system (new login)  src/features/first-sign-in/index.ts  needs none; system
      needs identity:bind party:admin party:create
      ├─ Identity.bindLogin
      ├─ ⚙ Party.assignRole (default role on first sign-in)
      └─ Party.createPerson
 nightly-cleanup  schedule 0 3 * * * UTC  [2 features]  src/ways-in/schedules/nightly-cleanup.ts
  Mean: allow
  ├─ due_payments  system (nightly cleanup)  src/features/due-payments/index.ts  needs none; system
  │   needs billing:expire
  │   └─ Billing.duePayments
  └─ expire_payment  system (nightly cleanup)  src/features/expire-payment/index.ts  needs none;
      system needs billing:expire
      └─ Billing.expireOne
 web  http /api  [26 features]  src/ways-in/web/way.ts
  Mean: allow
  public: sign_in, sign_up
  ├─ accept_invitation  person  src/features/accept-invitation/index.ts  needs party:read; system
  │   needs party:admin
  │   ├─ Party.acceptInvitation
  │   └─ ⚙ Party.assignRole (role delegated by organisation invitation)
  ├─ assign_role  person  src/features/assign-role/index.ts  needs party:admin
  │   └─ Party.assignRole
  ├─ cancel_booking  person  src/features/cancel-booking/index.ts  needs bookings:cancel party:read;
  │   system needs billing:refund
  │   ├─ ⚙ Billing.refund (refund after cancel)
  │   └─ Bookings.cancel → Party.canAdminOrganisation, Party.isRelated
  ├─ change_password  person  src/features/change-password/index.ts  needs identity:update
  │   └─ Identity.changePassword
  ├─ create_invitation  person  src/features/create-invitation/index.ts  needs party:admin
  │   └─ Party.createInvitation
  ├─ create_organisation  person  src/features/create-organisation/index.ts  needs
  │   party:create-organisation; system needs party:admin
  │   ├─ ⚙ Party.assignRole (creator of organisation)
  │   └─ Party.createOrganisation
  ├─ define_role  person  src/features/define-role/index.ts  needs party:admin
  │   └─ Party.defineRole
  ├─ delete_role  person  src/features/delete-role/index.ts  needs party:admin
  │   └─ Party.deleteRole
  ├─ list_invitations  person  src/features/list-invitations/index.ts  needs party:admin
  │   └─ Party.listInvitations
  ├─ list_members  person  src/features/list-members/index.ts  needs party:read
  │   └─ Party.listMembers
  ├─ list_people  person  src/features/list-people/index.ts  needs party:admin
  │   └─ Party.listPeople
  ├─ list_permissions  person  src/features/list-permissions/index.ts  needs party:read
  │   └─ Party.myAccess
  ├─ list_roles  person  src/features/list-roles/index.ts  needs party:read
  │   └─ Party.listRoles
  ├─ make_booking  person  src/features/make-booking/index.ts  needs billing:charge bookings:write
  │   party:read
  │   ├─ Billing.initPayment
  │   └─ Bookings.book → Party.canAdminOrganisation, Party.isRelated
  ├─ my_activity  person  src/features/my-activity/index.ts  needs none
  │   └─ AuditTrail.mine
  ├─ my_bookings  person  src/features/my-bookings/index.ts  needs bookings:read
  │   └─ MyBookings.myBookings
  ├─ my_organisations  person  src/features/my-organisations/index.ts  needs party:read
  │   └─ Party.myOrganisations
  ├─ my_profile  person  src/features/my-profile/index.ts  needs party:read
  │   ├─ Party.myAccess
  │   └─ Party.showMe
  ├─ recent_audit  person  src/features/recent-audit/index.ts  needs audit:read
  │   └─ AuditTrail.recent
  ├─ remove_member  person  src/features/remove-member/index.ts  needs party:admin
  │   └─ Party.unrelate
  ├─ revoke_invitation  person  src/features/revoke-invitation/index.ts  needs party:admin
  │   └─ Party.revokeInvitation
  ├─ revoke_role  person  src/features/revoke-role/index.ts  needs party:admin
  │   └─ Party.revokeRole
  ├─ show_booking  person  src/features/show-booking/index.ts  needs bookings:read party:read
  │   └─ Bookings.get → Party.isRelated
  ├─ sign_in  system (public sign_in)  src/features/sign-in/index.ts  needs none; system needs
  │   identity:sign-in
  │   └─ Identity.signIn
  ├─ sign_out  person  src/features/sign-out/index.ts  needs none
  └─ sign_up  system (public sign_up)  src/features/sign-up/index.ts  needs none; system needs
      identity:create
      └─ Identity.signUp

MODULES
 billing  package [app-owned] @example/billing  examples/booking/packages/billing
  ops: Billing.duePayments Billing.expireOne Billing.initPayment Billing.refund
  called by: cancel_booking due_payments expire_payment make_booking
 bookings  package [app-owned] @example/bookings  examples/booking/packages/bookings
  ops: Bookings.book Bookings.cancel Bookings.get
  Bookings.book → Party.canAdminOrganisation, Party.isRelated
  Bookings.cancel → Party.canAdminOrganisation, Party.isRelated
  Bookings.get → Party.isRelated
  called by: cancel_booking make_booking show_booking
 identity  package [framework] @house-rules/identity  packages/identity
  ops: Identity.bindLogin Identity.changePassword Identity.endSessions Identity.issueToken
       Identity.listTokens Identity.recordTokenUse Identity.revokeToken Identity.signIn
       Identity.signUp
  called by: change_password first_sign_in sign_in sign_up
 party  package [framework] @house-rules/party  packages/party
  ops: Party.acceptInvitation Party.assignRole Party.canAdminOrganisation Party.createInvitation
       Party.createOrganisation Party.createPerson Party.createPrincipal Party.defineRole
       Party.deleteRole Party.disable Party.findPrincipal Party.holdersOf Party.isRelated
       Party.listInvitations Party.listMembers Party.listPeople Party.listRoles Party.lockActive
       Party.myAccess Party.myOrganisations Party.principalsByIds Party.relate Party.renamePerson
       Party.revokeInvitation Party.revokeRole Party.rolesOf Party.showMe Party.showOrganisation
       Party.showPerson Party.unrelate
  called by: Bookings.book Bookings.cancel Bookings.get accept_invitation assign_role
             create_invitation create_organisation define_role delete_role first_sign_in
             list_invitations list_members list_people list_permissions list_roles my_organisations
             my_profile remove_member revoke_invitation revoke_role

READ MODELS
 audit-trail  read-model [app-owned] @example/api  src/read-models/audit-trail
  ops: AuditTrail.mine AuditTrail.recent
  called by: my_activity recent_audit
 my-bookings  read-model [app-owned] @example/api  src/read-models/my-bookings
  ops: MyBookings.myBookings
  called by: my_bookings

PLUGS
 CallAudit.record  fills Record  @house-rules/call-audit
 Identity.who  fills Who on mcp, web  @house-rules/identity
 Mean.allow  fills Mean on new-login, nightly-cleanup, web  @house-rules/application
 Mean.elicitation  fills Mean on mcp  @house-rules/application
 Party.may  fills May  @house-rules/party
 hook:new-login  fills @house-rules/identity/FirstSignIn on new-login

PERMISSIONS
 audit:read ← AuditTrail.recent
 billing:charge ← Billing.initPayment
 billing:expire ← Billing.duePayments, Billing.expireOne
 billing:refund ← Billing.refund
 bookings:cancel ← Bookings.cancel
 bookings:read ← Bookings.get, MyBookings.myBookings
 bookings:write ← Bookings.book
 identity:bind ← Identity.bindLogin
 identity:create ← Identity.signUp
 identity:sessions-end ← Identity.endSessions
 identity:sign-in ← Identity.signIn
 identity:tokens-issue ← Identity.issueToken
 identity:tokens-read ← Identity.listTokens
 identity:tokens-revoke ← Identity.revokeToken
 identity:tokens-use ← Identity.recordTokenUse
 identity:update ← Identity.changePassword
 party:admin ← Party.assignRole, Party.createInvitation, Party.defineRole, Party.deleteRole,
               Party.listInvitations, Party.listPeople, Party.relate, Party.revokeInvitation,
               Party.revokeRole, Party.unrelate
 party:create ← Party.createPerson, Party.createPrincipal
 party:create-organisation ← Party.createOrganisation
 party:read ← Party.acceptInvitation, Party.canAdminOrganisation, Party.findPrincipal,
              Party.holdersOf, Party.isRelated, Party.listMembers, Party.listRoles,
              Party.lockActive, Party.myAccess, Party.myOrganisations, Party.principalsByIds,
              Party.rolesOf, Party.showMe, Party.showOrganisation, Party.showPerson
 party:update ← Party.disable, Party.renamePerson
```
