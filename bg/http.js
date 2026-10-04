// Timed fetch. Only ever used for the AI providers — the extension makes no network
// requests to Upwork (it reads the page you opened, on your click, via activeTab).
export async function timedFetch(url, init = {}, ms = 15000, what = 'Request') {
  const ctl = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (timedOut || e?.name === 'AbortError') {
      const err = new Error(`${what} timed out after ${Math.round(ms / 1000)}s.`);
      err.reason = 'timeout';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}
