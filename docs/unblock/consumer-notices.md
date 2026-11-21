# Consumer notice drafts · final send approval pending

Version: unblock-consumer-2026-11-21. **Not approved; not sent.** The exact-version consumer-notice gate remains off. No attachment is used: the full information is in the contract email body and is also downloadable in the private account. Dates/reference below are examples, not a real booking or recipient.

## Envelope and bounded sending rule

- Sender account/from: **8&80 <hei@mail.8and80.me>**.
- Reply-To: **hei@8and80.me**, the approved monitored support contact.
- Recipient rule: only the contract email explicitly entered and confirmed twice by the phone-verified buyer during their own pre-payment review. It is stored separately from the weekly-call email. Example recipient: subscriber@example.com. No CC/BCC, operator copy, marketing or reflection content.
- Contract trigger: the app has recorded canonical provider subscription/invoice evidence for this reviewed contract. One deterministic outbox intent per contract; retries keep the same transport identity. Queue/acceptance is not delivery. Calls remain held until information delivery and the early-start/deadline condition are met.
- Withdrawal trigger: that authenticated customer submits withdrawal, or a human records a clear customer notice. One acknowledgement per request; a retry does not move the deadline. This says receipt, not completed cancellation/refund. A late contract email explicitly states when withdrawal has already been requested.
- Approval requested is for these exact versioned templates **and this automatic customer-initiated delivery rule**, as a bounded exception to per-message final approval in the root AGENTS.md. It authorises no other email/SMS or activation. Keep the gate off until this approval is explicit.

## 1. Contract confirmation

To: subscriber@example.com (example only)
From: 8&80 <hei@mail.8and80.me>
Reply-To: hei@8and80.me
Subject: Your Unblock subscription and withdrawal rights
Attachments: none

