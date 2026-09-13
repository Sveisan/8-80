/** One outbound text. Nothing here is ever the commitment — see SCRIPT.md §13. */
export interface Sms {
  send(to: string, body: string): Promise<void>;
}
