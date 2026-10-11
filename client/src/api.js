async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  authStatus: () => request('GET', '/api/auth/status'),
  setup: (token, username, password) => request('POST', '/api/auth/setup', { token, username, password }),
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),
  system: () => request('GET', '/api/stats/system'),
  history: (range) => request('GET', `/api/stats/history?range=${range}`),
  docker: () => request('GET', '/api/docker'),
  containerAction: (id, action) => request('POST', `/api/docker/containers/${id}/${action}`),
  containerLogs: (id, tail = 200) => request('GET', `/api/docker/containers/${id}/logs?tail=${tail}`),
  service: () => request('GET', '/api/service'),
  serviceRestart: () => request('POST', '/api/service/restart'),
  serviceStop: (password) => request('POST', '/api/service/stop', { password }),
  serviceBoot: (enabled) => request('POST', '/api/service/boot', { enabled }),
};
