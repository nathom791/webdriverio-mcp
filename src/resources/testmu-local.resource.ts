import type { ResourceDefinition } from '../types/resource';

function getLocalBinaryInfo(): {
  downloadUrl: string;
  platform: string;
  arch: string;
  binaryName: string;
} {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return {
      downloadUrl: 'https://downloads.lambdatest.com/tunnel/v4/darwin/64bit/LT_Darwin.zip',
      platform: 'macOS',
      arch: arch === 'arm64' ? 'Apple Silicon (via Rosetta 2)' : 'Intel x64',
      binaryName: 'LT',
    };
  }

  if (platform === 'win32') {
    return {
      downloadUrl: 'https://downloads.lambdatest.com/tunnel/v4/win/64bit/LT_Windows.zip',
      platform: 'Windows',
      arch: 'x86/x64',
      binaryName: 'LT.exe',
    };
  }

  // Linux
  return {
    downloadUrl: 'https://downloads.lambdatest.com/tunnel/v4/linux/64bit/LT_Linux.zip',
    platform: 'Linux',
    arch: arch === 'arm64' ? 'ARM64' : 'x64',
    binaryName: 'LT',
  };
}

export const testmuLocalBinaryResource: ResourceDefinition = {
  name: 'testmu-local-binary',
  uri: 'wdio://testmu/local-binary',
  description: 'TestMu Tunnel binary download URL and daemon setup instructions for the current platform. MUST be read and followed before using tunnel: true in start_session with provider: testmu.',
  handler: async () => {
    const info = getLocalBinaryInfo();
    const username = process.env.TESTMU_USERNAME ?? '<TESTMU_USERNAME>';
    const accessKey = process.env.TESTMU_ACCESS_KEY ?? '<TESTMU_ACCESS_KEY>';

    const content = {
      requirement: 'MUST start the TestMu Tunnel daemon BEFORE calling start_session with tunnel: true. Without it, all navigation to local/internal URLs will fail.',
      platform: info.platform,
      arch: info.arch,
      downloadUrl: info.downloadUrl,
      setup: [
        `1. Download: curl -O ${info.downloadUrl}`,
        `2. Unzip: unzip ${info.downloadUrl.split('/').pop()}`,
        `3. Make executable (macOS/Linux): chmod +x ${info.binaryName}`,
        `4. Start daemon: ./${info.binaryName} --user ${username} --key ${accessKey}`,
      ],
      commands: {
        start: `./${info.binaryName} --user ${username} --key ${accessKey}`,
        stop: `./${info.binaryName} --user ${username} --key ${accessKey} --stop`,
        status: `./${info.binaryName} --status`,
      },
      afterDaemonIsRunning: 'Call start_session with tunnel: true and provider: testmu to route TestMu traffic through the tunnel.',
    };

    return {
      contents: [{
        uri: 'wdio://testmu/local-binary',
        mimeType: 'application/json',
        text: JSON.stringify(content, null, 2),
      }],
    };
  },
};
