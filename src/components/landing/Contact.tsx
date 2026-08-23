import Section, { type SectionTheme } from './Section'
import styles from './Contact.module.css'

/** Instagram 값은 핸들만 저장돼 있다 — URL 은 여기서 조립한다. */
const instagramUrl = (handle: string) =>
  `https://www.instagram.com/${encodeURIComponent(handle.replace(/^@/, ''))}/`

export type ContactContent = {
  body: string | undefined
  email: string | undefined
  instagram: string | undefined
}

/** 빈 섹션 규칙. 셋 다 비면 헤딩과 빈 <ul> 만 남으므로 섹션을 그리지 않는다. */
export function hasContactContent(c: ContactContent): boolean {
  return Boolean(c.body || c.email || c.instagram)
}

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
    <Section id={id} label={label} index={index} theme={theme}>
      <div className={styles.layout}>
        {body ? <p className={styles.body}>{body}</p> : null}

        {email || instagram ? (
          <ul className={styles.grid}>
            {email ? (
              <li>
                <a className={styles.card} href={`mailto:${email}`}>
                  <span className={styles.label} lang="en">
                    Email
                  </span>
                  <span className={styles.value}>{email}</span>
                </a>
              </li>
            ) : null}

            {instagram ? (
              <li>
                <a
                  className={styles.card}
                  href={instagramUrl(instagram)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className={styles.label} lang="en">
                    Instagram
                  </span>
                  <span className={styles.value}>@{instagram.replace(/^@/, '')}</span>
                </a>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </Section>
  )
}
