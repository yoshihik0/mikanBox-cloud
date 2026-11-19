// Cloud edition only: visual editing uploads an image in three steps, because media files live only on the
// public site. The visual API checks and names the file; this script publishes those bytes and records the
// file (as the media screen does); only then does the shared editor (visual.js) receive the name.
(() => {
  'use strict';
  const original = window.fetch.bind(window);
  const isUpload = (input, init) => (init?.method || 'GET').toUpperCase() === 'POST' && /[?&]api=upload(?:&|$)/.test(String(input?.url || input));
  window.fetch = async (input, init = {}) => {
    if (!isUpload(input, init)) return original(input, init);
    const body = init.body;
    const response = await original(input, init);
    const result = await response.clone().json().catch(() => null);
    if (!response.ok || !result?.media) return response;
    const answer = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    try {
      const file = body instanceof Blob ? body : new Blob([body]);
      const bytes = new Uint8Array(await file.arrayBuffer());
      await window.cloudPublish(false, [], result.media.name, { newMedia: result.media, bytes });
      const commit = new FormData();
      commit.set('save_action', 'upload_media'); commit.set('csrf_token', window.CSRF_TOKEN); commit.set('ajax_request', '1');
      commit.set('media_name', result.media.name); commit.set('image', new File([bytes], result.media.name, { type: result.media.content_type }));
      const saved = await original('/admin', { method: 'POST', body: commit, credentials: 'same-origin' }).then(r => r.json());
      if (!saved.success) return answer({ error: saved.message || 'Upload failed.' }, 409);
      return answer({ name: result.media.name });
    } catch (error) {
      return answer({ error: error.message || 'Upload failed.' }, 409);
    }
  };
})();
