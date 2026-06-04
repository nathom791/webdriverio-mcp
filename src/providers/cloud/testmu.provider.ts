import { basicAuth } from '../../utils/auth';
import type { ConnectionConfig, SessionProvider, SessionResult } from '../types';
import type { Browser as WdioBrowser } from 'webdriverio';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class TestMuProvider implements SessionProvider {
  name = 'testmu';

  getConnectionConfig(options: Record<string, unknown>): ConnectionConfig {
    const platform = options.platform as string;
    const isBrowser = platform === 'browser';
    return {
      protocol: 'https',
      hostname: isBrowser ? 'hub.lambdatest.com' : 'mobile-hub.lambdatest.com',
      port: 443,
      path: '/wd/hub',
      user: process.env.TESTMU_USERNAME,
      key: process.env.TESTMU_ACCESS_KEY,
    };
  }

  buildCapabilities(options: Record<string, unknown>): Record<string, unknown> {
    const platform = options.platform as string;
    const userCapabilities = (options.capabilities as Record<string, unknown> | undefined) ?? {};
    const tunnel = (options.tunnel ?? options.testmuLocal) as boolean | string | undefined;
    const reporting = options.reporting as { project?: string; build?: string; session?: string } | undefined;

    const ltOptions: Record<string, unknown> = { w3c: true };

    if (process.env.TESTMU_USERNAME) ltOptions.username = process.env.TESTMU_USERNAME;
    if (process.env.TESTMU_ACCESS_KEY) ltOptions.accessKey = process.env.TESTMU_ACCESS_KEY;
    if (reporting?.project) ltOptions.project = reporting.project;
    if (reporting?.build) ltOptions.build = reporting.build;
    if (reporting?.session) ltOptions.name = reporting.session;
    else if (reporting?.project) ltOptions.name = reporting.project;

    if (tunnel) {
      ltOptions.tunnel = true;
      if (options.tunnelName) ltOptions.tunnelName = options.tunnelName;
    }

    if (platform === 'browser') {
      return {
        browserName: (options.browser as string | undefined) ?? 'chrome',
        browserVersion: (options.browserVersion as string | undefined) ?? 'latest',
        platformName: (options.os as string | undefined) ?? 'Linux',
        'lt:options': ltOptions,
        ...userCapabilities,
      };
    }

    // Mobile (ios / android)
    const mobileBrowser = options.browser as string | undefined;

    // Mobile browser/emulator mode (e.g. Chrome on Android emulator)
    if (mobileBrowser) {
      ltOptions.appiumVersion = '2.11.0';
      ltOptions.isRealMobile = false;
      if (options.deviceOrientation) ltOptions.deviceOrientation = options.deviceOrientation;

      const caps: Record<string, unknown> = {
        platformName: platform,
        browserName: mobileBrowser,
        'appium:deviceName': options.deviceName,
        'appium:platformVersion': options.platformVersion,
        'appium:automationName': (options.automationName as string | undefined) ?? (platform === 'ios' ? 'XCUITest' : 'UiAutomator2'),
        'appium:newCommandTimeout': (options.newCommandTimeout as number | undefined) ?? 300,
        'lt:options': ltOptions,
      };
      return { ...caps, ...userCapabilities };
    }

    // Mobile native app mode
    ltOptions.appiumVersion = 'latest';
    ltOptions.isRealMobile = true;

    const autoAcceptAlerts = options.autoAcceptAlerts as boolean | undefined;
    const autoDismissAlerts = options.autoDismissAlerts as boolean | undefined;

    const caps: Record<string, unknown> = {
      platformName: platform,
      'appium:app': options.app,
      'appium:deviceName': options.deviceName,
      'appium:platformVersion': options.platformVersion,
      'appium:automationName': (options.automationName as string | undefined) ?? (platform === 'ios' ? 'XCUITest' : 'UiAutomator2'),
      'appium:autoGrantPermissions': (options.autoGrantPermissions as boolean | undefined) ?? true,
      'appium:autoAcceptAlerts': autoDismissAlerts ? undefined : (autoAcceptAlerts ?? true),
      'appium:autoDismissAlerts': autoDismissAlerts,
      'appium:newCommandTimeout': (options.newCommandTimeout as number | undefined) ?? 300,
      'lt:options': ltOptions,
    };

    return { ...caps, ...userCapabilities };
  }

  getSessionType(options: Record<string, unknown>): 'browser' | 'ios' | 'android' {
    const platform = options.platform as string;
    if (platform === 'browser') return 'browser';
    return platform as 'ios' | 'android';
  }

  shouldAutoDetach(_options: Record<string, unknown>): boolean {
    return false;
  }

  async startTunnel(options: Record<string, unknown>): Promise<unknown> {
    const tunnelName = (options.tunnelName as string | undefined) ?? `wdio-mcp-testmu-${Date.now()}`;
    const logFile = join(tmpdir(), 'testmu-tunnel.log');
    console.error(`[TestMu] Starting tunnel "${tunnelName}"`);
    try {
      const { default: LambdaTunnel } = await import('@lambdatest/node-tunnel');
      const tunnel = new LambdaTunnel();
      await tunnel.start({
        user: process.env.TESTMU_USERNAME ?? '',
        key: process.env.TESTMU_ACCESS_KEY ?? '',
        tunnelName,
        logFile,
      });
      console.error(`[TestMu] Tunnel started: "${tunnelName}"`);
      return tunnel;
    } catch (e: unknown) {
      const msg = (e !== null && typeof e === 'object' ? (e as { message?: string }).message : undefined) ?? String(e);
      if (msg.includes('already running') || msg.includes('another tunnel') || msg.includes('already in use')) {
        console.error('[TestMu] Tunnel already running — reusing existing tunnel');
        return null;
      }
      throw e;
    }
  }

  async onSessionClose(
    sessionId: string,
    _sessionType: 'browser' | 'ios' | 'android',
    result: SessionResult,
    _tunnelHandle?: unknown,
    _browser?: WdioBrowser,
    _region?: string,
  ): Promise<void> {
    const user = process.env.TESTMU_USERNAME;
    const key = process.env.TESTMU_ACCESS_KEY;
    if (user && key) {
      try {
        const auth = basicAuth(user, key);
        const body = { status_ind: result.status === 'passed' ? 'passed' : 'failed' };
        const apiUrl = `https://api.lambdatest.com/automation/api/v1/sessions/${sessionId}`;
        console.error(`[TestMu] Setting session status for ${sessionId}: ${body.status_ind}`);
        const res = await fetch(apiUrl, {
          method: 'PATCH',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          console.error('[TestMu] Session status set successfully via REST API');
        } else {
          const resBody = await res.text();
          console.error(`[TestMu] Failed to set session status: HTTP ${res.status} — ${resBody}`);
        }
      } catch (e) {
        console.error('[TestMu] Failed to set session status via REST API:', e);
      }
    }
  }

  async stopTunnel(tunnelHandle?: unknown): Promise<void> {
    if (tunnelHandle) {
      const tunnel = tunnelHandle as { stop: () => Promise<void> };
      await tunnel.stop();
    }
  }
}

export const testMuProvider = new TestMuProvider();