```text
Your Unblock subscription
Contract entered into: 2026-11-23T10:00:00.000Z.
Initial withdrawal deadline: 2026-12-07T22:59:59.999Z (deadline calculated in Europe/Oslo). A later information delivery or mandatory extension cannot shorten your rights.
Early start requested: yes; this does not waive withdrawal or the full initial refund.

UNBLOCK SUBSCRIPTION TERMS — unblock-consumer-2026-11-21
Seller and data controller: Nerd Valley AS (org. nr. 927 065 223), Vargveien 1F, 0139 Oslo. Support: hei@8and80.me.

English-speaking adults currently in Norway. AI phone conversations for self-reflection, not therapy or an emergency service. No particular result is promised. Opening: about 15–20 minutes. Regular calls: about 10–15 minutes. Optional light calls: about a minute. Calling hours: weekdays 09:00–16:30 Europe/Oslo; human coverage 09:00–17:00. Choose your times in your account.

NOK 249 per month, including applicable VAT, itemised on the receipt. Up to four regular calls per billing month; opening and optional light calls included. Automatically renews monthly until cancelled. No minimum term beyond the paid month. Cancel renewal in your verified Unblock account; confirmation requires the payment provider. Ordinary cancellation keeps access until the paid period ends. Pausing calls continues billing. Calls do not begin until payment and the required information are confirmed. Unblock does not subscribe you to weekly 8&80 or Beliefs.

WITHDRAWAL AND REFUNDS
You may withdraw without giving a reason within 14 days after the subscription contract is entered into. The contract is entered into when the provider accepts your subscription checkout, recorded by its subscription-creation timestamp. Pre-payment scheduling or reviewing terms does not itself charge you. Later payment settlement or webhook delivery does not postpone the recorded contract date. The starting day is excluded, and a final non-working day extends to the next working day under the applicable deadline rules. Mandatory extensions for missing information and other consumer rights are preserved.
For launch, we refund the full initial NOK 249 payment even after calls during that window, with no deduction or fee. Starting early does not waive this policy. Early calls require your separate explicit request; otherwise calls wait until the initial withdrawal period ends.
Withdraw through the distinct account action or send a clear statement to hei@8and80.me. The form below is optional. Withdrawal stops new Unblock calls and initiates stopping renewal. We acknowledge the request separately from provider-confirmed cancellation and refund. Payments are returned without undue delay, no later than 14 days after receipt of a valid withdrawal notice, using the original payment method unless you expressly agree otherwise.
Outside withdrawal, ordinary unused time or missed calls do not automatically receive a pro-rata refund. This does not limit statutory rights. When we cannot supply paid service through our fault, we offer a proportionate monetary refund, or the full month if that month cannot be provided. Credits are not compulsory. Contact support about duplicate/incorrect charges or other complaints; statutory claim periods are not shortened.

YOUR ACCOUNT
You may pass on a question, end a call, pause calls, export your records or delete your account. Deletion and withdrawing from the contract are separate. STOP stops calls/texts to the shared number but does not itself cancel subscription renewal. Complaint routes and statutory consumer remedies remain available, including Forbrukertilsynet.

WITHDRAWAL FORM (optional: a clear email is also sufficient)
To: Nerd Valley AS, Vargveien 1F, 0139 Oslo, hei@8and80.me

I hereby withdraw from my Unblock subscription.
Contract date: __________
Consumer name: __________
Consumer address: __________
Account email or other account reference: __________
Date: __________
Signature (only for a paper form): __________

PRIVACY SNAPSHOT
# Privacy

Draft updated 21 November 2026; operational wording requires review before release.

Nerd Valley AS (org. nr. 927 065 223), at Vargveien 1F, 0139 Oslo, is the data controller. Write to
hei@8and80.me about anything on this page.

This is written to be accurate rather than broad. Where another privacy policy
would say "we may collect information including but not limited to", this says
what is in the database, column by column.

## What we hold about you

**Your phone number**, twice: once hashed, which is what we look you up by, and
once encrypted, because at some point we have to dial it. The hash is
deterministic, which is the point and also its limit — anybody already holding
your number could confirm it is in here, which is true of any system that can
recognise you.

**Your email address**, encrypted. **Your name**, if supplied, is not encrypted.
Signup asks for your first name. It is optional and is passed to our voice provider
for the greeting and close. Older signups or an operator may have supplied a fuller
name; only the first name is passed to the voice provider.

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
your next call waits until they have, and no automatic email or text goes out
about that call. The person (or, when they are away, one named stand-in) is told
only that a call needs review; nothing from the call is sent to them. After
reading it, they may send you one short text with free helpline numbers, and keep
your calls paused until you want them back; we store when that text was sent. If
you reply, a person reads your reply in our text provider's message log and
answers it — it is not read by the automatic replies.

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

**Optional product feedback.** If you open the Feedback button, a functional cookie
lets this browser submit, review and remove its reports for 30 days. We encrypt your
comment and any screenshot you deliberately attach, and keep them for up to 30 days.
We retain a broad page category, screen dimensions, release version and processing
status; we do not capture page contents, form fields or URL credentials. A daily
rotating hash limits submissions without retaining the IP address. Reports linked
to a verified weekly browser are included in account export and removed with the
account. Other reports can be removed from the same browser, or expire automatically. GitHub stores only an
opaque ticket reference in a private tracker. A restricted automated development
workflow using GitHub and OpenAI may read the report to prepare a fix and tests;
private processing artifacts and logs expire after one day. A processing copy can
remain until then after you remove the report. Proposed code changes require
manual approval before release. The original report and screenshot must not enter public code, tests, issues or PRs.

**Optional encouragement by SMS.** Messages are off until you opt in on
My page. We store frequency, tone, selected message types, quiet hours and timezone,
strong-language choice, pause state and when you opted in. Your optional chosen
focus and composed message text are encrypted. Recognition uses only an action
you have reported completing; we do not infer your mood or invent progress.
Messages and your optional “more like this” / “less like this” feedback are retained
for 30 days. Feedback adjusts eligible wording within your choices; pilot and
adaptive results are separated in aggregate reports. Preferences remain until you
change them or delete the account. You can pause or stop encouragement on My page.
Replying STOP stops calls and all SMS. Account export and deletion cover these records.

**Feature tips and requested reminders.** We keep your preference for tips, a fixed
sequence identifier and the topics already shown or declined until you delete your
account, so we do not repeat them. Account-linked A/B assignments and tip offers,
agent reports, transcript-confirmed exposure and explicit responses last 60 days.
Aggregate experiment counters and frozen results contain no account identifiers.
For one reminder you explicitly request, we encrypt the chosen SMS text and store
its agreed local timezone, instant, revision and delivery state. It can be changed
or cancelled in a phone conversation before provider acceptance. Preparing a draft
does not schedule anything: it expires after ten minutes. Encrypted tool receipts
last one day for safe retries; reminder status lasts up to 30 days after its final
update. Text is cleared on acceptance, cancellation or suppression, or after its
15-minute delivery window. Scheduled reminders use the same SMS supplier as other
texts and do not subscribe you to recurring messages.

**Call recordings are not stored by us; transcripts are retained for fourteen days.** Our voice
supplier sends us a transcript when a call ends, we take the one commitment
(and the answers above, when they were read back to you) out of it, and the raw
delivery is kept encrypted for fourteen days so a broken
call can be debugged, then deleted automatically. Fourteen days is long enough
to fix last week's call and short enough not to be a record of you.

**Advisory call-quality results.** When enabled, we retain model scores and review states for up to fourteen days. A short recap excerpt waits encrypted for the background review and is cleared immediately after its single attempt, or at expiry. Review results and queued excerpts are included in your export and removed with your account.

## What we do not hold

No password. No postal address or card details. No
call recordings. No transcript older than fourteen days. Nothing from your
phone beyond the number you gave us.

## Why

To ring you when you asked, to remember what you said last week so the call is
worth having, to email you the recap the call promises, to text you when a call
is missed, to take payment, and, when enabled, to identify unnecessary repeated
questions and unsupported recap claims. We do not profile you for advertising,
we do not advertise, and we do not sell your data or share it for advertising.

## Who else sees it

Our service suppliers:

- **Speechify** place the calls and produce the transcript. They receive your
  number, which call number this is, your last commitment and the day you named
  for it, your eight and eighty answers, your goals for this year, your onboarding progress, your next appointment, your weekly
  slot, any assumption you are testing, and how many weeks in a row a commitment
  has gone undone — because the mentor has to be able to ask about them — and
  your first name, so it can greet you; never your full name. When enabled, a call-scoped service credential,
  current time and account timezone allow tools to return the selected feature tip,
  reminder text and schedule, and the result of your requested changes. The credential
  expires when the call settles or after at most 45 minutes, and cannot address another account. That is the whole list, and a test fails the
  build if a new field starts going to them without appearing here.
- **TypeSafe (Jev)**, when quality review is enabled, receives the text of completed weekly calls and the conversational paragraphs of their recap to flag unnecessary repeated questions and unsupported recap claims. Phone numbers, email addresses, account identifiers and billing/scheduling paragraphs are not added to this request; personal details spoken in the conversation can still be present. This review does not decide or change your actions, consent, memory, bookings or messages.
- **Twilio** send the texts. They receive your number.
- **Resend** send the email. They receive your address.
- **Google Calendar**, when native calendar invitations are enabled and you opt in,
  receives your invitation address, a generic call title and the appointment time.
  Moving that invitation can update the next call; it does not change your fixed
  weekly time. We read changes to 8&80's own events, not the rest of your calendar.
  We request removal of the organizer's event when you delete your account and
  remove completed organizer events after 30 days. Your calendar provider may
  retain its own copy under its settings.
- **The payment provider shown at checkout (Stripe or Lemon Squeezy)** processes
  payments. It receives the information you submit there. We receive subscription
  and customer ids, status, renewal cancellation and paid-period dates. When you
  choose checkout we pass an opaque caller reference and your recap address to
  match the purchase; we do not send your call notes.

Plus the company hosting the server. Some of these are outside the EEA and
transfer data under the European Commission's standard contractual clauses.

## How long

Your weekly-service record stays until you delete it or ask us to. Beliefs programme content has the separate retention rules below. Transcripts, fourteen days.
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
a fixed event name and time, and an opaque conversation-cycle reference when
needed to distinguish weekly calls from callbacks, not what you said. These measurements are removed
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
hei@8and80.me and we will do it within thirty days, usually the same day.

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


## Separate Beliefs programmes

Each programme has its own identifier, chosen outcome, caller-authored beliefs,
prepared decisions, supporting experiences, remaining difficulty, opportunities,
weekly scores and prior decision versions. Personal practice content is encrypted.
We keep consent, schedule, payment references, refund requests, completion and
included-check-in status separately. Programme activity does not overwrite weekly
8&80 memories or its subscription. Fresh Beliefs phone verification is required
for private history and the complete account export.

An unfinished purchase and its progress do not expire merely through inactivity.
Completed practice history is scheduled for deletion 12 months after completion.
We send a content-free reminder 30 days before the planned date. Your private
account offers export, immediate programme-history deletion and an explicit later
date you choose (shown as a UTC date). An extension is never automatic.
Automatic cleanup also allows at least 30 days after a delivered reminder or your
explicit acknowledgment. Failed or opted-out reminders require support follow-up;
cleanup waits for that opportunity to export or choose. Your account shows the
planned date even when a text cannot be delivered.

Programme-history deletion removes its personal practice and retained application
transcript content. It preserves another programme's history, unfinished progress,
weekly-service data and the minimum record of any unused included return check-in.
Necessary financial records are handled separately under applicable recordkeeping
requirements. A payment record is not a reason to retain personal belief content.
Whole-account deletion remains a distinct action covering all 8&80 services.

Speechify receives the selected programme's practice context and preferred name
for its calls; support email is excluded from voice context. A signed, timestamped
caller turn supported by reconciled caller-owned capture can establish connection
for the refund clock. We do not treat outbound acceptance, a schedule or voicemail
as proof that you received a call. Unknown historical connection timing requires
support review and does not shorten the voluntary guarantee.

Our application cleanup does not establish erasure at independent providers or in
backups. The controller must verify provider retention/deletion, backup expiry,
financial-record periods and the operational handling of failed notices before
publishing the paid programme. These operational details remain under review.

## Separate Unblock programme

Unblock has its own programme identifier and encrypted record: your wish and why
it matters, earlier versions, the blocks you described, agreed steps and outcomes,
moments you noticed, and chapter reflections. Programme notes are confirmed by
readback and agreement; provisional changes are checked against the signed call
transcript before they become your account record. Temporary call transcripts
follow the fourteen-day buffer described above. Closed session receipts remove
the caller utterances used for confirmation.

We also keep the programme's consent version and date, chosen call frequency,
timezone and appointments, optional light-call choices, pause and completion
state, and separate payment-provider subscription references and renewal dates.
An optional contact email is for account support, not automatic call recaps.
Unblock does not overwrite weekly 8&80 memories or its subscription.

Speechify receives the selected Unblock programme context, schedule, and preferred
name for the conversation. Its short-lived call credential permits only that
session's agreed programme actions. Support email and payment details are not
included in voice context. Verification texts contain a code and a permanent
account-management address, never your wish, step, or other private notes.

Unblock private access uses a separate phone-verified credential that lasts one
hour. The private account offers a complete account download, programme pause,
renewal cancellation, and whole-account deletion. Programme history stays
available after cancellation until you delete the account or ask us to remove it;
there is no automatic Unblock history-expiry promise. Contact hei@8and80.me
to correct a note or request removal. Whole-account deletion removes Unblock
alongside weekly and Beliefs records and revokes their access credentials.
Financial records held by the payment provider and provider/backup retention are
handled as described above.


For an urgent Unblock incident, private operational records contain identifiers,
timestamps, fixed action/confirmation categories and a review outcome. They do
not copy transcript or programme notes. Operator acknowledgement and a confirmed
handoff are separate records. Resolved incident metadata is deleted after
30 days; unresolved incidents stay held for human review. Your verified Unblock
account download includes incident records still linked to your calls. Account
erasure removes those links while an unresolved operational block is retained.

## Unblock contract and repayment records

Unblock separately stores the accepted terms version/time, explicit early-start
choice, provider contract/payment references and dates, and the contract email
and complete information snapshot encrypted. This email is used for contractual
notices and does not replace the weekly-call email. Delivery metadata is distinct
from queued/provider-accepted mail. These records and linked refund requests are
included only in a fresh Unblock-verified account export, and are erased with the
account except for the limited repayment obligation below.

A withdrawal records a fixed reason, request/deadline/status, provider invoice and
refund references and amount. It does not store reflection text. Account deletion
removes its account link and contract/contact material; an unresolved repayment
obligation keeps only operational/provider transaction references and amount/time/
status so a human can finish repayment using the provider records. Unlinked
resolved operational records are deleted after 30 days. Linked request history
remains available with the account. Required financial records held by the payment
provider follow the seller's bookkeeping duties and that provider's retention.
The controller must confirm this treatment in the qualified privacy/legal review.

```

