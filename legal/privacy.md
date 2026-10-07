# Privacy

Draft updated 3 October 2026; operational wording requires review before release.

{{company}}{{orgnr_clause}}, at {{address}}, is the data controller. Write to
{{support_email}} about anything on this page.

This is written to be accurate rather than broad. Where another privacy policy
would say "we may collect information including but not limited to", this says
what is in the database, column by column.

## What we hold about you

**Your phone number**, twice: once hashed, which is what we look you up by, and
once encrypted, because at some point we have to dial it. The hash is
deterministic, which is the point and also its limit — anybody already holding
your number could confirm it is in here, which is true of any system that can
recognise you.

**Your email address**, encrypted. **Your name**, if supplied in an older signup or by an operator, is not
encrypted. New signup forms do not ask for it and the mentor does not use it.

**What you said you would do** — the one commitment from each call, in your own
words, encrypted, and only the most recent one. The day you named is kept in
the clear, because a weekday on its own says nothing.

**Your own eight and eighty, and your goals for this year** — on the first call you
are asked what you loved doing at eight, what you want to have done by eighty, and
what you would like to move this year. Your answers, in your own words, encrypted,
so later calls can ask about them. And,
only if you named one and chose to test it, **an assumption about your work**
("nobody will pay for this"), in your own words, encrypted, and only the most
recent one. These are your answers to questions, never a conclusion drawn about
you.

**Your weekly slot**: a weekday, a time, and your timezone, plus your next appointment. We also keep onboarding progress separately from the call counter, so an interrupted introduction can continue. **A counter** of
which call number you are on, how many weeks in a row a commitment went
undone, and how many weeks in all it was done, partly done, or not — counts,
not a record of which week was which.

**A row per call attempt**: when it was scheduled, whether it connected, how
long it ran, and a short note if it failed. Never the words you said — with one
exception that is a flag, not a record: if something said on a call suggests you
might be at risk or unsafe, that call is marked (1 or 2) so a person reads it,
your next call waits until they have, and no email or text goes out about that
call. The person is told only that a call needs review; nothing from the call is
sent to them.

**Billing state**: whether you are on a trial and when it ends, the payment provider, subscription and customer ids, whether renewal is cancelled
and the paid-period boundary returned by the provider. No card details ever reach us — they
never touch our servers at all.

**Your answers to the feedback form**, if you fill it in: after your first call we
send one text, once, asking two questions. What you write is encrypted like everything
else you tell us, kept until you delete everything, and included in your copy. If you
choose to speak an answer instead, your phone's own dictation does the listening — on an
iPhone that is Apple, on Android it is Google, under their terms rather than ours — and
only the resulting words reach us. We never receive or keep a recording.

**Access cookies and codes.** A random browser credential lasts seven days and
opens ordinary call controls. Export, deletion and billing management require a
phone-verified text link. Viewing or correcting saved notes requires a separate
fresh phone code and a 15-minute private session; finishing closes it. These
credentials are revoked on deletion. Recovery codes expire after ten minutes.
We record request times and attempt counts to limit abuse; secret codes are hashed.
We do not use analytics cookies.

**Your feedback preference.** You can stop optional feedback requests separately
from calls, recaps, verification codes and billing notices.

**Call recordings are not stored by us; transcripts are retained for fourteen days.** Our voice
supplier sends us a transcript when a call ends, we take the one commitment
(and the answers above, when they were read back to you) out of it, and the raw
delivery is kept encrypted for fourteen days so a broken
call can be debugged, then deleted automatically. Fourteen days is long enough
to fix last week's call and short enough not to be a record of you.

## What we do not hold

No password. No postal address or card details. No
call recordings. No transcript older than fourteen days. Nothing from your
phone beyond the number you gave us.

## Why

To ring you when you asked, to remember what you said last week so the call is
worth having, to email you the recap the call promises, to text you when a call
is missed, and to take payment. That is the contract between us. We do not
profile you, we do not advertise, and we do not sell or share any of it.

