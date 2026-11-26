import './style.css';
import { blankData, isPossibleDuplicate, newId, parseVcards, searchContacts, sortedNotes, validData } from './data.js';
import { readState, writeState } from './storage.js';
import { decryptData, encryptData } from './crypto.js';
import * as drive from './drive.js';

const root = document.querySelector('#app');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = value => escape(value).replace(/\n/g, '<br>');
const today = () => new Date().toLocaleDateString('en-CA');
const initials = name => name.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
let state, view = 'home', contactId = '', formType = '', formId = '', query = '', filterTag = '';
let password = '', busy = false, revision = 0, syncTimer, semanticWorker, semanticReady = false, semanticRequest = 0;
let cloudHeads = [], cloudFiles = [], importPreview = null, statusText = '', statusKind = '';
let defaultClientId = '';
let queue = Promise.resolve();

function persist() {
  const snapshot = structuredClone(state);
  queue = queue.catch(() => {}).then(() => writeState(snapshot));
  return queue;
}

async function change(mutator) {
  mutator(state.data);
  state.sync.dirty = true;
  revision++;
  try {
    await persist();
    statusText = 'Saved on this phone · Waiting to sync';
    statusKind = 'warning';
    render();
    if (drive.connected() && password) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => sync().catch(showError), 1800);
    }
  } catch (error) { showError(error); throw error; }
}

function showError(error) {
  statusText = error.message || 'Something went wrong.';
  statusKind = 'error';
  const form = root.querySelector('form[data-form="contact"], form[data-form="note"], form[data-form="reminder"]');
  if ((view === 'contact' || view === 'entry') && form) {
    let message = form.querySelector('.form-error');
    if (!message) { message = document.createElement('p'); message.className = 'form-error error'; form.prepend(message); }
    message.textContent = statusText;
    return;
  }
  render();
}

