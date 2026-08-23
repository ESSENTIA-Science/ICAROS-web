import Image from 'next/image'
import Link from 'next/link'
import type { RocketListItem } from '@/app/(public)/rocket/_data'
import { textLang } from '@/components/landing/text-lang'
import styles from './RocketCard.module.css'

type CardSpec = { label: string; value: string | null; unit: string }

/**
 * 데이터 시트형 카드 — 세로 1:2 렌더 옆에 큰 기체명 + 작은 모노 제원.
 *
 * 왜 가로 분할인가: 원본 이미지가 512×1024(1:2)다. 세로 카드로 쌓으면 프레임을 원본 비율로 두는 순간
 * 카드 하나가 700px 을 넘고, 비율을 줄여 contain 하면 양옆이 통째로 빈다. 이미지를 자기 비율 그대로
 * 좁은 열에 두고 남는 폭을 조판에 쓰는 편이 둘 다 해결한다.
 *
 * 링크는 기체명에만 건다. 카드 전체가 클릭 표적인 것은 `.link::after` 오버레이가 맡는다 —
 * `<a>` 로 카드를 통째로 감싸면 링크 이름이 "ICX-IA 최대 고도 150 m 길이 0.6 m …" 처럼 문장이 되어
 * 스크린리더의 링크 목록 탐색이 망가진다. 대가로 카드 안 텍스트 드래그 선택이 막힌다.
 */
export default function RocketCard({ rocket }: { rocket: RocketListItem }) {
  const specs: CardSpec[] = [
    { label: '최대 고도', value: rocket.maxAltitudeM, unit: 'm' },
    { label: '길이', value: rocket.sizeM, unit: 'm' },
    { label: '페이로드', value: rocket.payloadKg, unit: 'kg' },
  ]

  return (
    <li className={styles.card} data-reveal-item="">
      <div className={styles.figure}>
        {rocket.imageSrc ? (
          <Image
            src={rocket.imageSrc}
            alt=""
            fill
            sizes="(max-width: 599px) 32vw, (max-width: 899px) 26vw, 22rem"
            className={styles.img}
          />
        ) : (
          <span className={styles.noImage} aria-hidden="true" />
        )}
      </div>

      <div className={styles.body}>
        {/* 목록의 h1 은 "Rockets" 다. 기체명은 그 아래 단계라 h2 로 둔다 */}
        <h2 className={styles.name} lang={textLang(rocket.name)}>
          <Link href={`/rocket/${rocket.slug}`} className={styles.link}>
            {rocket.name}
          </Link>
        </h2>

        {/* 호버·포커스 때 좌→우로 차는 1px 마크. 시그널 컬러의 허용 용법(진행률 채움) */}
        <span className={styles.rule} aria-hidden="true" />

        <dl className={styles.specs}>
          {specs.map((s) => (
            <div key={s.label} className={styles.specRow}>
              <dt className="eyebrow">{s.label}</dt>
              <dd className={styles.specValue}>
                {s.value == null ? (
                  <>
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">값 없음</span>
                  </>
                ) : (
                  <>
                    <span className={`${styles.specNum} num`}>{s.value}</span>
                    <span className={styles.specUnit}>{s.unit}</span>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </li>
  )
}
