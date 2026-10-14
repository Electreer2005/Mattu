const encoder = new TextEncoder();
export const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('');
export async function sha256(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join(''); }
export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return [...new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: encoder.encode(salt) }, key, 256))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function constantEqual(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
export const emailOf = value => typeof value === 'string' ? value.trim().toLowerCase().slice(0, 254) : '';
export const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const validPassword = value => typeof value === 'string' && value.length >= 10 && value.length <= 128;
export const cookie = token => `__Host-mattu_session=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${token ? 604800 : 0}`;
export function readToken(request) { const value = request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-mattu_session=([a-f0-9]{64})(?:;|$)/)?.[1]; return value || ''; }