function selectedContact() { return state.data.contacts.find(contact => contact.id === contactId); }
function field(label, name, value = '', type = 'text', attrs = '') {
  return `<label class="field">${label}<input name="${name}" type="${type}" value="${escape(value)}" ${attrs}></label>`;
}
function button(label, action, attrs = '') { return `<button type="button" class="link" data-action="${action}" ${attrs}>${label}</button>`; }
function top() {
  return `<div class="top"><div class="brand"><div class="logo">✳</div>connections</div>
    <button class="icon" data-action="settings" aria-label="Settings">⚙</button></div>`;
}
function nav() {
  return `<nav class="nav" aria-label="Main navigation">
    <button data-action="home" class="${view === 'home' ? 'active' : ''}"><span>♧</span>Contacts</button>
    <button data-action="reminders" class="${view === 'reminders' ? 'active' : ''}"><span>◷</span>Reminders</button>
    <button data-action="settings" class="${view === 'settings' ? 'active' : ''}"><span>⚙</span>Settings</button>
  </nav>`;
}
function status() {
  const value = statusText || (state.sync.dirty ? 'Saved on this phone · Waiting to sync' :
    state.sync.base.length ? 'Saved to Drive' : 'Saved on this phone · Connect Drive to back up');
  return `<div class="status ${statusKind || (state.sync.dirty ? 'warning' : '')}" role="status">${escape(value)}</div>`;
}
function contactRows(results) {
  if (!results.length) return `<div class="empty">${query || filterTag ? 'No matching connections.' : 'No connections yet. Add one or import your contacts.'}</div>`;
  return results.map(({ contact, match }) => `<button class="person" data-action="open" data-id="${escape(contact.id)}">
    <div class="avatar">${escape(initials(contact.name))}</div><div><strong>${escape(contact.name)}</strong>
    <small>${escape([contact.profession, contact.address].filter(Boolean).join(' · ') || 'Connection')}</small>
    ${match ? `<div class="match">“${escape(match.slice(0, 120))}”</div>` : ''}</div><div class="arrow">›</div></button>`).join('');
}
function upcoming() {
  return state.data.contacts.flatMap(contact => contact.reminders.filter(reminder => !reminder.done)
    .map(reminder => ({ contact, reminder }))).sort((a, b) => a.reminder.date.localeCompare(b.reminder.date));
}
function home() {
  const items = upcoming(), first = items[0];
  const tags = [...new Set(state.data.contacts.flatMap(contact => contact.tags))].sort();
  const candidates = filterTag ? state.data.contacts.filter(contact => contact.tags.includes(filterTag)) : state.data.contacts;
  return `${top()}<h1>Good to see you.</h1><p class="muted">Your people, all in one place.</p>
    ${!localStorage.getItem('connections-onboarded') && !state.data.contacts.length ? `<div class="notice">
    <strong>Welcome to Connections</strong><p>Save this app to your Home Screen, then import contacts or add your first person. Connect your own Google Drive in Settings to back up your data.</p>
    <div class="actions">${button('See setup steps', 'settings')}${button('Got it', 'dismiss-welcome')}</div></div>` : ''}
    ${status()}
    <div class="search"><label class="sr-only" for="search">Search connections</label>
      <input id="search" type="search" placeholder="Search people or conversations" value="${escape(query)}"></div>
    <div class="search-options">${button(semanticReady ? '✳ AI search ready' : '✳ Enable AI search', 'ai')}
      <span class="hint" id="ai-status">${semanticReady ? 'Search by meaning' : 'Optional model download'}</span></div>
    <div class="section-title"><h2>Coming up</h2>${button('View all', 'reminders')}</div>
    ${first ? `<div class="card reminder"><strong>${escape(first.contact.name)}</strong><p>${escape(first.reminder.text)}</p><span class="hint">${escape(first.reminder.date.replace('T', ' · '))}</span></div>` :
      '<div class="card reminder"><span class="muted">No follow-ups planned yet.</span></div>'}
    <div class="section-title"><h2>Your connections</h2>${button('＋ Add new', 'new-contact')}</div>
    ${tags.length ? `<label class="sr-only" for="tag-filter">Filter by tag</label><select id="tag-filter"><option value="">All tags</option>${tags.map(tag => `<option ${filterTag === tag ? 'selected' : ''}>${escape(tag)}</option>`).join('')}</select>` : ''}
    <div id="contact-list">${contactRows(searchContacts(candidates, query))}</div>
    <div class="actions"><button class="secondary full" data-action="import">↓ &nbsp; Import contacts from a file</button></div>`;
}
function contactDetail() {
  const contact = selectedContact();
  if (!contact) { view = 'home'; return home(); }
  const notes = sortedNotes(contact);
  return `<div class="top">${button('‹ &nbsp; All connections', 'home')}${button('Edit', 'edit-contact')}</div>
    <div class="profile"><div class="avatar large">${escape(initials(contact.name))}</div>
    <h1>${escape(contact.name)}</h1><p class="muted">${escape(contact.profession || 'Connection')}</p>
    <div class="tags">${contact.tags.map(tag => `<span class="tag">${escape(tag)}</span>`).join('')}</div></div>
    <div class="card">${contact.phones.map(phone => `<div class="info"><small>Phone</small>${escape(phone)}</div>`).join('')}
    ${contact.email ? `<div class="info"><small>Email</small>${escape(contact.email)}</div>` : ''}
    ${contact.address ? `<div class="info"><small>Address</small>${escape(contact.address)}</div>` : ''}
    ${!contact.phones.length && !contact.email && !contact.address ? '<span class="muted">No contact details yet.</span>' : ''}</div>
    <div class="section-title"><h2>Conversations</h2>${button('＋ Add note', 'new-note')}</div>
    <div class="timeline">${notes.length ? notes.map(note => `<div class="entry"><div class="date">${escape(note.date)}</div><p>${text(note.text)}</p>
      <div class="actions">${button('Edit', 'edit-note', `data-id="${escape(note.id)}"`)}${button('Delete', 'delete-note', `data-id="${escape(note.id)}"`)}</div></div>`).join('') :
      '<p class="muted">No conversations yet.</p>'}</div>
    <div class="section-title"><h2>Follow-ups</h2>${button('＋ Add', 'new-reminder')}</div>
    ${contact.reminders.length ? contact.reminders.map(reminder => `<div class="list-row"><div><strong>${escape(reminder.text)}</strong>
      <p class="hint">${escape(reminder.date.replace('T', ' · '))}${reminder.done ? ' · Completed' : ''}</p>
      <div class="actions">${button(reminder.done ? 'Reopen' : 'Complete', 'toggle-reminder', `data-id="${escape(reminder.id)}"`)}
      ${button('Edit', 'edit-reminder', `data-id="${escape(reminder.id)}"`)}${button('Delete', 'delete-reminder', `data-id="${escape(reminder.id)}"`)}</div></div></div>`).join('') : '<p class="muted">No follow-ups yet.</p>'}
    <div class="actions"><button class="danger" data-action="delete-contact">Delete contact</button></div>`;
}
function contactForm() {
  const c = selectedContact() || { name: '', phones: [], email: '', address: '', profession: '', tags: [] };
  return `<div class="top">${button('‹ Cancel', selectedContact() ? 'detail' : 'home')}</div><h1>${selectedContact() ? 'Edit connection' : 'New connection'}</h1>
    <form data-form="contact">${field('Name *', 'name', c.name, 'text', 'required maxlength="200"')}
    <label class="field">Phone numbers <span class="hint">(one per line)</span><textarea name="phones" rows="3">${escape(c.phones.join('\n'))}</textarea></label>
    ${field('Email', 'email', c.email, 'email')}${field('Address', 'address', c.address)}${field('Profession', 'profession', c.profession)}
    ${field('Tags', 'tags', c.tags.join(', '), 'text', 'placeholder="Friends, Work"')}
    <button class="button full" type="submit">Save connection</button></form>`;
}
function entryForm() {
  const c = selectedContact();
  const isNote = formType === 'note';
  const item = (isNote ? c.notes : c.reminders).find(item => item.id === formId) || {};
  return `<div class="top">${button('‹ Cancel', 'detail')}</div><h1>${formId ? 'Edit' : 'Add'} ${isNote ? 'conversation' : 'follow-up'}</h1>
    <p class="muted">For ${escape(c.name)}</p><form data-form="${formType}">
    ${field(isNote ? 'Conversation date' : 'Date and time', 'date', item.date || (isNote ? today() : `${today()}T10:00`), isNote ? 'date' : 'datetime-local', 'required')}
    <label class="field">${isNote ? 'What did you talk about?' : 'What would you like to follow up on?'}
      <textarea name="text" required>${escape(item.text || '')}</textarea></label>
    <button class="button full" type="submit">Save ${isNote ? 'conversation' : 'reminder'}</button></form>`;
}
function reminders() {
  const list = upcoming();
  return `${top()}<h1>Follow-ups</h1><p class="muted">A little nudge when you open the app.</p>
    ${list.length ? list.map(({ contact, reminder }) => `<button class="person" data-action="open" data-id="${escape(contact.id)}">
    <div class="avatar">◷</div><div><strong>${escape(contact.name)}</strong><small>${escape(reminder.text)} · ${escape(reminder.date.replace('T', ' '))}</small></div><div class="arrow">›</div></button>`).join('') :
    '<div class="empty">No upcoming follow-ups. Add one from a contact.</div>'}`;
}
function settings() {
  const clientId = localStorage.getItem('connections-client-id') || defaultClientId;
  return `${top()}<h1>Settings</h1>${status()}
    <div class="section-title"><h2>Your Google Drive</h2></div>
    <div class="card"><p>Your encrypted data is stored in your own Drive. Sync works while this app is open and connected.</p>
    <form data-form="client-id">${field('Google OAuth client ID', 'clientId', clientId, 'text', 'placeholder="...apps.googleusercontent.com" autocomplete="off"')}
    <button class="secondary full" type="submit">Save client ID</button></form>
    <div class="actions"><button class="button" data-action="connect">${drive.connected() ? 'Reconnect Drive' : 'Connect Drive'}</button>
    <button class="secondary" data-action="sync">Sync now</button></div>
    <div class="actions"><button class="secondary" data-action="versions">View Drive versions</button></div>
    <p class="hint">A password is requested when syncing or restoring. Keep it safe: it cannot be recovered.</p></div>
    <div class="section-title"><h2>Backup &amp; restore</h2></div>
    <div class="card"><p>Save an encrypted copy to Files or your own cloud storage.</p><div class="actions">
    <button class="secondary" data-action="export">Export backup</button><button class="secondary" data-action="restore-file">Restore backup</button></div></div>
    <div class="section-title"><h2>Get started</h2></div>
    <div class="card"><p><strong>Add to Home Screen:</strong> On iPhone, open this link in Safari, tap Share, then Add to Home Screen. On Android, use the browser menu and Install app or Add to Home Screen.</p>
    <p><strong>Import contacts:</strong> Export contacts as a .vcf file from your phone's Contacts app, then choose that file here. The file may contain unencrypted personal data; delete it after import if no longer needed.</p>
    <button class="secondary full" data-action="import">Import contacts</button></div>
    <input id="file-input" type="file" accept=".vcf,text/vcard" hidden><input id="restore-input" type="file" accept=".json,application/json" hidden>`;
}
function versionsPage() {
  return `<div class="top">${button('‹ Settings', 'settings')}</div><h1>Drive versions</h1>
    ${status()}
    <p class="hint">Choose a version to restore. Restoring replaces this phone's local data. Existing Drive versions are kept.</p>
    ${cloudFiles.length ? cloudFiles.map(file => `<div class="list-row"><div><strong>${escape(new Date(file.createdTime).toLocaleString())}</strong>
    <p class="hint">${cloudHeads.some(head => head.id === file.id) ? 'Current' : 'Earlier'} version ${escape(file.appProperties?.snapshot?.slice(0, 8))}</p></div>
    <button class="secondary" data-action="restore-version" data-id="${escape(file.id)}">Restore</button></div>`).join('') : '<div class="empty">No saved versions in this Drive.</div>'}
    ${cloudHeads.length > 1 || (cloudHeads.length && state.sync.dirty) ? `<div class="notice">There are different versions. You can restore a version, or keep this phone's data and save it as a new version. Review carefully first.</div>
    <button class="button full" data-action="resolve-local">Keep this phone's data</button>` : ''}`;
}
function previewPage() {
  const { contacts, skipped, extraFields, duplicates } = importPreview;
  return `<div class="top">${button('‹ Cancel', 'home')}</div><h1>Import contacts</h1>
    <p>${contacts.length} contact(s) found. ${skipped} without a name and ${duplicates} possible duplicate(s) will be skipped.</p>
    ${extraFields ? `<p class="hint">${extraFields} extra email or address value(s) cannot be imported in this version.</p>` : ''}
    <div class="card">${contacts.slice(0, 30).map(contact => `<div class="list-row"><div><strong>${escape(contact.name)}</strong><p class="hint">${escape(contact.phones.join(' · ') || contact.email || 'No contact details')}</p></div>
    <span class="hint">${contact.duplicate ? 'Possible duplicate' : 'Will import'}</span></div>`).join('')}
    ${contacts.length > 30 ? `<p class="hint">And ${contacts.length - 30} more.</p>` : ''}</div>
    <div class="actions"><button class="button full" data-action="confirm-import">Import ${contacts.length - duplicates} contacts</button></div>`;
}
function render() {
  if (!state) return;
  if ((view === 'contact' || view === 'entry') && root.querySelector('form[data-form="contact"], form[data-form="note"], form[data-form="reminder"]')) return;
  const pages = { home, detail: contactDetail, contact: contactForm, entry: entryForm, reminders, settings, versions: versionsPage, preview: previewPage };
  root.innerHTML = `<div class="shell"><main class="screen">${pages[view]()}</main>${nav()}</div>`;
}

