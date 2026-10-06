import Link from 'next/link'
import DeleteConfirm from '@/components/admin/DeleteConfirm'
import MemberForm from '@/components/admin/MemberForm'
import Notice from '@/components/admin/Notice'
import ui from '@/components/admin/ui.module.css'
import { isStorageConfigured } from '@/lib/s3/config'
import { deleteMemberAction } from '../_actions/members'
import { getMediaRef } from '../_data/media'
import {
  getMemberForAdmin,
  listMembersForAdmin,
  listSquads,
  nextMemberSortOrder,
} from '../_data/members'
import { adminHref } from '../_tabs'

const LIST_HREF = adminHref({ tab: 'members' })

export default async function MembersPanel({
  create,
  editId,
  deleteId,
  saved,
}: {
  create: boolean
  editId: string | undefined
  deleteId: string | undefined
  saved: string | undefined
}) {
  // 설정 여부만 읽는다. 버킷 이름·리전은 화면에 절대 나가지 않는다.
  const storageReady = isStorageConfigured()

  if (create) {
    const [sortOrder, squads] = await Promise.all([nextMemberSortOrder(), listSquads()])
    return (
      <>
        <div className={ui.panelHead}>
          <h2 className={ui.panelTitle}>새 부원</h2>
        </div>
        <div className={ui.card}>
          <MemberForm
            mode="create"
            cancelHref={LIST_HREF}
            squads={squads}
            storageReady={storageReady}
            values={{
              id: null,
              name: '',
              role: '',
              squad: '',
              school: '',
              sortOrder,
              published: true,
              bioMd: '',
              image: null,
              legacyImagePath: null,
            }}
          />
        </div>
      </>
    )
  }

  if (editId !== undefined) {
    const [member, squads] = await Promise.all([getMemberForAdmin(editId), listSquads()])
    if (!member) {
      return (
        <>
          <Notice tone="error">
            해당 부원을 찾을 수 없습니다. 다른 곳에서 이미 삭제되었을 수 있습니다.
          </Notice>
          <Link className={ui.btn} href={LIST_HREF}>
            목록으로
          </Link>
        </>
      )
    }

    const image = await getMediaRef(member.imageMediaId)

    return (
      <>
        <div className={ui.panelHead}>
          <h2 className={ui.panelTitle}>{member.name}</h2>
        </div>
        <div className={ui.card}>
          <MemberForm
            mode="edit"
            cancelHref={LIST_HREF}
            version={member.version}
            squads={squads}
            storageReady={storageReady}
            values={{
              id: member.id,
              name: member.name,
              role: member.role,
              squad: member.squad,
              school: member.school,
              sortOrder: member.sortOrder,
              published: member.published,
              bioMd: member.bioMd,
              image,
              legacyImagePath: member.legacyImagePath,
            }}
          />
        </div>
      </>
    )
  }

  const members = await listMembersForAdmin()
  const target = deleteId !== undefined ? members.find((m) => m.id === deleteId) : undefined

  return (
    <>
      <div className={ui.panelHead}>
        <div>
          <h2 className={ui.panelTitle} lang="en">
            Members
          </h2>
          <p className={ui.panelLede}>
            공개 명단은 정렬순서로 나열되고, 순서가 같으면 등록 순서를 따릅니다. 부서가 비어 있는
            부원은 마지막 그룹으로 모입니다.
          </p>
        </div>
        <Link className={`${ui.btn} ${ui.btnPrimary}`} href={adminHref({ tab: 'members', create: true })}>
          새 부원
        </Link>
      </div>

      {saved === 'deleted' ? <Notice tone="ok">부원을 삭제했습니다.</Notice> : null}
      {saved !== undefined && saved !== 'deleted' ? (
        <Notice tone="ok">저장했습니다. 공개 명단에 반영되었습니다.</Notice>
      ) : null}

      {target ? (
        <DeleteConfirm
          action={deleteMemberAction}
          id={target.id}
          title={target.name}
          description="등록된 프로필 사진도 함께 삭제됩니다."
          cancelHref={LIST_HREF}
        />
      ) : null}

      {deleteId !== undefined && !target ? (
        <Notice tone="error">삭제하려는 부원을 찾을 수 없습니다.</Notice>
      ) : null}

      <div className={ui.list}>
        {members.length === 0 ? (
          <p className={ui.empty}>등록된 부원이 없습니다.</p>
        ) : (
          members.map((m) => (
            <div className={ui.row} key={m.id}>
              <div className={ui.rowMain}>
                <p className={ui.rowName}>
                  {m.name}
                  {m.squad ? <span className={ui.badge}>{m.squad}</span> : null}
                  {m.published ? null : (
                    <span className={`${ui.badge} ${ui.badgeOff}`}>비공개</span>
                  )}
                </p>
                <p className={ui.rowMeta}>
                  순서 {m.sortOrder}
                  {m.role ? ` · ${m.role}` : ''}
                  {m.school ? ` · ${m.school}` : ''}
                </p>
              </div>
              <div className={ui.rowActions}>
                <Link
                  className={`${ui.btn} ${ui.btnSmall}`}
                  href={adminHref({ tab: 'members', edit: m.id })}
                >
                  편집
                </Link>
                <Link
                  className={`${ui.btn} ${ui.btnSmall}`}
                  href={adminHref({ tab: 'members', remove: m.id })}
                >
                  삭제
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
