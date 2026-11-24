// Pulzar CV – the only script on a public CV page (CV-4, PL-13: ≤ 3 kB).
// Turnstile loads on the first click only (PL-14). One check yields a 10-minute pass that
// serves both the contact reveal and the PDF download.
(() => {
  const d = document, root = d.querySelector('[data-cv]');
  if (!root) return;
  const D = root.dataset, box = d.getElementById('cv-ts'), out = d.getElementById('cv-contact');
  let pass, loader, busy;

  const turnstile = () =>
    loader ||
    (loader = new Promise((ok, no) => {
      if (D.sk === 'dev') return ok(null);
      window.cvTs = () => ok(window.turnstile);
      const s = d.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=cvTs';
      s.async = true;
      s.onerror = () => { loader = null; no(); };
      d.head.append(s);
    }));

  const proof = async () => {
    if (pass) return { pass };
    const t = await turnstile();
    if (!t) return { token: 'dev' };
    box.hidden = false;
    return new Promise((ok, no) => {
      const id = t.render(box, {
        sitekey: D.sk,
        action: 'reveal',
        appearance: 'interaction-only',
        callback: (token) => { box.hidden = true; setTimeout(() => t.remove(id)); ok({ token }); },
        'error-callback': () => { t.remove(id); box.hidden = true; no(); },
      });
    });
  };

  const call = async (what) => {
    const r = await fetch(`${D.cv}/${what}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...(await proof()), lang: D.lang }),
    });
    if (!r.ok) { pass = null; throw 0; }
    const j = await r.json();
    pass = j.pass;
    return j;
  };

  const row = (value, href) => {
    const p = d.createElement('p'), a = d.createElement('a'), b = d.createElement('button');
    a.href = href;
    a.textContent = value;
    b.type = 'button';
    b.className = 'cv-copy';
    b.textContent = D.copy;
    b.onclick = () => navigator.clipboard.writeText(value).then(() => { b.textContent = D.copied; });
    p.append(a, ' ', b);
    return p;
  };

  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || busy) return;
    busy = true;
    b.setAttribute('aria-busy', 'true');
    try {
      if (b.dataset.act === 'pdf') {
        location.href = (await call('pdf')).url;
      } else {
        const j = await call('kontakt');
        out.textContent = '';
        if (j.email) out.append(row(j.email, `mailto:${j.email}`));
        if (j.phone) out.append(row(j.phone, `tel:${j.phone.replace(/[^\d+]/g, '')}`));
        out.hidden = false;
        b.hidden = true;
        out.querySelector('a')?.focus();
      }
    } catch {
      out.textContent = D.fail;
      out.hidden = false;
    } finally {
      busy = false;
      b.removeAttribute('aria-busy');
    }
  });
})();