function documentsForAI() {
  return state.data.contacts.flatMap(c => [
    { id: c.id, match: '', text: [c.name, c.profession, c.address, ...c.tags].filter(Boolean).join(' ') },
    ...c.notes.map(note => ({ id: c.id, match: note.text, text: `${c.name} ${c.profession} ${note.text}` }))
  ]);
}
function doSearch() {
  const candidates = filterTag ? state.data.contacts.filter(c => c.tags.includes(filterTag)) : state.data.contacts;
  const list = document.querySelector('#contact-list');
  if (!list) return;
  list.innerHTML = contactRows(searchContacts(candidates, query));
  if (query.trim() && semanticReady) {
    const indicator = document.querySelector('#ai-status');
    indicator.textContent = 'Searching by meaning…';
    semanticWorker.postMessage({ type: 'search', id: ++semanticRequest, query, documents: documentsForAI() });
  }
}
function enableAI() {
  if (semanticReady) return;
  if (semanticWorker) return;
  semanticWorker = new Worker(new URL('./semantic-worker.js', import.meta.url), { type: 'module' });
  semanticWorker.onmessage = ({ data }) => {
    const indicator = document.querySelector('#ai-status');
    if (data.type === 'progress' && indicator) indicator.textContent = data.message;
    if (data.type === 'ready') { semanticReady = true; if (indicator) indicator.textContent = 'AI search ready'; doSearch(); }
    if (data.type === 'error') {
      if (indicator) indicator.textContent = `AI unavailable: ${data.message}`;
      if (!semanticReady) { semanticWorker.terminate(); semanticWorker = null; }
    }
    if (data.type === 'results' && data.id === semanticRequest && view === 'home') {
      const candidates = filterTag ? state.data.contacts.filter(c => c.tags.includes(filterTag)) : state.data.contacts;
      const exact = searchContacts(candidates, query);
      const seen = new Set(exact.map(result => result.contact.id));
      const extra = [];
      for (const result of data.results) {
        const contact = candidates.find(c => c.id === result.id);
        if (contact && !seen.has(contact.id)) { seen.add(contact.id); extra.push({ contact, match: result.match }); }
      }
      document.querySelector('#contact-list').innerHTML = contactRows([...exact, ...extra]);
      if (indicator) indicator.textContent = 'AI suggestions · check matching notes';
    }
  };
  semanticWorker.postMessage({ type: 'initialize' });
}

