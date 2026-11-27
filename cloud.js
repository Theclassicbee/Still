(() => {
  'use strict';

  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FILE_NAME = 'Still Meditation Backup.json';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

  let clientId = '';
  let token = '';
  let fileId = '';
  let tokenClient = null;
  let getLocalSessions = () => [];
  let setSessions = () => {};
  let onState = () => {};
  let syncPromise = null;
  let syncAgain = false;
  let mergeOnNextSync = false;

  function isConfiguredClientId(raw) {
    const id = String(raw || '').trim();
    if (!id) return false;
    if (id.includes('YOUR_') || id.includes('REPLACE_')) return false;
    return id.endsWith('.apps.googleusercontent.com');
  }

  function status(text, tone = '', extra = {}) {
    onState({
      text,
      tone,
      connected: Boolean(token),
      setupNeeded: !clientId,
      ready: Boolean(tokenClient),
      ...extra
    });
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    });

    if (response.status === 401) {
      token = '';
      fileId = '';
      status('Google session expired. Sign in again to sync.', 'error');
      throw new Error('Google session expired.');
    }

    if (!response.ok) {
      let message = `Google Drive returned ${response.status}.`;
      try {
        const data = await response.json();
        message = data.error?.message || message;
      } catch {}
      throw new Error(message);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  async function findFile() {
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const result = await api(`${API}/files?q=${q}&pageSize=10&fields=files(id,name)`);
    return result.files?.[0] || null;
  }

  async function readFile(id) {
    const response = await fetch(`${API}/files/${encodeURIComponent(id)}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.status === 401) {
      token = '';
      fileId = '';
      status('Google session expired. Sign in again to sync.', 'error');
      throw new Error('Google session expired.');
    }

    if (!response.ok) {
      throw new Error(`Could not read your Google Drive backup (${response.status}).`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : (Array.isArray(data.sessions) ? data.sessions : []);
  }

  async function writeFile(sessions) {
    const body = JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      sessions
    });

    if (fileId) {
      await api(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      return;
    }

    const boundary = `still_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const metadata = { name: FILE_NAME, mimeType: 'application/json' };
    const multipart = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      body,
      `--${boundary}--`
    ].join('\r\n');

    const created = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart
    });
    fileId = created.id;
  }

  function sessionId(session) {
    return session.id || session.createdAt || `${session.date}|${session.mode}|${session.seconds}`;
  }

  function mergeSessions(first, second) {
    const map = new Map();
    [...first, ...second].forEach((session) => {
      if (!session || typeof session !== 'object') return;
      const id = sessionId(session);
      map.set(id, { ...session, id });
    });
    return [...map.values()].sort((a, b) =>
      String(a.createdAt || a.date).localeCompare(String(b.createdAt || b.date))
    );
  }

  async function runSync() {
    if (!token) return;
    status('Syncing your practice…');

    do {
      syncAgain = false;
      try {
        if (!fileId) {
          const found = await findFile();
          fileId = found?.id || '';
          if (found && mergeOnNextSync) {
            const remote = await readFile(fileId);
            setSessions(mergeSessions(remote, getLocalSessions()), { fromCloud: true });
          }
        } else if (mergeOnNextSync) {
          const remote = await readFile(fileId);
          setSessions(mergeSessions(remote, getLocalSessions()), { fromCloud: true });
        }

        mergeOnNextSync = false;
        await writeFile(getLocalSessions());
        status('Backed up to your Google Drive', 'connected');
      } catch (error) {
        if (token) {
          status(error.message || 'Could not sync. Check your connection and try again.', 'error');
        }
        break;
      }
    } while (syncAgain && token);
  }

  function sync() {
    if (!token) return Promise.resolve();
    if (syncPromise) {
      syncAgain = true;
      return syncPromise;
    }
    syncPromise = runSync().finally(() => {
      syncPromise = null;
      if (syncAgain && token) sync();
    });
    return syncPromise;
  }

  function init(options) {
    const rawId = String(options.clientId || '').trim();
    clientId = isConfiguredClientId(rawId) ? rawId : '';
    getLocalSessions = options.getLocalSessions;
    setSessions = options.setSessions;
    onState = options.onState;

    if (!clientId) {
      status('Saved on this device only', '', { setupNeeded: true, ready: false });
      return;
    }

    let attempts = 0;
    const waitForLibrary = () => {
      if (window.google?.accounts?.oauth2) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: async (response) => {
            if (response?.error) {
              status('Google sign-in was cancelled.', 'error');
              return;
            }
            if (!response?.access_token) {
              status('Google did not grant Drive access.', 'error');
              return;
            }
            token = response.access_token;
            fileId = '';
            mergeOnNextSync = true;
            status('Signed in. Preparing your backup…');
            try {
              await sync();
              if (token) options.onConnected?.();
            } catch {}
          },
          error_callback: (error) => {
            status(error?.message || 'Google sign-in could not open. Try again.', 'error');
          }
        });

        status('Ready to connect Google Drive', '', { setupNeeded: false, ready: true });
        return;
      }

      attempts++;
      if (attempts < 100) {
        setTimeout(waitForLibrary, 100);
      } else {
        status('Google sign-in could not load. Check your connection.', 'error');
      }
    };

    waitForLibrary();
  }

  function connect() {
    if (!clientId) {
      status('Saved on this device only', '', { setupNeeded: true, ready: false });
      return 'setup';
    }
    if (!tokenClient) {
      status('Loading Google sign-in…');
      return 'loading';
    }
    tokenClient.requestAccessToken({ prompt: 'select_account' });
    return 'opened';
  }

  function disconnect() {
    if (token && window.google?.accounts?.oauth2?.revoke) {
      try {
        window.google.accounts.oauth2.revoke(token, () => {});
      } catch {}
    }
    token = '';
    fileId = '';
    mergeOnNextSync = false;
    status('Signed out. Your Google Drive backup remains safe.');
  }

  window.StillCloud = {
    init,
    connect,
    sync,
    disconnect,
    mergeSessions,
    get configured() {
      return Boolean(clientId);
    },
    get connected() {
      return Boolean(token);
    }
  };
})();
