import * as path from 'path';

/**
 * Map wrapper for using file paths as keys which handles paths correctly cross-platform
 */
export class PathMap<T> {
  private readonly _map = new Map<string, T>();
  get = (filePath: string) => this._map.get(normalize(filePath));
  set = (filePath: string, value: T) => {
    this._map.set(normalize(filePath), value);
    return this;
  };


  delete = (filePath: string) => this._map.delete(normalize(filePath));
}

/**
 * Filesystem case sensitivity is technically dependent on the actual filesystem, not the OS, but practically speaking this is almost always valid
 * TODO: can we even determine the actual filesystem from node?
 * TODO: does this work for cross-plat remote debugging (e.g. debugging on WSL from Windows)
 */
const normalize = (filePath: string) => (process.platform === 'win32') ? windowsNormalizedPath(filePath) : filePath;
const windowsNormalizedPath = (filePath: string) => path.normalize(filePath.toLowerCase());