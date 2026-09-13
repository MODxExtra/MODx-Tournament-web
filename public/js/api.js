const API = {
  token: () => localStorage.getItem('token'),
  setToken: (t) => t ? localStorage.setItem('token', t) : localStorage.removeItem('token'),
  user: () => JSON.parse(localStorage.getItem('user') || 'null'),
  setUser: (u) => u ? localStorage.setItem('user', JSON.stringify(u)) : localStorage.removeItem('user'),
  logout: () => { localStorage.removeItem('token'); localStorage.removeItem('user'); location.href = '/'; },
  async req(method, url, body, isForm) {
    const headers = {};
    const t = API.token(); if (t) headers.Authorization = 'Bearer ' + t;
    let payload = body;
    if (body && !isForm) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(url, { method, headers, body: payload });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'request failed'), { status: res.status, data });
    return data;
  },
  get: (u) => API.req('GET', u),
  post: (u, b) => API.req('POST', u, b),
  put: (u, b) => API.req('PUT', u, b),
  del: (u) => API.req('DELETE', u),
  postForm: (u, fd) => API.req('POST', u, fd, true),
  putForm: (u, fd) => API.req('PUT', u, fd, true),
};

function toast(msg, type = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(t) {
  if (!t) return '—';
  try { return new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return t; }
}

function fmtMoney(n) { return '₹' + Number(n || 0).toFixed(2); }