function getPassword() {
  if (!password) password = prompt('Enter the encryption password for your Drive data. Use the same password on all your devices. It cannot be recovered.') || '';
  if (!password) throw new Error('A password is required to sync.');
  return password;
}
const ids = files => files.map(file => file.appProperties?.snapshot).filter(Boolean).sort();
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
function snapshotId() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
async function refreshHeads() {
  cloudFiles = (await drive.listSnapshots()).sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  cloudHeads = drive.heads(cloudFiles);
  return cloudHeads;
}
async function sync(force = false) {
  if (busy) return;
  if (!drive.connected()) throw new Error('Connect Google Drive in Settings first.');
  getPassword();
  busy = true;
  statusText = 'Checking Google Drive…'; statusKind = ''; render();
  try {
    const remote = await refreshHeads(), remoteIds = ids(remote);
    if (!force && !same(remoteIds, state.sync.base)) {
      if (!state.sync.dirty && remote.length === 1 && state.data.contacts.length === 0) {
        if (view !== 'contact' && view !== 'entry') view = 'versions';
        statusText = 'Existing Drive data found. Select it to restore.'; statusKind = 'warning'; return;
      }
      if (view !== 'contact' && view !== 'entry') view = 'versions';
      statusText = 'Drive and this phone have different versions. Choose how to proceed.'; statusKind = 'warning'; return;
    }
    if (!state.sync.dirty && !force && remote.length) { statusText = 'Saved to Drive'; statusKind = ''; return; }
    if (!remote.length && !state.sync.base.length) {
      const confirmation = prompt('Confirm the password for your first Drive backup. It cannot be recovered if forgotten.');
      if (confirmation !== password) { password = ''; throw new Error('Passwords do not match. Nothing was uploaded.'); }
    }
    for (const file of remote) await decryptData(await drive.download(file.id), password);
    const capturedRevision = revision;
    const capturedData = structuredClone(state.data);
    const id = snapshotId();
    statusText = 'Encrypting and saving to Drive…'; render();
    await drive.upload(await encryptData(capturedData, password), id, remoteIds);
    state.sync.base = [id];
    state.sync.dirty = revision !== capturedRevision;
    await persist();
    statusText = state.sync.dirty ? 'Saved on this phone · More changes waiting to sync' : 'Saved to Drive';
    statusKind = state.sync.dirty ? 'warning' : '';
  } finally { busy = false; render(); }
}
async function restoreVersion(id) {
  const file = cloudFiles.find(item => item.id === id);
  if (!file) throw new Error('That version is no longer available. Refresh the list.');
  if (busy) throw new Error('Wait for the current sync to finish.');
  if (!confirm('Replace the data on this phone with this Drive version? Export a backup first if you need the current data.')) return;
  const before = revision;
  const data = await decryptData(await drive.download(id), getPassword());
  if (revision !== before) throw new Error('Data changed during restore. Try again after saving your work.');
  state.data = data;
  state.sync.base = [file.appProperties.snapshot];
  state.sync.dirty = false;
  revision++;
  await persist();
  view = 'home'; statusText = cloudHeads.length > 1 ? 'Restored locally · Other Drive versions still exist' : 'Restored from Drive';
  statusKind = cloudHeads.length > 1 ? 'warning' : ''; render();
}
async function exportBackup() {
  const pass = prompt('Choose a password for this backup. You will need it to restore the file.');
  if (!pass) return;
  const envelope = await encryptData(state.data, pass);
  const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `connections-backup-${today()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  statusText = 'Backup created. Save it somewhere safe.'; statusKind = ''; render();
}

root.addEventListener('input', event => {
  if (event.target.id === 'search') { query = event.target.value; doSearch(); }
});
root.addEventListener('change', async event => {
  try {
    if (event.target.id === 'tag-filter') { filterTag = event.target.value; doSearch(); }
    if (event.target.id === 'file-input' && event.target.files[0]) {
      const parsed = parseVcards(await event.target.files[0].text());
      const all = [...state.data.contacts];
      let duplicates = 0;
      for (const contact of parsed.contacts) {
        contact.duplicate = isPossibleDuplicate(contact, all);
        if (contact.duplicate) duplicates++; else all.push(contact);
      }
      importPreview = { ...parsed, duplicates }; view = 'preview'; render();
    }
    if (event.target.id === 'restore-input' && event.target.files[0]) {
      const envelope = JSON.parse(await event.target.files[0].text());
      const pass = prompt('Enter the password for this backup.');
      if (!pass) return;
      const data = await decryptData(envelope, pass);
      if (!confirm(`Replace this phone's data with ${data.contacts.length} contact(s) from the backup?`)) return;
      await change(current => { current.contacts = data.contacts; });
      view = 'home'; render();
    }
  } catch (error) { showError(error); }
});
root.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target, values = new FormData(form);
  try {
    if (form.dataset.form === 'client-id') {
      localStorage.setItem('connections-client-id', String(values.get('clientId')).trim());
      statusText = 'Client ID saved on this phone.'; statusKind = ''; render(); return;
    }
    if (form.dataset.form === 'contact') {
      const name = String(values.get('name')).trim();
      if (!name) throw new Error('Enter a name.');
      const fields = { name, phones: [...new Set(String(values.get('phones')).split(/\n/).map(x => x.trim()).filter(Boolean))],
        email: String(values.get('email')).trim(), address: String(values.get('address')).trim(),
        profession: String(values.get('profession')).trim(), tags: [...new Set(String(values.get('tags')).split(',').map(x => x.trim()).filter(Boolean))] };
      await change(data => {
        const contact = data.contacts.find(c => c.id === contactId);
        if (contact) Object.assign(contact, fields);
        else { contactId = newId(); data.contacts.push({ id: contactId, ...fields, notes: [], reminders: [] }); }
      });
      view = 'detail'; render(); return;
    }
    const value = String(values.get('text')).trim(), date = String(values.get('date'));
    if (!value || !date) throw new Error('Enter the date and details.');
    await change(data => {
      const c = data.contacts.find(item => item.id === contactId);
      if (form.dataset.form === 'note') {
        const existing = c.notes.find(item => item.id === formId);
        if (existing) Object.assign(existing, { date, text: value });
        else c.notes.push({ id: newId(), date, text: value, createdAt: new Date().toISOString() });
      } else {
        const existing = c.reminders.find(item => item.id === formId);
        if (existing) Object.assign(existing, { date, text: value });
        else c.reminders.push({ id: newId(), date, text: value, done: false });
      }
    });
    view = 'detail'; render();
  } catch (error) { showError(error); }
});

