export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function parse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* no JSON */
  }
  if (!res.ok) {
    if (res.status === 401 && !location.hash.startsWith('#/login')) window.dispatchEvent(new CustomEvent('dyc:signed-out'));
    throw new ApiError(res.status, body?.error || `Er ging iets mis (${res.status}).`);
  }
  return body;
}

// Many shared hosts let only GET and POST through. Other methods go as a POST that names the real one;
// both servers (Node and PHP) read X-HTTP-Method-Override.
const wire = (method) => (method === 'GET' || method === 'POST' ? { method, extra: {} } : { method: 'POST', extra: { 'X-HTTP-Method-Override': method } });

export const OFFLINE = 'Geen verbinding met de server. Controleer je internet en probeer het opnieuw.';

export async function api(path, { method = 'GET', body } = {}) {
  const w = wire(method);
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method: w.method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'dyc', ...w.extra, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // The browser could not reach the server at all: its own text ("Failed to fetch") means nothing to a person.
    throw new ApiError(0, OFFLINE);
  }
  return parse(res);
}

/** Multipart upload with progress (0..1). */
export function upload(path, method, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const w = wire(method);
    xhr.open(w.method, `/api${path}`);
    xhr.setRequestHeader('X-Requested-With', 'dyc');
    for (const [k, v] of Object.entries(w.extra)) xhr.setRequestHeader(k, v);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new ApiError(xhr.status, xhr.response?.error || `Upload mislukt (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new ApiError(0, OFFLINE));
    xhr.send(formData);
  });
}

/** One raw chunk to the server, with progress of that chunk (0..1). */
function sendChunk(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('X-Requested-With', 'dyc');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.response) : reject(new ApiError(xhr.status, xhr.response?.error || `Upload mislukt (${xhr.status}).`)));
    xhr.onerror = () => reject(new ApiError(0, OFFLINE));
    xhr.send(blob);
  });
}

/**
 * A large file in pieces, for a server with a small upload limit (shared hosting). Returns a token
 * that the release form sends instead of the file. A piece that fails is tried again a few times,
 * and the server says how much it has, so a dropped connection resumes instead of starting over.
 */
export async function uploadInChunks(file, chunkSize, onProgress) {
  const { token } = await api('/uploads', { method: 'POST', body: { name: file.name, size: file.size } });
  let offset = 0;
  let tries = 0;
  while (offset < file.size) {
    // Cut each time from where the server is, also after a retry.
    const at = offset;
    const piece = file.slice(at, Math.min(file.size, at + chunkSize));
    try {
      const res = await sendChunk(`/api/uploads/${token}?offset=${at}`, piece, (p) => onProgress?.((at + p * piece.size) / file.size));
      if (!(res?.received > at)) throw new ApiError(502, 'De server nam dit stuk niet aan.');
      offset = res.received;
      tries = 0;
    } catch (e) {
      if (++tries >= 4 || (e.status >= 400 && e.status < 500 && e.status !== 409)) throw e;
      await new Promise((r) => setTimeout(r, 800 * tries));
      offset = (await api(`/uploads/${token}`)).received;
    }
    onProgress?.(offset / file.size);
  }
  return token;
}


/**
 * A release form with its files ({ wav: File, video: File, ... }): on a host with a small upload
 * limit (chunkSize > 0) every file goes up in pieces first and the form names them; otherwise the
 * files go in the form. onProgress gets 0..1 over all of it.
 */
export async function sendRelease(path, method, fd, files, chunkSize, onProgress) {
  if (chunkSize) {
    const list = Object.entries(files);
    const total = list.reduce((n, [, f]) => n + f.size, 0) || 1;
    let done = 0;
    for (const [k, f] of list) {
      const token = await uploadInChunks(f, chunkSize, (p) => onProgress?.((done + p * f.size) / total));
      done += f.size;
      fd.append(`${k}_upload`, token);
    }
    return upload(path, method, fd, null);
  }
  for (const [k, f] of Object.entries(files)) fd.append(k, f);
  return upload(path, method, fd, onProgress);
}
