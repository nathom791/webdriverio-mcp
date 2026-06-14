import type { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getBrowser, getState } from '../session/state';
import type { ToolDefinition } from '../types/tool';

type WebExtensionData =
  | { type: 'path'; path: string }
  | { type: 'archivePath'; path: string }
  | { type: 'base64'; value: string };

type WebExtensionInstallResult = { extension: string };

type WebExtensionBrowser = WebdriverIO.Browser & {
  webExtensionInstall?: (params: { extensionData: WebExtensionData }) => Promise<WebExtensionInstallResult>;
  webExtensionUninstall?: (params: { extension: string }) => Promise<Record<string, never> | null>;
};

type BrowserSession = {
  browser: WebExtensionBrowser;
  sessionId: string;
};

type InstallWebExtensionArgs = {
  extensionData: WebExtensionData;
};

type UninstallWebExtensionArgs = {
  extension: string;
};

type OpenWebExtensionPageArgs = {
  extension?: string;
  path?: string;
  url?: string;
  scheme?: 'chrome-extension' | 'moz-extension';
};

const extensionDataSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('path'),
    path: z.string().min(1).describe('Path to an unpacked extension directory on the remote end.'),
  }),
  z.object({
    type: z.literal('archivePath'),
    path: z.string().min(1).describe('Path to a packaged extension archive on the remote end.'),
  }),
  z.object({
    type: z.literal('base64'),
    value: z.string().min(1).describe('Base64-encoded packaged extension archive.'),
  }),
]);

function getBrowserSession(): BrowserSession | CallToolResult {
  const state = getState();
  const sessionId = state.currentSession;
  if (!sessionId) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'Error: No active browser session' }],
    };
  }

  const browser = getBrowser() as WebExtensionBrowser;
  const metadata = state.sessionMetadata.get(sessionId);

  if (metadata?.type === 'ios' || metadata?.type === 'android') {
    return {
      isError: true,
      content: [{ type: 'text', text: 'Error: web extension tools are only supported for browser sessions.' }],
    };
  }

  if (!browser.isBidi) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: 'Error: web extension tools require a BiDi-enabled browser session. Start a browser session with capabilities: { webSocketUrl: true }.',
      }],
    };
  }

  return { browser, sessionId };
}

function isToolResult(value: BrowserSession | CallToolResult): value is CallToolResult {
  return 'content' in value;
}

function rememberExtension(sessionId: string, extension: string): void {
  const state = getState();
  const metadata = state.sessionMetadata.get(sessionId);
  if (!metadata) return;

  const extensions = metadata.webExtensions ?? [];
  if (!extensions.includes(extension)) {
    extensions.push(extension);
  }
  metadata.webExtensions = extensions;
}

function forgetExtension(sessionId: string, extension: string): void {
  const state = getState();
  const metadata = state.sessionMetadata.get(sessionId);
  if (!metadata?.webExtensions) return;

  metadata.webExtensions = metadata.webExtensions.filter((id) => id !== extension);
  if (metadata.webExtensions.length === 0) {
    delete metadata.webExtensions;
  }
}

function getLatestExtension(sessionId: string): string | undefined {
  const extensions = getState().sessionMetadata.get(sessionId)?.webExtensions;
  return extensions?.[extensions.length - 1];
}

function inferExtensionScheme(browser: WebExtensionBrowser): 'chrome-extension' | 'moz-extension' {
  const browserName = String(browser.capabilities?.browserName ?? '').toLowerCase();
  return browser.isFirefox || browserName.includes('firefox') ? 'moz-extension' : 'chrome-extension';
}

function normalizeExtensionPath(path?: string): string {
  if (!path) return '';
  return path.replace(/^\/+/, '');
}

function resolveExtensionUrl(session: BrowserSession, args: OpenWebExtensionPageArgs): string | undefined {
  if (args.url) return args.url;

  const extensionId = args.extension ?? getLatestExtension(session.sessionId);
  if (!extensionId) return undefined;

  const scheme = args.scheme ?? inferExtensionScheme(session.browser);
  return `${scheme}://${extensionId}/${normalizeExtensionPath(args.path)}`;
}

