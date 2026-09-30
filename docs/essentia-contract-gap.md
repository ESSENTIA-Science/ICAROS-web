# ESSENTIA community contract checked on 2026-09-30

The path supplied for ESSENTIA is a legacy monorepo. Its `AGENTS.md` identifies `../Essentia/split/be` as the canonical backend, so the findings below came from that repository. An isolated worktree now holds a proposed implementation at `../Essentia/split/be-icaros-service` on `feat/icaros-service-posts`; the canonical backend and production were not changed.

## Proposed upstream contract status

The isolated branch adds service-token draft create/update, optimistic versions, idempotent publish, a CMS draft list/detail with stored `updatedAt`, and a published snapshot endpoint that does not increment views. Its backend tests pass offline. The API contract is in that worktree's `docs/integrations/icaros-service-posts.md`. ICAROS has a server-side HTTP adapter in `services/api/src/essentia/posts.ts`, but the production API runtime has not been wired to it.

The upstream snapshot endpoint exports only already published posts. The ICAROS build must include a draft post before it can safely release that draft, so a staged snapshot overlay and an explicit publish step after successful build still need an integration contract. The upstream API has no delete endpoint or attachment metadata contract yet. Do not treat the proposed branch as deployed.

## Existing public read API

- `GET /api/forum/posts?category=&page=&size=` returns `{ok:true,data:{pinned,posts:{items,page,size,total,totalPages}}}`. Page size is capped at 50. The category is a name, while the post summary also includes `projectId` and `projectSlug`.
- `GET /api/forum/posts/{id}` returns `{ok:true,data:{post,comments,commentCount,canComment,signedIn}}`. `post` includes `title`, `content`, `authorName`, `createdAt`, and `updatedAt`. This endpoint increments the view count, making it unsuitable for a publish builder that fetches every post repeatedly.
- `GET /api/forum/posts/{id}/comments` returns a separate public comment list. The ICAROS public site can consume this as a read-only API once the CloudFront routing and cache policy are defined.

## Missing CMS write and publish contract

The canonical `ForumController` currently has `POST /api/forum/posts`, `PATCH /api/forum/posts/{id}`, and `DELETE /api/forum/posts/{id}`. They are user-session endpoints. `ForumService` requires a signed-in viewer, only the author can edit, and the request DTOs have no idempotency key or record version. `ForumPost` has `deleted` but no staged draft or publication version. The canonical backend contains no service-token filter or ICAROS-scoped CMS endpoint.

Consequently, the ICAROS API's `EssentiaPostsAdapter` cannot be wired safely to the current write endpoints. ESSENTIA needs a scoped CMS identity and create/update/delete contract with idempotency, stable IDs and versions, and a draft/revision mechanism if a CMS save must wait for the ICAROS static build before appearing publicly. A read-only export endpoint that does not increment views would also make snapshot builds safer. This is an upstream interface requirement, not an ICAROS DB migration.

Sources: `../Essentia/split/be/src/main/java/org/essentia/api/domain/forum/controller/ForumController.java`, `dto/ForumDtos.java`, `service/ForumService.java`, `entity/ForumPost.java`, and `common/PageResponse.java`.
