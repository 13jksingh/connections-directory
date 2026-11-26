export const blankData = () => ({ version: 1, contacts: [] });
export const newId = () => globalThis.crypto.randomUUID();

export function validData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.contacts)) return false;
  return data.contacts.every(contact =>
    contact && typeof contact.id === 'string' && typeof contact.name === 'string' &&
    Array.isArray(contact.phones) && contact.phones.every(phone => typeof phone === 'string') &&
    typeof contact.email === 'string' && typeof contact.address === 'string' &&
    typeof contact.profession === 'string' && Array.isArray(contact.tags) &&
    contact.tags.every(tag => typeof tag === 'string') &&
    Array.isArray(contact.notes) && contact.notes.every(note =>
      note && typeof note.id === 'string' && typeof note.date === 'string' &&
      typeof note.text === 'string' && typeof note.createdAt === 'string') &&
    Array.isArray(contact.reminders) && contact.reminders.every(reminder =>
      reminder && typeof reminder.id === 'string' && typeof reminder.date === 'string' &&
      typeof reminder.text === 'string' && typeof reminder.done === 'boolean'));
}

export function sortedNotes(contact) {
  return [...contact.notes].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function parseVcards(text) {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  const cards = unfolded.split(/BEGIN:VCARD\s*\n/i).slice(1);
  const contacts = [];
  let skipped = 0, extraFields = 0;
  const unescape = value => value.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1').trim();
  for (const card of cards) {
    const fields = {};
    for (const line of card.split(/\n/)) {
      if (/^END:VCARD/i.test(line)) break;
      const pos = line.indexOf(':');
      if (pos < 0) continue;
      const key = line.slice(0, pos).split(';')[0].split('.').pop().toUpperCase();
      (fields[key] ||= []).push(line.slice(pos + 1));
    }
    const name = unescape(fields.FN?.[0] || (fields.N?.[0] || '').split(';').reverse().join(' '));
    if (!name) { skipped++; continue; }
    const phones = [...new Set((fields.TEL || []).map(unescape).filter(Boolean))];
    const email = unescape(fields.EMAIL?.[0] || '');
    const address = unescape((fields.ADR?.[0] || '').split(';').filter(Boolean).join(', '));
    const profession = unescape(fields.TITLE?.[0] || fields.ROLE?.[0] || '');
    extraFields += Math.max(0, (fields.EMAIL?.length || 0) - 1) + Math.max(0, (fields.ADR?.length || 0) - 1);
    contacts.push({ id: newId(), name, phones, email, address, profession, tags: [], notes: [], reminders: [] });
  }
  return { contacts, skipped, extraFields };
}

export function isPossibleDuplicate(contact, existing) {
  const normalized = value => value.toLocaleLowerCase().trim();
  const digits = value => value.replace(/\D/g, '');
  return existing.some(other =>
    normalized(contact.name) === normalized(other.name) ||
    (contact.email && other.email && normalized(contact.email) === normalized(other.email)) ||
    contact.phones.some(phone => digits(phone).length >= 7 && other.phones.some(p => digits(p) === digits(phone)))
  );
}

export function searchContacts(contacts, query) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return contacts.map(contact => ({ contact, match: '' }));
  return contacts.flatMap(contact => {
    const details = [contact.name, ...contact.phones, contact.email, contact.address, contact.profession, ...contact.tags].join(' ').toLowerCase();
    const notes = contact.notes.map(note => ({ text: note.text, lower: note.text.toLowerCase() }));
    const haystack = `${details} ${notes.map(note => note.lower).join(' ')}`;
    if (!words.every(word => haystack.includes(word))) return [];
    return [{ contact, match: notes.find(note => words.some(word => note.lower.includes(word)))?.text || '' }];
  });
}
