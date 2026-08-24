# 13 — 폰트

## 현황

| 서체 | 역할 | 방식 |
|---|---|---|
| **Pretendard** | 본문 | 손으로 쓴 `@font-face` (`src/app/fonts.css`), `unicode-range` 2단 |
| **Archivo** | 디스플레이 | `next/font/google`, `axes: ['wdth']`, 125% = Expanded (D18) |
| **IBM Plex Mono** | 기술 레지스터 | `next/font/google`, 단일 웨이트 |

`WidescreenUEx_Trial_*` 9파일은 삭제됐다 (D18 — 파일명이 Trial 이고 웹 라이선스 미확인).

## Pretendard 를 `next/font/local` 로 안 쓰는 이유

**`unicode-range` 를 노출하지 않는다.**

한글 폰트는 웨이트당 ~750KB 인데 이 사이트가 실제로 쓰는 음절은 **775 자**다.
범위를 못 나누면 안 쓰는 글자 10,397 개를 매번 같이 받는다.

| | 원본 | base | rest |
|---|---:|---:|---:|
| Regular 400 | 747 KB | **101 KB** | 545 KB |
| Medium 500 | 760 KB | **102 KB** | 556 KB |
| SemiBold 600 | 767 KB | **102 KB** | 563 KB |
| **합계** | **2.22 MB** | **305 KB** | 1.63 MB |

- **base** — 라틴·기호 + 콘텐츠에 실제로 쓰인 한글 775 자
- **rest** — 나머지 한글 음절 10,397 자 (633 구간)

CMS 로 새 글자가 들어오면 브라우저가 **그 페이지에서만** rest 를 받는다.
고정 서브셋으로 잘라 버리면 그 글자가 시스템 폰트로 떨어져 조판이 어긋난다 —
콘텐츠가 편집 가능한 사이트에서 그건 언젠가 반드시 일어난다.

## 재생성

콘텐츠가 크게 바뀌었을 때만 하면 된다. **안 해도 깨지지 않는다** — rest 를 더 자주 받을 뿐이다.

```bash
pip install fonttools brotli
```

1. 실사용 글자 수집 — `icaros.site_settings` 전체 값 + `rockets`/`members`/`rocket_engines` 의
   텍스트 컬럼 + `src/**/*.tsx|ts` 의 한국어 리터럴
2. `base` 범위 = 라틴·기호 블록 + 수집한 한글 코드포인트
3. `rest` 범위 = `U+AC00-D7A3` − base 한글 (연속 구간으로 압축)
4. 웨이트별로 두 번:
   ```bash
   pyftsubset src/assets/fonts/woff2/Pretendard-Regular.woff2 \
     --output-file=public/fonts/pretendard-400-base.woff2 --flavor=woff2 \
     --unicodes-file=base.txt --layout-features='*' --no-hinting
   ```
5. `src/app/fonts.css` 의 `unicode-range` 를 갱신

## 알려진 것

- **preload 가 실제로 안 나간다.** Turbopack 이 `<link rel="preload" as="font">` 를 내보내지 않는다
  (실측: `as="font"` 태그 0 개). `next/font` 의 `preload: true` 는 현재 no-op 이다.
  `font-display: swap` 이라 렌더를 막지는 않는다.
- 원본 `src/assets/fonts/woff2/*` 3개는 재생성 소스로 남겨 둔다. 런타임에는 안 쓰인다.
