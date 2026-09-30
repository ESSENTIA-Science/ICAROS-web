import { createHash } from 'node:crypto'

type Client = { query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>; release(): void }
type Pool = { connect(): Promise<Client> }
const keys = ['donation.round_label', 'donation.goal', 'donation.current'] as const
type Row = { id: 'current'; version: string; roundLabel: string; goal: number; amount: number; description: string }
function parse(rows: Record<string, unknown>[]): Row {
  const values = new Map(rows.map(row => [row.key, row.value]))
  if (keys.some(key => !values.has(key))) throw new Error('Donation settings unavailable')
  const roundLabel = values.get(keys[0])
  const goal = Number(values.get(keys[1]))
  const amount = Number(values.get(keys[2]))
  if (typeof roundLabel !== 'string' || !roundLabel.trim() || !Number.isSafeInteger(goal) || goal < 0 || !Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid donation settings')
  const version = createHash('sha256').update(JSON.stringify(rows.map(row => [row.key, row.value, row.updated_at]))).digest('hex')
  return { id: 'current', version, roundLabel, goal, amount, description: '' }
}
const sql = `select key, value, updated_at from icaros.site_settings where key = any($1::text[]) order by key`
export function createPostgresDonationRepository(pool: Pool) {
  return {
    async read(): Promise<Row> {
      const client = await pool.connect()
      try { return parse((await client.query(sql, [keys])).rows) } finally { client.release() }
    },
    async update(version: string, value: unknown): Promise<Row | null> {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid donation input')
      const input = value as Record<string, unknown>
      if (Object.keys(input).some(key => !['roundLabel', 'goal', 'amount', 'description'].includes(key)) ||
        typeof input.roundLabel !== 'string' || !input.roundLabel.trim() || input.roundLabel.length > 100 ||
        !Number.isSafeInteger(input.goal) || Number(input.goal) < 0 ||
        !Number.isSafeInteger(input.amount) || Number(input.amount) < 0 ||
        (input.description !== undefined && input.description !== '')) throw new TypeError('Invalid donation input')
      const client = await pool.connect()
      try {
        await client.query('begin')
        const current = parse((await client.query(`${sql} for update`, [keys])).rows)
        if (current.version !== version) { await client.query('rollback'); return null }
        for (const [key, next] of [[keys[0], input.roundLabel], [keys[1], input.goal], [keys[2], input.amount]]) {
          await client.query(`update icaros.site_settings set value = $2, updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond') where key = $1`, [key, String(next)])
        }
        const saved = parse((await client.query(sql, [keys])).rows)
        await client.query('commit')
        return saved
      } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
    },
  }
}
