import sharp from 'sharp';
import type { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getBrowser, getState } from '../session/state.js';
import { createTraceSession, getMonotonicMs, getTraceSession } from './state.js';
import { formatActionTitle, mapToolToTraceAction } from './tool-mapping.js';
import type { TraceSession } from './types.js';

export function startTrace(sessionId: string, capabilities: Record<string, unknown>): void {
  const browserName = String(capabilities.browserName ?? 'chromium');
  const viewport = { width: 1280, height: 720 };
  const title = String(capabilities['browserName'] ?? browserName);
  createTraceSession(sessionId, browserName, viewport, title);
}

export function endTrace(_sessionId: string): void {
  // TraceSession stays in state until exported
}

// Records the initial page load that happens inside start_session (navigationUrl).
// The navigation is done directly via wdioBrowser.url(), bypassing withTrace, so we
// record it here as a synthetic trace event after the fact.
export async function recordInitialNavigation(sessionId: string, url: string): Promise<void> {
  const traceSession = getTraceSession(sessionId);
  if (!traceSession) return;

  const callId = `call@${++traceSession.callCounter}`;
  const startTime = getMonotonicMs(traceSession);

  traceSession.events.push({
    type: 'before',
    callId,
    startTime,
    class: 'Page',
    method: 'trace:page.navigate',
    pageId: traceSession.pageId,
    params: { url },
    title: `Page.navigate("${url.slice(0, 80)}")`,
  });

  await captureScreenshot(traceSession);

  traceSession.events.push({
    type: 'after',
    callId,
    endTime: getMonotonicMs(traceSession),
  });
}

export function withTrace(toolName: string, callback: ToolCallback): ToolCallback {
  return async (params, extra) => {
    const state = getState();
    const sessionId = state.currentSession;

    if (!sessionId) return callback(params, extra);

    const metadata = state.sessionMetadata.get(sessionId);
    if (!metadata?.trace || metadata.type !== 'browser') return callback(params, extra);

    const traceSession = getTraceSession(sessionId);
    if (!traceSession) return callback(params, extra);

    const action = mapToolToTraceAction(toolName);
    if (!action) return callback(params, extra);

    const callId = `call@${++traceSession.callCounter}`;
    const startTime = getMonotonicMs(traceSession);

    traceSession.events.push({
      type: 'before',
      callId,
      startTime,
      class: action.class,
      method: action.traceMethod,
      pageId: traceSession.pageId,
      params: params as Record<string, unknown>,
      title: formatActionTitle(action, params as Record<string, unknown>),
    });

    let result: Awaited<ReturnType<ToolCallback>>;
    let actionError: string | undefined;

    try {
      result = await callback(params, extra);
      if ((result as { isError?: boolean }).isError) {
        const text = result.content?.find((c) => c.type === 'text')?.text;
        actionError = text ? String(text) : 'unknown error';
      }
    } catch (e) {
      actionError = String(e);
      traceSession.events.push({
        type: 'after',
        callId,
        endTime: getMonotonicMs(traceSession),
        error: { message: actionError },
      });
      throw e;
    }

    await captureScreenshot(traceSession);

    traceSession.events.push({
      type: 'after',
      callId,
      endTime: getMonotonicMs(traceSession),
      ...(actionError ? { error: { message: actionError } } : {}),
    });

    return result;
  };
}

async function captureScreenshot(traceSession: TraceSession): Promise<void> {
  try {
    const browser = getBrowser();
    const base64 = await browser.takeScreenshot();
    const inputBuffer = Buffer.from(base64, 'base64');
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();
    const width = metadata.width ?? 1280;
    const height = metadata.height ?? 720;
    const jpegBuffer = await image.jpeg({ quality: 60 }).toBuffer();
    const wallTimestamp = traceSession.startWallTime + getMonotonicMs(traceSession);
    const resourceName = `${traceSession.pageId}-${wallTimestamp}.jpeg`;

    traceSession.screenshots.push({ resourceName, data: jpegBuffer, width, height });
    traceSession.events.push({
      type: 'screencast-frame',
      pageId: traceSession.pageId,
      sha1: resourceName,
      width,
      height,
      timestamp: getMonotonicMs(traceSession),
    });
  } catch {
    // Screenshot failures must not mask the action result
  }
}
