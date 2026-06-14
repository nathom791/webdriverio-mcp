import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getState } from '../../src/session/state';
import {
  installWebExtensionTool,
  openWebExtensionPageTool,
  uninstallWebExtensionTool,
} from '../../src/tools/web-extension.tool';

const mockInstall = vi.fn();
const mockUninstall = vi.fn();
const mockUrl = vi.fn();

type ToolFn = (args: Record<string, unknown>) => Promise<{
  content: { text: string }[];
  isError?: boolean;
}>;

const callInstall = installWebExtensionTool as unknown as ToolFn;
const callUninstall = uninstallWebExtensionTool as unknown as ToolFn;
const callOpen = openWebExtensionPageTool as unknown as ToolFn;

function setupSession(options: {
  type?: 'browser' | 'ios' | 'android';
  isBidi?: boolean;
  browserName?: string;
  isFirefox?: boolean;
  webExtensions?: string[];
  omitInstall?: boolean;
  omitUninstall?: boolean;
} = {}) {
  const {
    type = 'browser',
    isBidi = true,
    browserName = 'chrome',
    isFirefox = false,
    webExtensions,
    omitInstall = false,
    omitUninstall = false,
  } = options;

  const browser: Record<string, unknown> = {
    isBidi,
    isFirefox,
    capabilities: { browserName },
    url: mockUrl,
  };

  if (!omitInstall) {
    browser.webExtensionInstall = mockInstall;
  }
  if (!omitUninstall) {
    browser.webExtensionUninstall = mockUninstall;
  }

  const state = getState();
  state.currentSession = 'test-session';
  state.browsers.set('test-session', browser as unknown as WebdriverIO.Browser);
  state.sessionMetadata.set('test-session', {
    type,
    capabilities: { browserName },
    isAttached: false,
    ...(webExtensions ? { webExtensions } : {}),
  });
  state.sessionHistory.set('test-session', {
    sessionId: 'test-session',
    type,
    startedAt: '2026-01-01T00:00:00.000Z',
    capabilities: { browserName },
    steps: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInstall.mockResolvedValue({ extension: 'ext-123' });
  mockUninstall.mockResolvedValue(null);
  mockUrl.mockResolvedValue(undefined);

  const state = getState();
  state.browsers.clear();
  state.sessionMetadata.clear();
  state.sessionHistory.clear();
  state.currentSession = null;
});

describe('install_web_extension', () => {
  it.each([
    { type: 'path', path: '/tmp/unpacked-extension' },
    { type: 'archivePath', path: '/tmp/extension.zip' },
    { type: 'base64', value: 'UEsDBAo=' },
  ])('passes %s extensionData to webExtension.install', async (extensionData) => {
    setupSession();
    const result = await callInstall({ extensionData });

    expect(result.isError).toBeFalsy();
    expect(mockInstall).toHaveBeenCalledWith({ extensionData });
    expect(result.content[0].text).toContain('ext-123');
  });

  it('stores installed extension ids on session metadata', async () => {
    setupSession();
    await callInstall({ extensionData: { type: 'path', path: '/tmp/ext' } });

    const metadata = getState().sessionMetadata.get('test-session');
    expect(metadata?.webExtensions).toEqual(['ext-123']);
  });

  it('returns an error when there is no active session', async () => {
    const result = await callInstall({ extensionData: { type: 'path', path: '/tmp/ext' } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No active browser session');
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('returns an error for mobile sessions', async () => {
    setupSession({ type: 'ios' });
    const result = await callInstall({ extensionData: { type: 'path', path: '/tmp/ext' } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('browser sessions');
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('returns an error when the session is not BiDi-enabled', async () => {
    setupSession({ isBidi: false });
    const result = await callInstall({ extensionData: { type: 'path', path: '/tmp/ext' } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('BiDi-enabled');
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('returns an error when WebdriverIO does not expose webExtensionInstall', async () => {
    setupSession({ omitInstall: true });
    const result = await callInstall({ extensionData: { type: 'path', path: '/tmp/ext' } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('webExtensionInstall');
  });

  it('returns an error when the driver rejects installation', async () => {
    setupSession();
    mockInstall.mockRejectedValueOnce(new Error('invalid web extension'));
    const result = await callInstall({ extensionData: { type: 'path', path: '/tmp/ext' } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('invalid web extension');
  });
});

describe('uninstall_web_extension', () => {
  it('calls webExtension.uninstall and removes the id from metadata', async () => {
    setupSession({ webExtensions: ['ext-old', 'ext-123'] });
    const result = await callUninstall({ extension: 'ext-123' });

    expect(result.isError).toBeFalsy();
    expect(mockUninstall).toHaveBeenCalledWith({ extension: 'ext-123' });
    expect(getState().sessionMetadata.get('test-session')?.webExtensions).toEqual(['ext-old']);
  });

  it('returns an error when WebdriverIO does not expose webExtensionUninstall', async () => {
    setupSession({ omitUninstall: true });
    const result = await callUninstall({ extension: 'ext-123' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('webExtensionUninstall');
  });
});

describe('open_web_extension_page', () => {
  it('opens a direct extension URL when provided', async () => {
    setupSession();
    const url = 'chrome-extension://ext-123/options.html';
    const result = await callOpen({ url, extension: 'ignored', path: 'ignored.html' });

    expect(result.isError).toBeFalsy();
    expect(mockUrl).toHaveBeenCalledWith(url);
  });

  it('opens the latest installed extension page by default', async () => {
    setupSession({ webExtensions: ['ext-123'] });
    const result = await callOpen({ path: '/options.html' });

    expect(result.isError).toBeFalsy();
    expect(mockUrl).toHaveBeenCalledWith('chrome-extension://ext-123/options.html');
  });

  it('infers moz-extension URLs for Firefox', async () => {
    setupSession({ browserName: 'firefox', isFirefox: true, webExtensions: ['firefox-ext'] });
    await callOpen({ path: 'popup.html' });

    expect(mockUrl).toHaveBeenCalledWith('moz-extension://firefox-ext/popup.html');
  });

  it('uses explicit extension and scheme when provided', async () => {
    setupSession();
    await callOpen({ extension: 'ext-456', scheme: 'moz-extension', path: 'panel.html' });

    expect(mockUrl).toHaveBeenCalledWith('moz-extension://ext-456/panel.html');
  });

  it('returns an error when no url or extension id is available', async () => {
    setupSession();
    const result = await callOpen({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('provide url');
    expect(mockUrl).not.toHaveBeenCalled();
  });
});
