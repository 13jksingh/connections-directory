import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { blankData, isPossibleDuplicate, parseVcards, searchContacts, sortedNotes } from '../src/data.js';
import { decryptData, encryptData } from '../src/crypto.js';
import { connect, heads, listSnapshots, upload } from '../src/drive.js';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

test('vCard import preserves phone numbers and reports skipped and extra fields', () => {
  const parsed = parseVcards('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alex Sharma\r\nTEL;TYPE=CELL:+91 123456789\r\nTEL;TYPE=WORK:+91 987654321\r\nEMAIL:a@example.com\r\nEMAIL:b@example.com\r\nTITLE:Architect\r\nEND:VCARD\r\nBEGIN:VCARD\r\nTEL:123\r\nEND:VCARD\r\n');
  assert.equal(parsed.contacts.length, 1);
  assert.deepEqual(parsed.contacts[0].phones, ['+91 123456789', '+91 987654321']);
  assert.equal(parsed.contacts[0].profession, 'Architect');
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.extraFields, 1);
  assert.equal(isPossibleDuplicate(parsed.contacts[0], [{ ...parsed.contacts[0], name: 'Another name' }]), true);
});

test('conversation ordering and exact search include notes and phone numbers', () => {
  const person = { ...parseVcards('BEGIN:VCARD\nFN:Alex\nTEL:5551234567\nEND:VCARD\n').contacts[0],
    notes: [{ id: '1', date: '2026-01-02', createdAt: '2026-01-03T00:00:00Z', text: 'Contractor recommended' },
      { id: '2', date: '2026-01-02', createdAt: '2026-01-04T00:00:00Z', text: 'Follow up' }] };
  assert.equal(sortedNotes(person)[0].id, '2');
  assert.equal(searchContacts([person], 'contractor')[0].match, 'Contractor recommended');
  assert.equal(searchContacts([person], '555123')[0].contact.name, 'Alex');
  assert.equal(searchContacts([person], 'missing').length, 0);
});

test('encrypted backups round-trip and reject wrong passwords or tampering', async () => {
  const data = blankData();
  const envelope = await encryptData(data, 'correct horse');
  assert.deepEqual(await decryptData(envelope, 'correct horse'), data);
  await assert.rejects(() => decryptData(envelope, 'wrong'), /Wrong password/);
  const bytes = Buffer.from(envelope.data, 'base64');
  bytes[0] ^= 1;
  await assert.rejects(() => decryptData({ ...envelope, data: bytes.toString('base64') }, 'correct horse'), /damaged/);
});

test('snapshot heads preserve concurrent branches', () => {
  const file = (id, parents = '') => ({ appProperties: { snapshot: id, parents } });
  assert.deepEqual(heads([file('a'), file('b', 'a'), file('c', 'a')]).map(f => f.appProperties.snapshot), ['b', 'c']);
  assert.deepEqual(heads([file('a'), file('b', 'a'), file('c', 'a'), file('d', 'b,c')]).map(f => f.appProperties.snapshot), ['d']);
  const current = { id: 'current', appProperties: { kind: 'connections-current-v1', snapshot: 'e' } };
  assert.deepEqual(heads([file('a'), file('b', 'a'), current]), [current]);
  assert.deepEqual(heads([current, { ...current, id: 'other' }]).map(f => f.id), ['current', 'other']);
});

test('Drive keeps old snapshots readable and updates one current file', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window, originalGoogle = globalThis.google;
  const requests = [];
  globalThis.google = { accounts: { oauth2: { initTokenClient: ({ callback }) => ({
    requestAccessToken: () => callback({ access_token: 'test-token', expires_in: 3600 })
  }) } } };
  globalThis.window = { google: globalThis.google };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), ...options });
    return { ok: true, json: async () => String(url).includes('upload/drive') ? { id: 'current-file' } : { files: [] } };
  };
  try {
    await connect('test-client');
    await listSnapshots();
    assert.match(new URL(requests[0].url).searchParams.get('q'), /connections-snapshot-v1/);
    assert.match(new URL(requests[0].url).searchParams.get('q'), /connections-current-v1/);
    await upload({ encrypted: true }, 'first');
    await upload({ encrypted: true }, 'second', 'current-file');
    assert.equal(requests[1].method, 'POST');
    assert.equal(requests[2].method, 'PATCH');
    assert.match(requests[2].url, /files\/current-file\?/);
    assert.match(requests[2].body, /connections-current-v1/);
    assert.match(requests[2].body, /"snapshot":"second"/);
    globalThis.fetch = async () => { throw new TypeError('Network unavailable'); };
    await assert.rejects(() => listSnapshots(), error => error.retryable === true);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(() => listSnapshots(), error => error.retryable === true);
    globalThis.fetch = async () => ({ ok: false, status: 403 });
    await assert.rejects(() => listSnapshots(), error => error.retryable === false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.google = originalGoogle;
  }
});
