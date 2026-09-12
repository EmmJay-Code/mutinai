import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/**
 * Object storage abstraction. Raw source payloads are content-addressed, so `put` is idempotent.
 * Swap FileSystemObjectStore for an S3-compatible implementation in deployed environments.
 */
export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
}

function assertSafeKey(key: string) {
  if (!key || key.startsWith('/') || key.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`unsafe object key: ${key}`);
  }
}

export class FileSystemObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root) + sep)) throw new Error(`object key escapes store root: ${key}`);
    return full;
  }

  async put(key: string, body: Uint8Array, _contentType?: string): Promise<void> {
    const path = this.path(key);
    if (await this.exists(key)) return;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.path(key));
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}

export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  async put(key: string, body: Uint8Array, contentType: string) {
    assertSafeKey(key);
    if (!this.objects.has(key)) this.objects.set(key, { body, contentType });
  }
  async get(key: string) {
    return this.objects.get(key)?.body ?? null;
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
}
