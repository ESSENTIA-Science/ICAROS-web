import { instagramHandle, instagramUrl } from '@/lib/content'
import Section, { type SectionTheme } from './Section'
import { revealIndex } from './reveal-style'
import styles from './Contact.module.css'

export type ContactContent = {
  body: string | undefined
  email: string | undefined
  instagram: string | undefined
}

/** 빈 섹션 규칙. 셋 다 비면 헤딩과 빈 <ul> 만 남으므로 섹션을 그리지 않는다. */
export function hasContactContent(c: ContactContent): boolean {
  return Boolean(c.body || c.email || c.instagram)
}

/** 링크 행 끝의 1px 화살표. 호버 시 진행 방향으로 밀린다 — 아이콘 폰트도 글리프도 쓰지 않는다. */
function Arrow() {
  return (
    <span className={styles.arrow} aria-hidden="true">
      <svg viewBox="0 0 16 16" className={styles.arrowSvg}>
        <path
          d="M3 13 13 3M6 3h7v7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="square"
        />
      </svg>
    </span>
  )
}

/**
 * Contact — 마지막 섹션. dark(ink) 로 두어 그대로 dark 인 Footer 로 이어진다.
 *
 * 카드 대신 제원표 행 문법을 쓴다: 12px 모노 라벨 + 디스플레이 서체 값 + 1px 괘선.
 * 항목이 둘뿐이라 상자로 감싸면 빈 곳이 더 크게 보인다 (03 §Anti-patterns 6).
 */
export default function Contact({
  id,
  label,
  index,
  theme,
  body,
  email,
  instagram,
}: ContactContent & {
  id: string
  label: string
  index: number
  theme?: SectionTheme
}) {
  if (!hasContactContent({ body, email, instagram })) return null

  return (
    <Section id={id} label={label} index={index} theme={theme} reveal="group">
      <div className={styles.layout}>
        {body ? (
          <p className={styles.body} data-reveal-item="" style={revealIndex(0)}>
            {body}
          </p>
        ) : null}

        {email || instagram ? (
          <ul className={styles.rows}>
            {email ? (
              <li data-reveal-item="" style={revealIndex(1)}>
                <a className={styles.row} href={`mailto:${email}`}>
                  <span className={styles.label} lang="en">
                    Email
                  </span>
                  <span className={styles.value}>{email}</span>
                  <Arrow />
                </a>
              </li>
            ) : null}

            {instagram ? (
              <li data-reveal-item="" style={revealIndex(2)}>
                <a
                  className={styles.row}
                  href={instagramUrl(instagram)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className={styles.label} lang="en">
                    Instagram
                  </span>
                  <span className={styles.value}>@{instagramHandle(instagram)}</span>
                  <Arrow />
                </a>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </Section>
  )
}
