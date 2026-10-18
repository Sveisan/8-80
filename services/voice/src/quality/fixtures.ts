import type {CallTranscript,Turn} from '../call/outcome.ts';
import type {QualityContext} from './weekly.ts';
const transcript=(turns:Turn[]):CallTranscript=>({providerCallId:'synthetic',durationMs:240_000,turns});
const agent=(text:string):Turn=>({speaker:'agent',text});
const caller=(text:string):Turn=>({speaker:'caller',text});
export const qualityFixtures:{id:string;context:QualityContext;transcript:CallTranscript}[]=[
  {id:'return-natural-close',context:{kind:'return',priorCommitment:'send the draft'},transcript:transcript([
    agent('Last week you chose to send the draft. How did it go?'),caller('I sent it on Tuesday.'),
    agent('You got it out while it was still unfinished.'),caller('Yes. That felt good.'),
    agent('What would you like to move forward this week?'),caller('Ask for feedback.'),agent('Thanks for today. Speak next week.')])},
  {id:'stacked-questions',context:{kind:'first'},transcript:transcript([
    agent('What did you enjoy at eight? Who were you with? Why did it matter?'),caller('Football with friends.')])},
  {id:'repeated-question',context:{kind:'return'},transcript:transcript([
    agent('What got in the way?'),caller('The meeting ran late.'),agent('What got in the way?'),caller('The same meeting.')])},
  {id:'question-chain-needs-listening',context:{kind:'return'},transcript:transcript([
    agent('What happened this week?'),caller('I finished a draft.'),agent('What helped you start?'),caller('A clear deadline.'),
    agent('What was difficult about it?'),caller('Finding quiet time.'),agent('What did you do next?'),caller('I sent it.')])},
  {id:'no-action-by-choice',context:{kind:'return',priorCommitment:'(nothing recorded)'},transcript:transcript([
    agent('What would make this conversation useful today?'),caller('Just thinking aloud. I do not want an action this week.'),
    agent('We can leave it there.'),caller('Thank you.'),agent('Thanks for today. Take care.')])},
  {id:'eight-eighty-perspectives',context:{kind:'first'},transcript:transcript([
    agent('What did you love doing when you were eight?'),caller('Drawing stories.'),agent('Making something of your own.'),caller('Exactly.'),
    agent('Looking back at eighty, what would you want to have made room for?'),caller('Time for creative work and my family.'),
    agent('There is room for both in what you described.'),caller('Yes.'),agent('Which would you most like to see move in the next three months?'),caller('Creative work.')])},
];
