/**
 * LocalStorageBackend — StorageBackend 的 localStorage 实现。
 * 键加前缀(namespace),persist across launches。
 */
export class LocalStorageBackend implements StorageBackend {
  private readonly prefix: string

  constructor(prefix: string = "tauri-rss:") {
    this.prefix = prefix
  }

  private key(k: string): string {
    return `${this.prefix}${k}`
  }

  async get(key: string): Promise<string | null> {
    return localStorage.getItem(this.key(key))
  }
  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(this.key(key), value)
  }
  async delete(key: string): Promise<void> {
    localStorage.removeItem(this.key(key))
  }
  async keys(prefix = ""): Promise<string[]> {
    const match = this.key(prefix)
    const out: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k !== null && k.startsWith(match)) out.push(k.slice(this.prefix.length))
    }
    return out
  }
}
