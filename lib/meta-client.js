// Cliente HTTP minimo pra Meta Graph API. Usa fetch nativo (Node 18+).

function getApiBase() {
  const version = process.env.META_API_VERSION || 'v21.0';
  return `https://graph.facebook.com/${version}`;
}

async function metaGet(path, params = {}) {
  const url = new URL(`${getApiBase()}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.error) {
    throw new Error(`Meta API error [GET ${path}]: ${data.error.message} (code ${data.error.code}, type ${data.error.type})`);
  }
  return data;
}

async function metaPost(path, params = {}) {
  const url = new URL(`${getApiBase()}/${path}`);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Meta API error [POST ${path}]: ${data.error.message} (code ${data.error.code}, type ${data.error.type})`);
  }
  return data;
}

module.exports = { metaGet, metaPost };
