# Tax presentation · next owner review

20 November 2026. **Proposal, not approved or applied.** The owner approved NOK 249/month for up to four regular calls, with the opening conversation and optional light calls included. Enrolment stays closed. This document proposes how to present that price; it does not classify the service for VAT or authorise a tax-setting change.

## Read-only findings

- The configured live Stripe product has an active monthly NOK 249 price. Its `tax_behavior` is `unspecified`. No price, payment-link, tax or customer object was changed.
- The public Brønnøysund register lists the configured controller as VAT-registered and its name matches the configured company. This is not verification that the Stripe merchant is the same legal seller; that remains a separate commercial check.
- The existing restricted Stripe key can read the product/price. Account and payment-link settings were not verified with that key, so no automatic-tax or effective checkout-tax claim is made.

## Proposed decision

Keep **NOK 249 as the total monthly consumer price**, with applicable VAT included rather than added at checkout. Display: **“NOK 249/month, including applicable VAT.”** Show the applicable VAT breakdown separately on the receipt/invoice once the seller and service's treatment are confirmed.

If the sale is subject to the standard 25% rate, the breakdown is NOK 199.20 net + NOK 49.80 VAT = NOK 249.00 total. Do not use that breakdown until the actual legal seller and VAT treatment are confirmed. Do not describe the service as VAT-exempt simply because the current Stripe price has unspecified tax behaviour.

After owner approval, align the Stripe price/tax settings, checkout, site copy and receipts with the confirmed treatment while preserving the total price. Merchant identity, exact refund/withdrawal terms, qualified review and final activation remain separate. No tax settings change as part of the preceding four-call package implementation.

## Primary sources checked 20 November 2026

- [Norwegian price-information regulation](https://lovdata.no/forskrift/2012-11-14-1066) requires stated consumer prices to include VAT and public charges.
- [Skatteetaten VAT rates](https://www.skatteetaten.no/satser/merverdiavgift/) gives the standard 25% rate; this does not establish this service's classification.
- [VAT registration](https://www.skatteetaten.no/bedrift-og-organisasjon/avgifter/mva/registrere-endre-slette/) explains registration and that VAT must not be invoiced before registration.
- [Stripe tax behaviour](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior) distinguishes inclusive and exclusive tax handling. Configuration must match the confirmed tax treatment.
