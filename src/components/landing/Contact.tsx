import Section, { type SectionTheme } from './Section'
import styles from './Contact.module.css'

/** Instagram 값은 핸들만 저장돼 있다 — URL 은 여기서 조립한다. */
const instagramUrl = (handle: string) =>
  `https://www.instagram.com/${encodeURIComponent(handle.replace(/^@/, ''))}/`

export default function Contact({
  id,
  label,
  index,
  theme,
  body,
  email,
  instagram,
}: {
  id: string
  label: string
  index: number
  theme?: SectionTheme
  body: string | undefined
  email: string | undefined
  instagram: string | undefined
}) {
  return (
    <Section id={id} label={label} index={index} theme={theme}>
      <div className={styles.layout}>
        {body ? <p className={styles.body}>{body}</p> : null}

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
      </div>
    </Section>
  )
}
