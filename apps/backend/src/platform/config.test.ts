import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    const config = loadConfig({});

    expect(config.port).toBe(3000);
    expect(config.frontendOrigins).toEqual(['http://localhost:5173']);
    expect(config.auth.localEmail).toBe('local@nexus.dev');
    expect(config.auth.secureCookie).toBe(false);
    expect(config.auth.allowRegistration).toBe(false);
    expect(config.auth.password).toBeUndefined();
  });

  it('parses ports, origins and booleans', () => {
    const config = loadConfig({
      PORT: '8080',
      FRONTEND_ORIGIN: 'https://nexus.example.com, https://learn.example.com',
      AUTH_PASSWORD: 'secret',
      AUTH_COOKIE_SECURE: 'true',
      ALLOW_REGISTRATION: 'true',
      LOCAL_USER_EMAIL: 'owner@example.com',
    });

    expect(config.port).toBe(8080);
    expect(config.frontendOrigins).toEqual([
      'https://nexus.example.com',
      'https://learn.example.com',
    ]);
    expect(config.auth).toMatchObject({
      password: 'secret',
      secureCookie: true,
      allowRegistration: true,
      localEmail: 'owner@example.com',
    });
  });

  it('treats an empty password as auth disabled', () => {
    expect(loadConfig({ AUTH_PASSWORD: '' }).auth.password).toBeUndefined();
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects a non-URL origin with the offending key in the message', () => {
    expect(() => loadConfig({ FRONTEND_ORIGIN: 'not a url' })).toThrow(
      /frontendOrigins/,
    );
  });
});
