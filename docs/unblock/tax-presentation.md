# Tax presentation · owner-approved

20 November 2026. **Owner-approved:** “Yes, approve NOK 249/month including applicable VAT, with VAT itemised on the receipt. Go ahead and implement it, then let’s review merchant identity.” This is the final monthly consumer total for up to four regular calls, with the opening conversation and optional light calls included. Enrolment stays closed. This approval fixes gross-price presentation; it does not confirm the legal seller or classify the service for VAT.

## Read-only findings

- The configured live Stripe product has an active monthly NOK 249 price. Its `tax_behavior` is `unspecified`. No price, payment-link, tax or customer object was changed.
- The public Brønnøysund register lists the configured controller as VAT-registered and its name matches the configured company. This is not verification that the Stripe merchant is the same legal seller; that remains a separate commercial check.
- The existing restricted Stripe key can read the product/price. Account and payment-link settings were not verified with that key, so no automatic-tax or effective checkout-tax claim is made.

## Approved decision

Keep **NOK 249 as the total monthly consumer price**, with applicable VAT included rather than added at checkout. Display: **“NOK 249/month, including applicable VAT.”** Show the applicable VAT breakdown separately on the receipt/invoice once the seller and service's treatment are confirmed.

If the sale is subject to the standard 25% rate, the breakdown is NOK 199.20 net + NOK 49.80 VAT = NOK 249.00 total. Do not use that breakdown until the actual legal seller and VAT treatment are confirmed. Do not describe the service as VAT-exempt simply because the current Stripe price has unspecified tax behaviour.

## Implementation and remaining provider work

- The public landing, about page and account purchase view state that the configured monthly price includes applicable VAT. The Unblock terms state NOK 249/month including applicable VAT and receipt itemisation. No rate or fabricated VAT amount is shown. The remaining old 1–8/second-day/evening descriptions are aligned with the approved four-call/daytime package.
- A read-validated update of only the configured live NOK 249 monthly price's `tax_behavior` to `inclusive` was attempted under the owner's approval. The existing restricted Stripe key returned **HTTP 403** on 20 November. **No provider object changed**; its behaviour remains `unspecified`. No credentials were expanded or copied locally, and no charge or message was created.
- Checkout's effective tax settings and receipt VAT itemisation remain **unverified and unfinished**. Once the actual seller and service treatment are confirmed, an authorised Stripe administrator must set the Unblock price inclusive, configure applicable tax calculation/itemisation, and verify checkout and a receipt at a NOK 249 total. Do not apply a shared account-wide default that could alter weekly 8&80 or Beliefs. Do not treat the site wording or owner approval as provider verification.
- `UNBLOCK_PRICE_VERIFIED` must remain false until the final checkout total and itemised receipt have been verified against the confirmed seller and tax treatment. All five Unblock launch flags also stay off. No new live test is authorised here.

Merchant/controller identity and registered address were owner-approved on 21 November; see [merchant identity](merchant-identity.md). Stripe identity comparison and effective tax/receipt setup remain unverified. Next owner review: [refund and withdrawal terms](refund-withdrawal.md). Qualified review and activation remain separate.

## Primary sources checked 20 November 2026

- [Norwegian price-information regulation](https://lovdata.no/forskrift/2012-11-14-1066) requires stated consumer prices to include VAT and public charges.
- [Skatteetaten VAT rates](https://www.skatteetaten.no/satser/merverdiavgift/) gives the standard 25% rate; this does not establish this service's classification.
- [VAT registration](https://www.skatteetaten.no/bedrift-og-organisasjon/avgifter/mva/registrere-endre-slette/) explains registration and that VAT must not be invoiced before registration.
- [Stripe tax behaviour](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior) distinguishes inclusive and exclusive tax handling. Configuration must match the confirmed tax treatment.
