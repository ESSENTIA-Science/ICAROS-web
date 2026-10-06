# Legacy posts import implementation plan

**Goal:** 기존 19개 글을 CMS에서 관리하고 공개 18개를 ESSENTIA ICAROS 게시판에 표시한다.
**Architecture:** ESSENTIA 서비스 API를 통해 안정적인 레거시 ID 기반 idempotency key로 이관한다. 원래 비공개 글은 초안으로 남긴다. 원본과 결과 매핑은 추적하지 않는 로컬 파일에 보관한다.
**Tech Stack:** Node.js, PostgreSQL, ESSENTIA HTTP API, ICAROS TypeScript adapter.
**Spec:** 사용자 게시글 전체 이관 요청, docs/essentia-contract-gap.md.

## Constraints and checks
- 운영 식별자·토큰·본문은 출력하거나 커밋하지 않는다.
- 기존 원본 삭제 금지. 모든 글 본문·날짜·이미지 검증 후 로컬 레거시 공개 여부만 내린다.
- 반복 실행에서 같은 원본으로 글이 늘어나지 않아야 한다.
- 이미지 실제 HTTP 200 및 image MIME을 확인하고 외부 커뮤니티에 공개 가능한 절대 URL로 기록한다.
- CMS/API와 정적 snapshot은 동일 미디어를 기존 상대 경로로 편집·빌드할 수 있어야 한다.

## Tasks
- [x] 이미지 절대 URL ↔ 내부 media URL 변환에 대한 adapter 회귀 테스트 작성·실패 확인·수정.
- [x] source와 mapping을 0600으로 보관하고 모든 이미지 가용성 확인.
- [x] 서비스 API로 19개 생성, 공개 원본 18개만 publish, CMS 목록·snapshot·공개 게시판 대조.
- [x] 매핑 결과 확인 후 로컬 원본 18개를 비공개 보관하여 이중 노출 방지.
- [x] 날짜순 CMS·공개웹 snapshot 검증 및 문서 업데이트.
