import Image from 'next/image'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MemberDto } from '@/app/(public)/member/_data'
import styles from './MemberCard.module.css'

/**
 * 소개글에서 **이미지를 그리지 않는다.**
 *
 * 부원 다수가 미성년자다. 스냅샷의 소개글은 자유 텍스트이므로 이미지 마크다운을
 * 그대로 내보내면 승인되지 않은 사진이 공개 정적 HTML과 CDN에 남을 수 있다.
 * 초상 공개 정책이 정해지기 전까지 프로필은 공용 플레이스홀더만 허용한다.
 *
 * `skipHtml` 은 원시 HTML(`<img src=…>`)을 따로 막는다 — 마크다운 문법과 HTML 은 서로
 * 다른 경로라 둘 다 필요하다.
 */
const BIO_DISALLOWED: readonly string[] = ['img']

/**
 * 스냅샷의 `school` 값을 화면에 표시한다.
 * 부원 다수가 미성년자라 이름·역할·학교 외의 식별 정보는 넣지 않는다.
 *
 * 현재 공개 스냅샷은 공용 아바타만 허용한다. 사진 유무로 프레임의 **톤**만 바꾼다 —
 * 채우는 방식은 양쪽이 같고(`cover`), 기본 아바타 쪽만 대비를 낮춘다 (`MemberCard.module.css`).
 * 이니셜이나 부서 색을 채워 넣지 않는 이유: 없는 정보를 있는 것처럼 보이게 만드는 장식이고,
 * 23장이 전부 다른 색으로 빛나면 명단이 아니라 색표가 된다.
 *
 * 소개글이 있으면 카드가 격자의 **한 행을 통째로** 쓰고(`MemberCard.module.css` 의
 * `.card[data-bio]`), 사진·이름은 그대로 한 칸 폭에 남은 채 오른쪽 빈 자리에 글이 들어간다.
 * 1명뿐인 부서에서 오른쪽이 통째로 비어 보이던 것이 이 기능의 출발점이다.
 * 렌더 구성은 기체 설명(`components/rocket/Prose.tsx`)과 같다 — 서버에서
 * `react-markdown` + `remark-gfm`, `skipHtml`. 문법이 두 벌이 되면 "어드민에서는 되는데
 * 공개 페이지에서는 안 되는" 것이 생긴다. `Prose` 를 그대로 부르지 않는 이유는 크기뿐이다:
 * 그쪽은 `measure` + `--fs-body-l` 로 **본문 페이지 폭**에 고정돼 있고, 여기 글은 카드 옆
 * 좁은 칸에 선다. 스타일만 카드 크기로 낮췄고 파이프라인은 손대지 않았다.
 */
export default function MemberCard({ member }: { member: MemberDto }) {
  const bio = member.bioMd

  return (
    <li className={styles.card} data-bio={bio === null ? undefined : ''} data-reveal-item="">
      <div className={styles.main}>
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
      </div>

      {/* 값이 없으면 요소 자체를 만들지 않는다 — 빈 칸도, 자리표시자도 남기지 않는다 */}
      {bio === null ? null : (
        <div className={styles.bio}>
          <Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={BIO_DISALLOWED}>
            {bio}
          </Markdown>
        </div>
      )}
    </li>
  )
}