Exact conditional substitutions:

- If early start was not requested, the line is: “Early start requested: no; calls wait until the initial withdrawal period ends.”
- If withdrawal already exists before contract evidence arrives, insert after the first line: “Withdrawal already requested on [recorded timestamp]. Calls remain stopped; this records your contract information and does not restart calls.”
- Contract date, computed deadline, company/support identity and the archived information snapshot are the contract's actual values, never the callback arrival date or private reflection content. A content or routing change requires a new approval/version.

## 2. Withdrawal receipt

To: subscriber@example.com (the same confirmed contract email; example only)
From: 8&80 <hei@mail.8and80.me>
Reply-To: hei@8and80.me
Subject: We received your Unblock withdrawal
Attachments: none

```text
Unblock withdrawal received
Reference: EXAMPLE-WITHDRAWAL-REFERENCE
Received: 2026-11-25T10:00:00.000Z
New Unblock calls are stopped. Cancellation of renewal has been requested; this acknowledgement does not claim that the payment provider has confirmed it.
Your request is within the recorded withdrawal window. The full initial payment is due back without a call deduction.
Withdrawal repayment deadline: 2026-12-09T10:00:00.000Z. We return payments without undue delay using the original payment method unless you expressly agree otherwise. This is receipt of your request, not confirmation that money has been refunded.
Support: hei@8and80.me
Seller: Nerd Valley AS, Vargveien 1F, 0139 Oslo.
```

If the recorded window is not established, replace only the entitlement sentence with: “A person will review your withdrawal/refund entitlement; statutory rights and extensions are preserved.” Request reference, receipt time and repayment deadline use the original persisted request; retries never reset them. The downloadable acknowledgement is available even when an email cannot be sent.