## Who else sees it

Four suppliers, each doing one job:

- **Speechify** place the calls and produce the transcript. They receive your
  number, which call number this is, your last commitment and the day you named
  for it, your eight and eighty answers, your goals for this year, your onboarding progress, your next appointment, your weekly
  slot, any assumption you are testing, and how many weeks in a row a commitment
  has gone undone — because the mentor has to be able to ask about them. Not your name: the mentor never says it, so there
  is no reason to hand it over. That is the whole list, and a test fails the
  build if a new field starts going to them without appearing here.
- **Twilio** send the texts. They receive your number.
- **Resend** send the email. They receive your address.
- **The payment provider shown at checkout (Stripe or Lemon Squeezy)** processes
  payments. It receives the information you submit there. We receive subscription
  and customer ids, status, renewal cancellation and paid-period dates. When you
  choose checkout we pass an opaque caller reference and your recap address to
  match the purchase; we do not send your call notes.

Plus the company hosting the server. Some of these are outside the EEA and
transfer data under the European Commission's standard contractual clauses.

## How long

Your record stays until you delete it or ask us to. Transcripts, fourteen days.
A verification code works for ten minutes. An unverified booking draft can be
recovered for one hour after the latest code request and is removed by the next
scheduled cleanup. A reschedule link lasts a week. The cookie on the browser you signed up with, a week.

If you stop the calls, we keep your record so that starting again is one tap
rather than a re-registration. If you would rather it were gone, say so — see
below — and it is gone.

## Delivery records and service measurement

Transactional messages are queued with encrypted recipients and content. Accepted
or suppressed message content is cleared immediately; other content is cleared by
the cleanup job after its short retry window (ten minutes for phone codes, up to
six hours for texts and 23 hours for email). Delivery and attempt metadata is kept
for up to 30 days, then removed by the scheduled cleanup job.

We keep daily booking/control request counts without visitor identifiers, IPs or
tracking cookies. Account-linked service milestones contain only a lookup key,
a fixed event name and time, not what you said. These measurements are removed
after 60 days by the cleanup job, or with the account. They help us see where the
service fails; they do not tell us whether a conversation was useful.

## Your rights

You can ask for a copy of everything we hold, ask us to correct it, or ask us
to delete it. Deletion stops calls and removes the application profile, personal
notes, feedback, call-attempt history, linked retained call deliveries, pending signup, message records, service milestones
and access credentials. It cannot be undone and it is not a deactivation.

If a subscription exists, we first require the payment provider to confirm that it
will not renew. Calls stop immediately on the confirmed deletion request. If billing confirmation fails, the application record is retained so cancellation
can be resolved; the page tells you this. The provider retains its own transaction
records under its retention obligations. Deleting the application record does not
erase those records or automatically refund a payment.

Your export includes stored personal context, account settings, call history and
linked call data still in the fourteen-day buffer. It excludes secret access codes
and credentials, and omits duplicate copies of earlier export payloads. Retained message and service milestone records are included. Payment-provider records can be requested from that provider.

The fastest way is the page linked in every text we send. Failing that, email
{{support_email}} and we will do it within thirty days, usually the same day.

You can also complain to Datatilsynet, the Norwegian Data Protection Authority.

## Security

Numbers, addresses, commitments and transcripts are encrypted by the
application before they reach the database, with AES-256-GCM, rather than
relying on an encrypted disk underneath it. That is deliberate: the realistic
failure is a compromised application or a query that returns too much, and an
encrypted volume stops neither.

## Children

The service is not for anybody under 18.

## Changes

If this page changes in a way that matters, we will email you.


You can review and correct your saved commitment and goals from “Correct what I remember”
on your call page. This requires a fresh phone code and opens a 15-minute session. Finishing
that session closes access to the notes. Ordinary call-control links do not display them.
