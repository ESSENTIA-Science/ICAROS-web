import Image from 'next/image'
import type { MemberDto } from '@/app/(public)/member/_data'
import styles from './MemberCard.module.css'

/**
 * 레거시는 `school` 을 DB 에 들고도 화면에 띄우지 않았다 (E2). 여기서 노출한다.
 * 부원 다수가 미성년자라 이름·역할·학교 외의 식별 정보는 넣지 않는다.
 */
export default function MemberCard({ member }: { member: MemberDto }) {
  return (
    <li className={styles.card}>
      <div className={styles.figure}>
        <Image
          src={member.imageSrc}
          alt={`${member.name} 프로필 사진`}
          fill
          sizes="(max-width: 599px) 44vw, (max-width: 991px) 30vw, 18rem"
          className={styles.img}
        />
      </div>
      <div className={styles.body}>
        <p className={styles.name}>{member.name}</p>
        {member.role ? <p className={styles.role}>{member.role}</p> : null}
        {member.school ? <p className={styles.school}>{member.school}</p> : null}
      </div>
    </li>
  )
}
