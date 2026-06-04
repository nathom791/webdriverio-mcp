declare module '@lambdatest/node-tunnel' {
  interface Options {
    user: string;
    key: string;
    tunnelName?: string;
    logFile?: string;
    [key: string]: string | boolean | undefined;
  }

  class LambdaTunnel {
    start(options: Partial<Options>): Promise<void>;
    stop(): Promise<void>;
    isRunning(): boolean;
  }

  export default LambdaTunnel;
}
