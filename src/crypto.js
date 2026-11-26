import { validData } from './data.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
const unb64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const iterations = 310000;

async function keyFor(password, salt, count) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: count, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptData(data, password) {
  if (!password) throw new Error('Enter a backup password.');
  if (!validData(data)) throw new Error('Invalid data.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt, iterations);
  const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  return { format: 'connections-encrypted', version: 1, kdf: 'PBKDF2-SHA256', iterations,
    salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(bytes)) };
}

export async function decryptData(envelope, password) {
  if (!envelope || envelope.format !== 'connections-encrypted' || envelope.version !== 1 ||
      envelope.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(envelope.iterations) ||
      envelope.iterations < 100000 || envelope.iterations > 2000000) throw new Error('This is not a supported backup.');
  try {
    const salt = unb64(envelope.salt), iv = unb64(envelope.iv), bytes = unb64(envelope.data);
    if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid parameters');
    const key = await keyFor(password, salt, envelope.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes);
    const data = JSON.parse(dec.decode(plain));
    if (!validData(data)) throw new Error('Invalid data');
    return data;
  } catch {
    throw new Error('Wrong password or damaged backup. Existing data was not changed.');
  }
}
