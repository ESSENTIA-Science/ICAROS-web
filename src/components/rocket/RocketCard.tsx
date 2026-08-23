import Image from 'next/image'
import Link from 'next/link'
import type { RocketListItem } from '@/app/(public)/rocket/_data'
import { textLang } from '@/components/landing/text-lang'
import styles from './RocketCard.module.css'

/**
 * 카드 하나가 통째로 링크다 — 로켓 이미지가 카드 면적의 대부분이라
 * 이름만 링크로 두면 실제 클릭 표적과 접근성 표적이 어긋난다.
 */
export default function RocketCard({ rocket }: { rocket: RocketListItem }) {
  return (
    <li className={styles.card}>
      <Link href={`/rocket/${rocket.slug}`} className={styles.link}>
        <span className={styles.figure}>
          {rocket.imageSrc ? (
            <Image
              src={rocket.imageSrc}
              alt=""
              fill
              sizes="(max-width: 599px) 45vw, (max-width: 991px) 30vw, 22rem"
              className={styles.img}
            />
          ) : (
            <span className={styles.noImage} aria-hidden="true" />
          )}
        </span>

        <span className={styles.body}>
          <span className={styles.name} lang={textLang(rocket.name)}>{rocket.name}</span>
          {rocket.maxAltitudeM ? (
            <span className={styles.meta}>
              <span className="eyebrow">최대 고도</span>
              <span className={`${styles.metaValue} num`}>{rocket.maxAltitudeM} m</span>
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  )
}
