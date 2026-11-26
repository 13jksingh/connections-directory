import { blankData, validData } from './data.js';

const db = new Promise((resolve, reject) => {
  const request = indexedDB.open('connections-directory', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('state');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function readState() {
  const database = await db;
  return new Promise((resolve, reject) => {
    const request = database.transaction('state').objectStore('state').get('current');
    request.onsuccess = () => {
      const value = request.result;
      if (!value) return resolve({ data: blankData(), sync: { base: [], dirty: false } });
      if (!validData(value.data) || !value.sync || !Array.isArray(value.sync.base)) {
        return reject(new Error('The saved data could not be read. It has not been changed.'));
      }
      resolve(value);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function writeState(state) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const tx = database.transaction('state', 'readwrite');
    tx.objectStore('state').put(structuredClone(state), 'current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Saving failed'));
  });
}
