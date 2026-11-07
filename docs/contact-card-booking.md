# Contact card in the first-call journey

After a first booking is verified, show the dated appointment first and then a
short optional invitation to save 8&80, with a prominent download link. The card
already holds the service name and number; the caller saves it in their phone's
contacts app. The booking never depends on saving it.

Append one short contact reminder and the direct public download to the existing
booking-confirmation SMS. Keep its appointment and move/stop link. No extra SMS
is sent. The recap of the first completed call also includes the reminder and a
descriptive link in HTML and plain text, without repeating it in later recaps.

Offer message links only when an E.164 service number and a valid HTTPS public
URL are configured. The public card link contains no account token or personal
data. The established transactional outbox and duplicate-webhook protection own
delivery; no backfill or message to existing callers is triggered by deployment.

The conversation prompts, memory/result templates, readiness flags and existing
dialogue-test findings are unchanged.

If no action day was named, the recap uses the existing generic subject rather
than an empty one; current calls do not require choosing a day for the action.
