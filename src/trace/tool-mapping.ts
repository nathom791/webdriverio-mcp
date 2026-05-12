export interface TraceAction {
  class: string;
  method: string;
  traceMethod: string;
}

const TOOL_MAP: Record<string, TraceAction> = {
  navigate: { class: 'Page', method: 'navigate', traceMethod: 'trace:page.navigate' },
  click_element: { class: 'Element', method: 'click', traceMethod: 'trace:element.click' },
  set_value: { class: 'Element', method: 'fill', traceMethod: 'trace:element.fill' },
  scroll: { class: 'Page', method: 'scroll', traceMethod: 'trace:page.scroll' },
  tap_element: { class: 'Element', method: 'tap', traceMethod: 'trace:element.tap' },
  swipe: { class: 'Page', method: 'swipe', traceMethod: 'trace:page.swipe' },
  drag_and_drop: { class: 'Element', method: 'dragTo', traceMethod: 'trace:element.dragTo' },
  execute_script: { class: 'Page', method: 'evaluate', traceMethod: 'trace:page.evaluate' },
  start_session: { class: 'Browser', method: 'newContext', traceMethod: 'trace:browser.newContext' },
  launch_chrome: { class: 'Browser', method: 'launch', traceMethod: 'trace:browser.launch' },
};

export function mapToolToTraceAction(toolName: string): TraceAction | null {
  return TOOL_MAP[toolName] ?? null;
}

export function formatActionTitle(action: TraceAction, params: Record<string, unknown>): string {
  const { class: cls, method } = action;
  const firstParam = Object.values(params)[0];
  const paramStr = firstParam !== undefined ? `"${String(firstParam).slice(0, 80)}"` : '';
  return paramStr ? `${cls}.${method}(${paramStr})` : `${cls}.${method}()`;
}
