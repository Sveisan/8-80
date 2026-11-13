import { promptPack } from '../agent/prompt-pack.ts';
import { dialogueCases } from './dialogue-cases.ts';
import { dialogueRoles, nativeDialogueDefinition } from './dialogue-native.ts';

/** Source-only export. Routing IDs, credentials and caller memory are absent;
 * service-level spoken settings remain in the rendered source. The provider
 * harness binds private targets separately. */
export function nativeDialoguePlan(sourceCommit: string) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('A complete source revision is required.');
  const specs = [...promptPack('weekly', {}), ...promptPack('weekly-female', {})];
  const definitions = dialogueRoles.flatMap(role => dialogueCases
    .filter(c => !('requiresTools' in c) && (c.kind === 'both' || c.kind === (role.endsWith('first') ? 'first' : 'return')))
    .map(c => ({role,case:c.id,definition:nativeDialogueDefinition(role,c.id)})));
  return {version:2,sourceCommit,specs,cases:dialogueCases,definitions,voiceVerified:false};
}
