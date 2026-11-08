export type ReleaseTarget = 'windows' | 'macos';

// Linux source/portable checks retain the existing Windows-compatible feed.
export const releaseTarget = (platform: NodeJS.Platform = process.platform): ReleaseTarget =>
  platform === 'darwin' ? 'macos' : 'windows';

export const releaseLayout = (target: ReleaseTarget) =>
  target === 'macos'
    ? { prefix: 'ContextCanvas-macOS', feed: 'context-canvas-update-macos.json' }
    : { prefix: 'ContextCanvas-Windows', feed: 'context-canvas-update.json' };
