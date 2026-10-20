import { b64, unb64 } from './crypto.js';
export const pairingLink = (invitation: string) =>
  'dayweave://pair?invite=' + b64(new TextEncoder().encode(invitation));
export function invitationText(input: string) {
  const text = input.trim();
  if (!text.startsWith('dayweave:')) return text;
  const url = new URL(text);
  const value = url.searchParams.get('invite');
  if (url.protocol !== 'dayweave:' || url.hostname !== 'pair' || !value || value.length > 16000)
    throw new Error('配对链接无效');
  return new TextDecoder().decode(unb64(value));
}
export const pendingPairingKey = 'dayweave.pendingPairing';
