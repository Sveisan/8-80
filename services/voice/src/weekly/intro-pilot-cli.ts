import { config } from '../config.ts';
import { invitationLinks } from './intro-pilot.ts';

try {
  console.log(JSON.stringify(invitationLinks(config.link.publicUrl())));
} catch {
  console.error('Set PUBLIC_URL and a private WEEKLY_PILOT_INVITE_SECRET before generating the links.');
  process.exitCode = 1;
}
