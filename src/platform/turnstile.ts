// CV-4: Turnstile check for the contact reveal and the PDF (E3: one widget per environment).

export interface TurnstileVerifier {
  verify(token: string, ip: string | null): Promise<boolean>;
}

export function turnstileVerifier(secret: string, opts: { devBypass: boolean; expectedAction?: string; fetcher?: typeof fetch }): TurnstileVerifier {
  return {
    async verify(token, ip) {
      if (!token || token.length > 2048) return false;
      // Local development without network access to Cloudflare: the page sends "dev".
      if (opts.devBypass && token === 'dev') return true;
      const body = new FormData();
      body.append('secret', secret);
      body.append('response', token);
      if (ip) body.append('remoteip', ip);
      try {
        const r = await (opts.fetcher ?? fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
        const j = (await r.json()) as { success?: boolean; action?: string };
        if (!j.success) return false;
        return !opts.expectedAction || !j.action || j.action === opts.expectedAction;
      } catch {
        return false;
      }
    },
  };
}
