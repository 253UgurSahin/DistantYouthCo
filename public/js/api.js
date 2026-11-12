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

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'dyc', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parse(res);
}

/** Multipart upload with progress (0..1). */
export function upload(path, method, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `/api${path}`);
    xhr.setRequestHeader('X-Requested-With', 'dyc');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new ApiError(xhr.status, xhr.response?.error || `Upload mislukt (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Geen verbinding met de server.'));
    xhr.send(formData);
  });
}