root.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action, id = target.dataset.id;
  try {
    if (['home', 'settings', 'reminders', 'detail'].includes(action)) { view = action; render(); return; }
    if (action === 'open') { contactId = id; view = 'detail'; render(); return; }
    if (action === 'new-contact') { contactId = ''; view = 'contact'; render(); return; }
    if (action === 'edit-contact') { view = 'contact'; render(); return; }
    if (action === 'new-note' || action === 'edit-note' || action === 'new-reminder' || action === 'edit-reminder') {
      formType = action.includes('note') ? 'note' : 'reminder'; formId = id || ''; view = 'entry'; render(); return;
    }
    if (action === 'delete-contact') {
      if (!confirm('Delete this contact and all their conversations and reminders?')) return;
      await change(data => { data.contacts = data.contacts.filter(c => c.id !== contactId); });
      contactId = ''; view = 'home'; render(); return;
    }
    if (action === 'delete-note') {
      if (!confirm('Delete this conversation?')) return;
      await change(data => { const c = data.contacts.find(x => x.id === contactId); c.notes = c.notes.filter(n => n.id !== id); });
      return;
    }
    if (action === 'delete-reminder') {
      if (!confirm('Delete this reminder?')) return;
      await change(data => { const c = data.contacts.find(x => x.id === contactId); c.reminders = c.reminders.filter(r => r.id !== id); });
      return;
    }
    if (action === 'toggle-reminder') {
      await change(data => { const item = data.contacts.find(x => x.id === contactId).reminders.find(r => r.id === id); item.done = !item.done; });
      return;
    }
    if (action === 'import') {
      view = 'settings'; render(); document.querySelector('#file-input').click(); return;
    }
    if (action === 'confirm-import') {
      const contacts = importPreview.contacts.filter(c => !c.duplicate).map(({ duplicate, ...contact }) => contact);
      await change(data => { data.contacts.push(...contacts); });
      importPreview = null; query = ''; filterTag = ''; view = 'home'; statusText = `Imported ${contacts.length} contact(s) on this phone · Waiting to sync`;
      statusKind = 'warning'; render(); return;
    }
    if (action === 'ai') { enableAI(); return; }
    if (action === 'dismiss-welcome') { localStorage.setItem('connections-onboarded', 'yes'); render(); return; }
    if (action === 'connect') {
      await drive.connect(localStorage.getItem('connections-client-id') || defaultClientId);
      password = '';
      statusText = 'Drive connected. Select Sync now to unlock and sync.'; statusKind = ''; render(); return;
    }
    if (action === 'sync') { await sync(); return; }
    if (action === 'versions') {
      if (!drive.connected()) throw new Error('Connect Google Drive first.');
      await refreshHeads(); view = 'versions'; render(); return;
    }
    if (action === 'restore-version') { await restoreVersion(id); return; }
    if (action === 'resolve-local') {
      if (!confirm('Keep this phone’s data as the current version? Other versions remain in Drive, but their changes will not appear unless restored.')) return;
      await sync(true); view = 'settings'; render(); return;
    }
    if (action === 'export') { await exportBackup(); return; }
    if (action === 'restore-file') { document.querySelector('#restore-input').click(); return; }
    if (action === 'update') { navigator.serviceWorker.controller?.postMessage('SKIP_WAITING'); return; }
  } catch (error) {
    if (/password|damaged backup/i.test(error.message || '')) password = '';
    showError(error);
  }
});

async function initialize() {
try {
  try { defaultClientId = (await (await fetch('./config.json')).json()).googleClientId || ''; } catch {}
  state = await readState();
  render();
  if ('serviceWorker' in navigator) {
    let reloading = false;
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloading) { reloading = true; window.location.reload(); }
      hadController = true;
    });
    const registration = await navigator.serviceWorker.register('./sw.js').catch(() => null);
    if (!registration) return;
    function offerUpdate() {
      if (!registration.waiting || !navigator.serviceWorker.controller) return;
      const banner = document.createElement('div');
      banner.className = 'banner';
      banner.innerHTML = 'An update is available. <button class="link">Update now</button>';
      banner.querySelector('button').onclick = () => registration.waiting.postMessage('SKIP_WAITING');
      root.prepend(banner);
    }
    offerUpdate();
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', offerUpdate);
    });
  }
} catch (error) {
  root.innerHTML = `<div class="shell"><main class="screen"><h1>Unable to open data</h1><p>${escape(error.message)}</p>
    <p>Check browser storage and try again. Your existing data has not been intentionally changed.</p></main></div>`;
}
}
initialize();
