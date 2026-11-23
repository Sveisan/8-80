import type { Recap, RecapPart } from '../recap/compose.ts';

export const pilotFollowupVersion = 'weekly-pilot-followup-2026-11-23-v5';
export const pilotFollowupFrom = '8&80 <hei@mail.8and80.me>';
export const pilotFollowupApproved = () => process.env['WEEKLY_PILOT_FOLLOWUP_APPROVED'] === pilotFollowupVersion &&
  process.env['RECAP_FROM_ADDRESS'] === pilotFollowupFrom;

export const pilotFollowupConsentTitle = 'Keep what matters in view';
export const pilotFollowupConsent = 'Email me up to two notes after my free call, with a reflection prompt and the option to subscribe to 8&80 or explore Unblock. Optional. Unsubscribe anytime.';
export const pilotFollowupReplyTo = 'hei@8and80.me';

export function pilotFollowupLetter(stage: 'before' | 'after', base: string, id: string, name?: string | null): Recap {
  const before = stage === 'before';
  const firstName = name?.trim().split(/\s+/)[0];
  const greeting = firstName && /^[\p{L}\p{M}’'-]{1,40}$/u.test(firstName) ? `Hi ${firstName},` : 'Hi,';
  const subject = before ? 'What do you want to make time for?' : 'What stayed with you after our call?';
  const parts: RecapPart[] = [
    { role: 'body', text: greeting },
    { role: 'body', text: before
      ? 'When you’re consistent, the days look the same and the years look different. When you’re inconsistent, the days look different and the years look the same.'
      : 'Sometimes a conversation ends and one thought keeps coming back. Was there anything from our call that stayed with you?' },
    { role: 'body', text: before
      ? 'What’s one thing from our conversation you’d like to keep showing up for so next year looks different? Maybe it’s something you’ve wanted to start for years, or something you want more of in your everyday life. If you’d like to keep going, we can pick it up together and find one small step that fits the week you actually have.'
      : 'If there’s something you’d still like to do, what would make the next step easier? You can reply with a line or choose a quick answer below.' },
    { role: 'signoff', text: 'The 8&80 team' },
  ];
  const route = `${base}/pilot-followup/${id}`;
  const action = before ? { label: 'Continue with 8&80', url: `${base}/me` } : { label: 'Share a quick answer', url: `${route}/feedback` };
  const actionNote = before ? 'NOK 189 for your first paid month, then NOK 249 a month until you cancel.' : undefined;
  const postscript = 'P.S. If you’d prefer to focus on one specific change, Unblock helps you take it one step at a time.';
  const unsubscribeUrl = `${route}/unsubscribe`;
  const footerLinks = [
    { label: 'Read about Unblock', url: `${base}/unblock` },
    ...(!before ? [{ label: 'Return to your 8&80 account', url: `${base}/me` }] : []),
    { label: 'Unsubscribe from these follow-ups', url: unsubscribeUrl },
  ];
  const body = [...parts.slice(0, -1).map(p => p.text), `${action.label} — ${action.url}`, ...(actionNote ? [actionNote] : []), parts.at(-1)!.text, postscript,
    ...footerLinks.map(link => `${link.label} — ${link.url}`)].join('\n\n');
  return { subject, parts, body, action, ...(actionNote ? { actionNote } : {}), postscript, footerLinks, unsubscribeUrl, replyTo: pilotFollowupReplyTo };
}
