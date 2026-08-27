// ESLint 9 flat config.
// eslint-config-next 16 은 flat config 를 직접 export 하므로 FlatCompat 을 쓰지 않는다
// (FlatCompat 경유 시 eslint 9.39 에서 config-validator 가 순환 참조로 죽는다).
import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

const config = [
  {
    // 레거시 Vite 트리는 Gate 6 에서 삭제됐다. 남은 항목은 빌드 산출물과 생성 파일뿐이다.
    // (`src/**/*.jsx`·`src/**/*.js`·`src/assets/**`·`dist/**` 는 대상이 사라져 제거)
    ignores: ['.next/**', 'node_modules/**', 'docs/**', 'next-env.d.ts'],
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
