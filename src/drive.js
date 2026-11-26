const scope = 'https://www.googleapis.com/auth/drive.file';
let token = '';
let expires = 0;

function loadGoogle() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection.'));
    document.head.append(script);
  });
}

export async function connect(clientId) {
  if (!clientId.trim()) throw new Error('Enter your Google OAuth client ID in Settings.');
  await loadGoogle();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(), scope,
      callback: result => {
        if (result.error) return reject(new Error(result.error_description || result.error));
        token = result.access_token;
        expires = Date.now() + (result.expires_in - 60) * 1000;
        resolve();
      },
      error_callback: () => reject(new Error('Google sign-in was cancelled or blocked.'))
    });
    client.requestAccessToken();
  });
}

export function connected() { return Boolean(token) && Date.now() < expires; }

async function request(url, options = {}) {
  if (!connected()) throw new Error('Connect Google Drive to sync.');
  let response;
  try {
    response = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  } catch {
    const error = new Error('Could not reach Google Drive. Your local changes are safe; sync will retry.');
    error.retryable = true;
    throw error;
  }
  if (!response.ok) {
    if (response.status === 401) { token = ''; throw new Error('Google authorization expired. Reconnect to sync.'); }
    const error = new Error(`Google Drive request failed (${response.status}). Your local changes are safe${response.status === 429 || response.status >= 500 ? '; sync will retry' : ''}.`);
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  return response;
}

export async function listSnapshots() {
  const results = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      q: "trashed = false and (appProperties has { key='kind' and value='connections-snapshot-v1' } or appProperties has { key='kind' and value='connections-current-v1' })",
      fields: 'nextPageToken,files(id,name,createdTime,modifiedTime,appProperties)', pageSize: '100'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const body = await (await request(`https://www.googleapis.com/drive/v3/files?${params}`)).json();
    results.push(...body.files);
    pageToken = body.nextPageToken;
  } while (pageToken);
  return results;
}

export function heads(files) {
  const current = files.filter(file => file.appProperties?.kind === 'connections-current-v1');
  if (current.length) return current;
  const parents = new Set(files.flatMap(file => (file.appProperties?.parents || '').split(',').filter(Boolean)));
  return files.filter(file => !parents.has(file.appProperties?.snapshot));
}

export async function download(fileId) {
  const response = await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  return response.json();
}

export async function upload(envelope, snapshotId, currentFileId = '') {
  const metadata = { name: 'connections-current.json',
    mimeType: 'application/json',
    appProperties: { kind: 'connections-current-v1', snapshot: snapshotId } };
  const boundary = `connections_${crypto.randomUUID().replaceAll('-', '')}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(envelope)}\r\n--${boundary}--`;
  const target = currentFileId ? `/${encodeURIComponent(currentFileId)}` : '';
  const response = await request(`https://www.googleapis.com/upload/drive/v3/files${target}?uploadType=multipart&fields=id`, {
    method: currentFileId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  });
  return response.json();
}
