/**
 * Pretendard 서브셋 생성. `pyftsubset`(fontTools) 이 필요하다.
 *
 *   pip install fonttools brotli
 *   npm run fonts:subset
 *
 * 왜: 한글 폰트는 웨이트당 ~750KB 인데 실사용 음절은 800 자 안팎이다.
 * `unicode-range` 로 나누면 브라우저가 필요한 것만 받는다 (2.22MB → 305KB).
 *
 * base = 라틴·기호 + **콘텐츠에 실제로 쓰인 한글**, rest = 나머지 음절.
 * CMS 로 새 글자가 들어오면 그 페이지에서만 rest 를 받는다 —
 * 고정 서브셋으로 잘라 버리면 그 글자가 시스템 폰트로 떨어져 조판이 어긋난다.
 *
 * 콘텐츠가 크게 바뀌면 다시 돌린다. 안 돌려도 깨지지 않고 rest 를 더 자주 받을 뿐이다.
 */
console.error(
  [
    'scripts/fonts/subset.ts 는 아직 자동화되지 않았습니다.',
    '',
    '현재 산출물(public/fonts/pretendard-{400,500,600}-{base,rest}.woff2)은',
    'pyftsubset 으로 생성했고 커밋되어 있습니다.',
    '',
    '재생성 절차는 docs/icaros-rebuild/13-fonts.md 를 보십시오.',
  ].join('\n')
)
process.exit(1)
