const els = {
  baseUrl: document.getElementById('baseUrl'),
  apiKey: document.getElementById('apiKey'),
  workspaceId: document.getElementById('workspaceId'),
  pageUrl: document.getElementById('pageUrl'),
  status: document.getElementById('status'),
  save: document.getElementById('save'),
  reload: document.getElementById('reload'),
};

let currentUrl = '';

/**
 * Host access is optional and requested only for the Nexus origin the user
 * configured, on a click. The extension never asks for access to every site.
 */
async function ensureHostPermission(base) {
  let origin;
  try {
    origin = `${new URL(base).origin}/*`;
  } catch {
    setStatus('Enter a valid Nexus URL', 'error');
    return false;
  }
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

function setStatus(message, kind = '') {
  els.status.textContent = message;
  els.status.className = kind;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    'baseUrl',
    'apiKey',
    'workspaceId',
  ]);
  els.baseUrl.value = stored.baseUrl ?? 'http://localhost:3000';
  els.apiKey.value = stored.apiKey ?? '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl = tab?.url ?? '';
  els.pageUrl.textContent = currentUrl || 'No active tab URL';
  els.save.disabled = !currentUrl;
  if (els.apiKey.value) await loadWorkspaces(stored.workspaceId);
}

async function loadWorkspaces(selected) {
  setStatus('Loading workspaces…');
  try {
    const base = els.baseUrl.value.replace(/\/$/, '');
    if (!(await ensureHostPermission(base))) {
      setStatus('Permission to reach that Nexus URL was declined', 'error');
      return;
    }
    const res = await fetch(`${base}/api/v1/workspaces`, {
      headers: { authorization: `Bearer ${els.apiKey.value}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { workspaces } = await res.json();
    els.workspaceId.innerHTML = '';
    for (const workspace of workspaces) {
      const option = document.createElement('option');
      option.value = workspace.id;
      option.textContent = `${workspace.name} (${workspace.documentCount})`;
      els.workspaceId.append(option);
    }
    if (selected && workspaces.some((w) => w.id === selected)) {
      els.workspaceId.value = selected;
    }
    setStatus('');
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

els.reload.addEventListener('click', async () => {
  await chrome.storage.local.set({
    baseUrl: els.baseUrl.value.trim(),
    apiKey: els.apiKey.value.trim(),
  });
  await loadWorkspaces();
});

els.save.addEventListener('click', async () => {
  const base = els.baseUrl.value.replace(/\/$/, '');
  const apiKey = els.apiKey.value.trim();
  const workspaceId = els.workspaceId.value;
  if (!workspaceId) {
    setStatus('Pick a workspace first', 'error');
    return;
  }
  if (!(await ensureHostPermission(base))) {
    setStatus('Permission to reach that Nexus URL was declined', 'error');
    return;
  }
  await chrome.storage.local.set({ baseUrl: base, apiKey, workspaceId });
  els.save.disabled = true;
  setStatus('Saving…');
  try {
    const res = await fetch(`${base}/api/v1/urls`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ workspaceId, url: currentUrl }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    setStatus(body.duplicate ? 'Already saved' : 'Saved — indexing…', 'ok');
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    els.save.disabled = false;
  }
});

loadSettings();
