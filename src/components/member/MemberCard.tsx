import Image from 'next/image'
import type { MemberDto } from '@/app/(public)/member/_data'
import styles from './MemberCard.module.css'

/**
 * 레거시는 `school` 을 DB 에 들고도 화면에 띄우지 않았다 (E2). 여기서 노출한다.
 * 부원 다수가 미성년자라 이름·역할·학교 외의 식별 정보는 넣지 않는다.
 *
 * 27명 중 23명이 같은 플레이스홀더를 쓴다 (E6). 그래서 사진 유무로 프레임의 **밀도**를 바꾼다 —
 * 사진이 있으면 프레임을 꽉 채우고, 없으면 같은 크기의 조용한 빈 면으로 남긴다.
 * 이니셜이나 부서 색을 채워 넣지 않는 이유: 없는 정보를 있는 것처럼 보이게 만드는 장식이고,
 * 23장이 전부 다른 색으로 빛나면 명단이 아니라 색표가 된다.
 */
export default function MemberCard({ member }: { member: MemberDto }) {
  return (
    <li className={styles.card} data-reveal-item="">
      <div className={styles.figure} data-empty={member.hasPhoto ? undefined : ''}>
        <Image
          src={member.imageSrc}
          /* 플레이스홀더는 그 사람에 대해 아무것도 말하지 않는다 — 이름은 바로 아래 글자로 있다.
             "○○○ 프로필 사진" 이라고 읽어 주면 사진이 있다는 거짓말이 된다. */
          alt={member.hasPhoto ? `${member.name} 프로필 사진` : ''}
          aria-hidden={member.hasPhoto ? undefined : true}
          fill
          sizes="(max-width: 599px) 44vw, (max-width: 999px) 24vw, 16rem"
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