export const installWebExtensionToolDefinition: ToolDefinition = {
  name: 'install_web_extension',
  description: 'Installs a web extension through the W3C WebDriver BiDi webExtension.install command. Requires a BiDi-enabled browser session. Use base64 for cloud/remote sessions where the browser driver cannot read the MCP server filesystem.',
  annotations: { title: 'Install Web Extension', destructiveHint: false },
  inputSchema: {
    extensionData: extensionDataSchema.describe('W3C BiDi webExtension.ExtensionData: unpacked directory path, archive path, or base64 archive.'),
  },
};

export const uninstallWebExtensionToolDefinition: ToolDefinition = {
  name: 'uninstall_web_extension',
  description: 'Uninstalls a previously installed web extension through the W3C WebDriver BiDi webExtension.uninstall command.',
  annotations: { title: 'Uninstall Web Extension', destructiveHint: true },
  inputSchema: {
    extension: z.string().min(1).describe('Extension id returned by install_web_extension.'),
  },
};

export const openWebExtensionPageToolDefinition: ToolDefinition = {
  name: 'open_web_extension_page',
  description: 'Opens an installed extension page so existing MCP tools can inspect and drive its UI. Provide url directly, or provide extension/path to build a chrome-extension:// or moz-extension:// URL.',
  annotations: { title: 'Open Web Extension Page', destructiveHint: false },
  inputSchema: {
    extension: z.string().min(1).optional().describe('Extension id. Defaults to the most recently installed extension in the active session.'),
    path: z.string().optional().describe('Path inside the extension package, such as options.html or popup.html. Leading slashes are ignored.'),
    url: z.string().min(1).optional().describe('Full extension URL to open directly. If set, extension/path/scheme are ignored.'),
    scheme: z.enum(['chrome-extension', 'moz-extension']).optional().describe('Extension URL scheme. Defaults to moz-extension for Firefox and chrome-extension otherwise.'),
  },
};

export const installWebExtensionTool: ToolCallback = async ({ extensionData }: InstallWebExtensionArgs): Promise<CallToolResult> => {
  try {
    const session = getBrowserSession();
    if (isToolResult(session)) return session;

    if (typeof session.browser.webExtensionInstall !== 'function') {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: 'Error: the active WebdriverIO browser does not expose webExtensionInstall. Upgrade WebdriverIO or use a browser driver with WebDriver BiDi webExtension support.',
        }],
      };
    }

    const result = await session.browser.webExtensionInstall({ extensionData });
    if (!result?.extension || typeof result.extension !== 'string') {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error: webExtension.install returned an unexpected result: ${JSON.stringify(result)}` }],
      };
    }

    rememberExtension(session.sessionId, result.extension);
    return {
      content: [{ type: 'text', text: `Installed web extension: ${result.extension}` }],
    };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error installing web extension: ${e}` }],
    };
  }
};

export const uninstallWebExtensionTool: ToolCallback = async ({ extension }: UninstallWebExtensionArgs): Promise<CallToolResult> => {
  try {
    const session = getBrowserSession();
    if (isToolResult(session)) return session;

    if (typeof session.browser.webExtensionUninstall !== 'function') {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: 'Error: the active WebdriverIO browser does not expose webExtensionUninstall. Upgrade WebdriverIO or use a browser driver with WebDriver BiDi webExtension support.',
        }],
      };
    }

    await session.browser.webExtensionUninstall({ extension });
    forgetExtension(session.sessionId, extension);
    return {
      content: [{ type: 'text', text: `Uninstalled web extension: ${extension}` }],
    };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error uninstalling web extension: ${e}` }],
    };
  }
};

export const openWebExtensionPageTool: ToolCallback = async (args: OpenWebExtensionPageArgs): Promise<CallToolResult> => {
  try {
    const session = getBrowserSession();
    if (isToolResult(session)) return session;

    const targetUrl = resolveExtensionUrl(session, args);
    if (!targetUrl) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Error: provide url, extension, or install a web extension first.' }],
      };
    }

    await session.browser.url(targetUrl);
    return {
      content: [{ type: 'text', text: `Opened web extension page: ${targetUrl}` }],
    };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error opening web extension page: ${e}` }],
    };
  }
};
