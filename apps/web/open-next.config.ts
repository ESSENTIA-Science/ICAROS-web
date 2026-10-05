import type { OpenNextConfig } from '@opennextjs/aws/types/open-next.js'

const config = {
  default: {
    override: {
      incrementalCache: () => import('./src/lib/content/versioned-cache.mjs').then(module => module.default),
    },
  },
} satisfies OpenNextConfig

export default config
