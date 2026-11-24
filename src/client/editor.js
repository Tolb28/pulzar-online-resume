// Pulzar CV editor – progressive enhancement. Every form works without this script.
(() => {
  const d = document;

  // Live counters against the limits (CV-1): "523 / 600", red when over. Nothing is cut.
  const count = (el) => {
    const max = Number(el.dataset.max);
    const out = el.closest('.field')?.querySelector('[data-count]');
    if (!max || !out) return;
    const n = [...el.value.normalize('NFC')].length;
    out.textContent = `${n} / ${max}`;
    out.classList.toggle('over', n > max);
  };
  d.addEventListener('input', (e) => {
    if (e.target.matches('[data-max]')) count(e.target);
  });

  // Confirm before pausing, sending for approval, deleting…
  d.addEventListener('click', (e) => {
    const b = e.target.closest('[data-confirm]');
    if (b && !confirm(b.dataset.confirm)) e.preventDefault();
  });

  // Images: resize and re-encode in the browser before upload. Re-encoding also drops the
  // metadata (EXIF location); the server checks again either way.
  const LIMITS = { photo: [900, 280e3], project: [1600, 560e3], cover: [2200, 760e3] };
  const shrink = async (file, kind) => {
    const [side, bytes] = LIMITS[kind] || LIMITS.project;
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = d.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.86, 0.78, 0.7, 0.6, 0.5]) {
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', q));
      if (blob && (blob.size <= bytes || q === 0.5)) return new File([blob], 'image.jpg', { type: 'image/jpeg' });
    }
    return file;
  };
  d.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form.matches('[data-upload]')) return;
    const input = d.querySelector(`input[type=file][form="${form.id}"]`) || form.querySelector('input[type=file]');
    const file = input && input.files && input.files[0];
    if (!file || !/^image\//.test(file.type) || typeof createImageBitmap !== 'function') return;
    e.preventDefault();
    try {
      const small = await shrink(file, form.dataset.upload);
      const dt = new DataTransfer();
      dt.items.add(small);
      input.files = dt.files;
    } catch {
      // Fall back to the original file; the server will say if it is too big.
    }
    // Hidden forms get the file input moved in, because form="" inputs are not always sent by form.submit().
    if (input.form !== form) form.append(input);
    form.submit();
  });

  // Custom accent (Profi, Na míru): show the WCAG contrast on white while choosing (CV-2).
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const showContrast = (input) => {
    const out = d.querySelector('[data-contrast-out]');
    if (!out) return;
    const ratio = 1.05 / (lum(input.value) + 0.05);
    const min = Number(input.dataset.contrast || 4.5);
    out.textContent = `Kontrast na bílém: ${ratio.toFixed(1)} : 1 (potřeba aspoň ${min} : 1)`;
    out.classList.toggle('over', ratio < min);
  };
  d.addEventListener('input', (e) => {
    if (e.target.matches('input[type=color][data-contrast]')) showContrast(e.target);
  });
  d.addEventListener('click', (e) => {
    const sw = e.target.closest('button[data-color]');
    const input = d.querySelector('input[type=color][data-contrast]');
    if (!sw || !input) return;
    input.value = sw.dataset.color;
    showContrast(input);
  });

  // New CV: suggest the address from the name until the holder edits it.
  const slug = d.querySelector('[data-slug]');
  const name = d.getElementById('name');
  if (slug && name) {
    let touched = !!slug.value;
    slug.addEventListener('input', () => (touched = true));
    name.addEventListener('input', () => {
      if (touched) return;
      slug.value = name.value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);
    });
  }
})();
