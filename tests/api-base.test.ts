import { describe, expect, it } from 'vitest';
import { apiBase } from '../src/client/lib/api';

describe('apiBase', () => {
  it('adds https:// to a bare host so the browser does not treat it as a path', () => {
    expect(apiBase('aicoliseum-server-production.up.railway.app')).toBe('https://aicoliseum-server-production.up.railway.app');
  });

  it('keeps a full URL and trims trailing slashes', () => {
    expect(apiBase('https://x.up.railway.app/')).toBe('https://x.up.railway.app');
    expect(apiBase('http://localhost:8787')).toBe('http://localhost:8787');
  });

  it('means same origin when empty', () => {
    expect(apiBase(undefined)).toBe('');
    expect(apiBase('  ')).toBe('');
  });
});
