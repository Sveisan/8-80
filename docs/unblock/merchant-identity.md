# Merchant identity · owner-approved

21 November 2026. **Owner-approved:** “Yes, approve Nerd Valley AS as seller and data controller, using the registered address and support email above. Go ahead and implement it, then let’s review refund and withdrawal terms.” Price/package and VAT-inclusive presentation are also owner-approved. Enrolment stays closed.

## Approved identity

- Legal seller and data controller: **Nerd Valley AS**.
- Norwegian organisation number: **927 065 223**.
- Registered business address: **Vargveien 1F, 0139 Oslo, Norway**, as currently listed in the official register.
- Customer support: **hei@8and80.me**.

The public terms previously used the same company, organisation number and support address, but a different business address: Kongens Gate 6, 0153 Oslo. The read-only [Brønnøysund check](https://data.brreg.no/enhetsregisteret/api/enheter/927065223) on 20 November confirmed the company/organisation number and VAT registration and listed Vargveien 1F. The owner has now explicitly approved using that registered address. Do not ask for this identity/address approval again.

## Implementation scope

The Unblock terms explicitly identify the seller through the existing configured company fields. The shared public terms and privacy page use those same fields; updating the company's registered address therefore changes that factual address for all products, without changing their contracts, subscriptions, consent or records. Apply only the approved company identity fields in the private production configuration, preserving all other environment values and verifying the rendered legal pages after restart.

Owner approval and the public register are not evidence of the actual Stripe account's legal seller. Compare the legal seller, organisation/VAT number and customer-facing support identity in Stripe checkout and receipts with the approved public identity. The existing restricted key cannot read the Stripe account/payment-link settings or update the price; a Stripe administrator must complete that verification and the inclusive-tax/receipt setup. No broader key or Dashboard access is requested by this identity change.

Next owner review: [refund and withdrawal terms](refund-withdrawal.md). This identity approval does not decide the service's VAT classification, refund/withdrawal terms, qualified legal/privacy review or activation. No live charge, call, email or SMS is needed to approve the identity.
