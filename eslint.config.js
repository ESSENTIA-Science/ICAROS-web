// ESLint 9 flat config.
// eslint-config-next 16 은 flat config 를 직접 export 하므로 FlatCompat 을 쓰지 않는다
// (FlatCompat 경유 시 eslint 9.39 에서 config-validator 가 순환 참조로 죽는다).
import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

const config = [
  {
    // 레거시 Vite 트리는 Gate 6 삭제 전까지 검사 대상에서 제외한다.
    ignores: [
      '.next/**',
      'dist/**',
      'node_modules/**',
      'src/**/*.jsx',
      'src/**/*.js',
      'src/assets/**',
      'docs/**',
      'next-env.d.ts',
    ],
  },
  ...(Array.isArray(coreWebVitals) ? coreWebVitals : [coreWebVitals]),
  ...(Array.isArray(typescript) ? typescript : [typescript]),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]

export default config
