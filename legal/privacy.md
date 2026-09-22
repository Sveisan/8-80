# Privacy

Last updated 22 September 2026.

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

**Your email address**, encrypted. **Your name**, as you typed it, not
encrypted: it is what the mentor calls you and it identifies nobody on its own.

**What you said you would do** — the one commitment from each call, in your own
words, encrypted, and only the most recent one. The day you named is kept in
the clear, because a weekday on its own says nothing.

**Your weekly slot**: a weekday, a time, and your timezone. **A counter** of
which call number you are on, and how many weeks in a row a commitment went
undone.

**A row per call attempt**: when it was scheduled, whether it connected, how
long it ran, and a short note if it failed. Never anything you said.

**Billing state**: whether you are on a trial and when it ends, and Lemon
Squeezy's subscription and customer ids. No card details ever reach us — they
never touch our servers at all.

**Recordings and transcripts of the call are not stored by us.** Our voice
supplier sends us a transcript when a call ends, we take the one commitment out
of it, and the raw delivery is kept encrypted for fourteen days so a broken
call can be debugged, then deleted automatically. Fourteen days is long enough
to fix last week's call and short enough not to be a record of you.

## What we do not hold

No password, because there is no account. No address. No payment details. No
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
  number, your name and your last commitment, because the mentor has to be able
  to say them.
- **Twilio** send the texts. They receive your number.
- **Resend** send the email. They receive your address.
- **Lemon Squeezy** take the payment. They receive whatever you give them at
  checkout; we receive back only an id.

Plus the company hosting the server. Some of these are outside the EEA and
transfer data under the European Commission's standard contractual clauses.

## How long

Your record stays until you delete it or ask us to. Transcripts, fourteen days.
An abandoned sign-up that never confirmed its code, ten minutes. A reschedule
link, a week.

If you stop the calls, we keep your record so that starting again is one tap
rather than a re-registration. If you would rather it were gone, say so — see
below — and it is gone.

## Your rights

You can ask for a copy of everything we hold, ask us to correct it, or ask us
to delete it. Deletion is immediate and total: the row, the attempt history,
the links, all of it. It cannot be undone and it is not a deactivation.

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
