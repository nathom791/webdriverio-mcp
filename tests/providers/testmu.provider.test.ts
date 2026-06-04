import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestMuProvider } from '../../src/providers/cloud/testmu.provider';

describe('TestMuProvider', () => {
  let provider: TestMuProvider;

  beforeEach(() => {
    provider = new TestMuProvider();
    vi.stubEnv('TESTMU_USERNAME', 'testuser');
    vi.stubEnv('TESTMU_ACCESS_KEY', 'testkey');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('getConnectionConfig', () => {
    it('returns hub.lambdatest.com for browser platform', () => {
      const config = provider.getConnectionConfig({ platform: 'browser' });
      expect(config.hostname).toBe('hub.lambdatest.com');
      expect(config.protocol).toBe('https');
      expect(config.port).toBe(443);
      expect(config.path).toBe('/wd/hub');
    });

    it('returns mobile-hub.lambdatest.com for android platform', () => {
      const config = provider.getConnectionConfig({ platform: 'android' });
      expect(config.hostname).toBe('mobile-hub.lambdatest.com');
    });

    it('returns mobile-hub.lambdatest.com for ios platform', () => {
      const config = provider.getConnectionConfig({ platform: 'ios' });
      expect(config.hostname).toBe('mobile-hub.lambdatest.com');
    });

    it('reads credentials from environment variables', () => {
      const config = provider.getConnectionConfig({});
      expect(config.user).toBe('testuser');
      expect(config.key).toBe('testkey');
    });
  });

  describe('buildCapabilities — browser platform', () => {
    it('sets browserName and lt:options for browser platform', () => {
      const caps = provider.buildCapabilities({ platform: 'browser', browser: 'chrome' });
      expect(caps.browserName).toBe('chrome');
      expect(caps['lt:options']).toBeDefined();
    });

    it('defaults browserVersion to latest', () => {
      const caps = provider.buildCapabilities({ platform: 'browser', browser: 'firefox' });
      expect(caps.browserVersion).toBe('latest');
    });

    it('defaults platformName to Linux', () => {
      const caps = provider.buildCapabilities({ platform: 'browser', browser: 'chrome' });
      expect(caps.platformName).toBe('Linux');
    });

    it('passes reporting labels to lt:options', () => {
      const caps = provider.buildCapabilities({
        platform: 'browser',
        browser: 'firefox',
        reporting: { project: 'MyProject', build: 'build-1', session: 'login test' },
      });
      const lt = caps['lt:options'] as Record<string, unknown>;
      expect(lt.project).toBe('MyProject');
      expect(lt.build).toBe('build-1');
      expect(lt.name).toBe('login test');
    });

    it('uses project as name when session is not provided', () => {
      const caps = provider.buildCapabilities({
        platform: 'browser',
        browser: 'chrome',
        reporting: { project: 'MyProject' },
      });
      const lt = caps['lt:options'] as Record<string, unknown>;
      expect(lt.name).toBe('MyProject');
    });

    it('sets w3c: true in lt:options', () => {
      const caps = provider.buildCapabilities({ platform: 'browser', browser: 'chrome' });
      const lt = caps['lt:options'] as Record<string, unknown>;
      expect(lt.w3c).toBe(true);
    });

    it('includes credentials in lt:options', () => {
      const caps = provider.buildCapabilities({ platform: 'browser', browser: 'chrome' });
      const lt = caps['lt:options'] as Record<string, unknown>;
      expect(lt.username).toBe('testuser');
      expect(lt.accessKey).toBe('testkey');
    });

    it('sets tunnel: true when tunnel is enabled', () => {
      const caps = provider.buildCapabilities({
        platform: 'browser',
        browser: 'chrome',
        tunnel: true,
        tunnelName: 'my-tunnel',
      });
      const lt = caps['lt:options'] as Record<string, unknown>;
      expect(lt.tunnel).toBe(true);
      expect(lt.tunnelName).toBe('my-tunnel');
    });

    it('merges user capabilities at top level', () => {
      const caps = provider.buildCapabilities({
        platform: 'browser',
        browser: 'chrome',
        capabilities: { 'goog:chromeOptions': { args: ['--custom-flag'] } },
      });
      expect((caps['goog:chromeOptions'] as any)?.args).toContain('--custom-flag');
    });
  });

  describe('buildCapabilities — mobile platform', () => {
    it('sets platformName and appium:app for android native app', () => {
      const caps = provider.buildCapabilities({
        platform: 'android',
        deviceName: 'Pixel 7',
        platformVersion: '13',
        app: 'lt://abc123',
      });
      expect(caps.platformName).toBe('android');
      expect(caps['appium:app']).toBe('lt://abc123');
    });

    it('sets isRealMobile: true for native app mode', () => {
      const caps = provider.buildCapabilities({
        platform: 'android',
        deviceName: 'Pixel 7',
        app: 'lt://abc',
      });
      const lt = caps['lt:options'] as Record<string, unknown>;
      expect(lt.isRealMobile).toBe(true);
      expect(lt.appiumVersion).toBe('latest');
    });

    it('sets isRealMobile: false for mobile browser mode', () => {
      const caps = provider.buildCapabilities({
        platform: 'android',
        deviceName: 'Pixel 7',
        platformVersion: '13',
        browser: 'chrome',
      });
      const lt = caps['lt:options'] as Record<string, unknown>;
      expect(lt.isRealMobile).toBe(false);
      expect(lt.appiumVersion).toBe('2.11.0');
    });

    it('defaults autoGrantPermissions and autoAcceptAlerts to true', () => {
      const caps = provider.buildCapabilities({
        platform: 'android',
        deviceName: 'Pixel 7',
        app: 'lt://abc',
      });
      expect(caps['appium:autoGrantPermissions']).toBe(true);
      expect(caps['appium:autoAcceptAlerts']).toBe(true);
    });

    it('clears autoAcceptAlerts when autoDismissAlerts is set', () => {
      const caps = provider.buildCapabilities({
        platform: 'android',
        deviceName: 'Pixel 7',
        app: 'lt://abc',
        autoDismissAlerts: true,
      });
      expect(caps['appium:autoDismissAlerts']).toBe(true);
      expect(caps['appium:autoAcceptAlerts']).toBeUndefined();
    });

    it('defaults newCommandTimeout to 300', () => {
      const caps = provider.buildCapabilities({
        platform: 'android',
        deviceName: 'Pixel 7',
        app: 'lt://abc',
      });
      expect(caps['appium:newCommandTimeout']).toBe(300);
    });

    it('defaults automationName for iOS', () => {
      const caps = provider.buildCapabilities({
        platform: 'ios',
        deviceName: 'iPhone 15',
        app: 'lt://xyz',
      });
      expect(caps['appium:automationName']).toBe('XCUITest');
    });

    it('defaults automationName for Android', () => {
      const caps = provider.buildCapabilities({
        platform: 'android',
        deviceName: 'Pixel 7',
        app: 'lt://abc',
      });
      expect(caps['appium:automationName']).toBe('UiAutomator2');
    });
  });

  describe('getSessionType', () => {
    it('returns browser for browser platform', () => {
      expect(provider.getSessionType({ platform: 'browser' })).toBe('browser');
    });

    it('returns ios for ios platform', () => {
      expect(provider.getSessionType({ platform: 'ios' })).toBe('ios');
    });

    it('returns android for android platform', () => {
      expect(provider.getSessionType({ platform: 'android' })).toBe('android');
    });
  });

  describe('shouldAutoDetach', () => {
    it('always returns false', () => {
      expect(provider.shouldAutoDetach({})).toBe(false);
    });
  });

  describe('onSessionClose', () => {
    it('sends PATCH with status_ind passed to the LambdaTest API', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

      await provider.onSessionClose('session-123', 'browser', { status: 'passed' });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.lambdatest.com/automation/api/v1/sessions/session-123',
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ status_ind: 'passed' }),
        }),
      );
    });

    it('sends status_ind failed when status is failed', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

      await provider.onSessionClose('session-456', 'android', { status: 'failed' });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ status_ind: 'failed' }),
        }),
      );
    });

    it('does not throw when fetch fails', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));

      await expect(
        provider.onSessionClose('session-789', 'browser', { status: 'passed' }),
      ).resolves.toBeUndefined();
    });

    it('skips API call when credentials are missing', async () => {
      vi.stubEnv('TESTMU_USERNAME', '');
      vi.stubEnv('TESTMU_ACCESS_KEY', '');
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

      await provider.onSessionClose('session-123', 'browser', { status: 'passed' });

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
