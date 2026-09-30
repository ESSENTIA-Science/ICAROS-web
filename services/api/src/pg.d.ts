declare module 'pg' {
  export class Pool {
    constructor(config: Record<string, unknown>)
    query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
    connect(): Promise<{ query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>; release(): void }>
  }
}
