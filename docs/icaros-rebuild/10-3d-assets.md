# 10 — 3D Assets: `icx-2.fbx` 실측 · 변환 판정

> ## ✅ 실행 완료 (2026-08-24) — 아래 "독립 검토 정정" 중 **1·3·4·5 가 갱신됐다**
>
> D19 로 도구 설치가 승인돼 **변환을 실제로 수행했다.** 산출물과 런타임이 모두 레포에 있다.
> 상세는 §11~§15. 여기서는 이전 판정이 뒤집힌 것만 먼저 적는다.
>
> | 이전 판정 | 실행 결과 |
> |---|---|
> | "변환 도구가 하나도 없다. Blender 설치가 필요하다" | **필요 없었다.** `three` 가 `examples/jsm/loaders/FBXLoader.js` 로 완전한 FBX 리더를 배포한다. 런타임용으로 어차피 설치하는 패키지라 **FBX→glTF 에 추가 도구가 0개**다 (§11) |
> | 🔴 "§3(크기)과 §2.2(draw call)는 **동시에 성립하지 않는다.** `join` 이 인스턴싱을 파괴해 양자화 BIN 이 8.95 → **27.34 MiB**" | **틀렸다. 둘 다 성립한다.** 그 27.34 MiB 는 *양자화만 한 BIN* 이고, 같은 문서 §3.2 가 "meshopt 는 선택이 아니라 필수"라고 이미 결론지었다. **meshopt 를 걸면 flatten+join 한 GLB 가 3.77 MiB** 다(실측). 부품 필터를 먼저 걸면 **1.94 MiB · draw call 31** (§12) |
> | 🔴 "T5: X·Y 0.73~0.77 m 의 정체 불명 — 발사대가 섞였을 수 있다" | **해소.** 회전을 반영한 실제 AABB 는 **0.464 × 1.660 × 0.464 m**. 넓은 X·Y 는 발사대가 아니라 **기체의 착륙 레그 4개**다. 소프트웨어 렌더로 육안 확인했다 (§13) |
> | "모바일 fallback 은 스키마 기본값만으로 충족되지 않는다" | 맞다. **런타임 사다리를 구현했다** — `src/components/three/HeroStage.tsx` (§14) |
> | "G2(포스터)는 GLB 변환에 종속된 미충족 항목" | **충족.** 3D 와 **같은 카메라 파라미터**로 구운 900×1600 투명 PNG(38 KB). `icx2.webp` 임시 포스터는 쓰지 않는다 (§13) |
>
> 여전히 미해결: **G11(부품 강조)** — `join` 이 부품 노드를 없애므로 §6 의 선택지 "가"(CAD 개명)가
> 유일한 경로라는 판단은 그대로다. D19 로 홈 히어로만 쓰기로 했으므로 지금은 필요하지 않다.
> 그리고 **실제 GPU 렌더는 이 머신에서 확인하지 못했다** — 무엇을 검증했고 무엇을 못 했는지는 §15.

> ## ⚠️ 독립 검토 정정 (2026-08-23)
>
> **1. 이 문서는 P7-26 의 전반부만 다룬다.** 09-implementation-plan.md P7-26 은
> "FBX → GLB + Draco/meshopt **변환**" 과 "웹 적합성 **평가**" 둘인데, 여기 있는 것은 평가뿐이다.
> **GLB 산출물은 없다** — 변환 도구(`blender`/`FBX2glTF`/`assimp`/`gltfpack`/`@gltf-transform`)가
> 이 머신에 하나도 없고 설치는 승인 사항이다. 상태: **평가 완료 · 변환 미착수.**
>
> **2. draw call 수치를 866 으로 정정했다.** 원래 717 로 적혀 있었는데 그건 **Mesh 노드 수**이지
> draw call 이 아니다. glTF 의 draw call 은 Σ(primitive × 인스턴스) 이고, 멀티머티리얼 메시
> (ByPolygon 61개)를 세면 **866** 이다(17% 과소 계상이었다). 목표 `draw call ≤ 100` 도 이 기준선 위에서 다시 봐야 한다.
>
> **3. §3(크기 판정)과 §2.2(draw call 처방)는 동시에 성립하지 않는다.**
> `gltf-transform join` 은 내부적으로 `flatten` 을 돌려 노드 변환을 지오메트리에 굽고, 그 과정에서
> **인스턴싱이 사라진다**(363 지오메트리가 866벌로 복제). 실측 데이터로 계산한 결과:
>
> | | 현재 | `join`/`flatten` 후 |
> |---|---:|---:|
> | welded 정점 | 461,201 | **919,235** |
> | 삼각형 | 565,316 | **1,163,444** |
> | 양자화 BIN | 8.95 MiB | **27.34 MiB (2.76×)** |
>
> 즉 "8 MB 예산은 문제가 아니다" 는 **draw call 처방을 실행하지 않는 조건에서만** 참이다.
> 둘 중 하나를 골라야 하고, 그 선택이 이 자산의 웹 적합성 판정을 가른다.
> (`gltf-transform` 미설치라 flatten 동작 자체는 미검증 — 산술은 inspect 스크립트의 자체 데이터다.)
>
> **4. 대상 로켓이 DB 에 없다.** `icx-2.fbx` 는 레거시 id `icx2`(ICX-II)의 기체인데
> `icaros.rockets` 에는 `icx1`·`icx1s`·`icxmv1`·`icxmv1lr` 4행뿐이다. `icx2` 는 라이브에서 삭제됐다
> (00-legacy-schema-snapshot.md §5). `rocket_models.rocket_id` 가 가리킬 대상이 없으므로,
> 이 모델을 쓰려면 먼저 **로켓 행을 되살릴지** 결정해야 한다.
>
> **5. 모바일 fallback(G12·C12)은 스키마 기본값만으로 충족되지 않는다.**
> `rocket_models.enabled_mobile` 기본값 false 는 전제조건이지 검증 통과가 아니다.
> 두 요구사항의 검증 기준은 "뷰포트별"·"모바일 실기" 즉 런타임 수용 기준이다.


> 근거: `scripts/model/inspect-fbx.ts` 로 **파일 바이트를 직접 읽어 측정**했다 (2026-08-23, 실행 2.1s).
> 도구 부재로 **실제 변환은 하지 않았다** — Blender·FBX2glTF·assimp·gltf-transform 전부 이 머신에 없고 설치는 승인 대상.
> `public/assets/icx-2.fbx` 는 읽기만 했다. 수정·삭제 없음.
> 상태: **실측 완료 · 변환 대기(도구 승인 필요) · 판정 확정**

---

## 0. 결론 3줄

| | 판정 |
|---|---|
| **8 MB 예산** | 🟢 **문제가 아니다.** 양자화 + 압축 실측으로 **2.0~4.0 MiB**. 다만 *양자화만* 해서는 10.27 MiB 로 **예산을 넘는다** — 파일 내 압축(meshopt)은 선택이 아니라 필수 |
| **진짜 병목** | 🔴 **바이트가 아니라 부품 수다.** 렌더 삼각형 **1,163,444** · draw call **866** · primitive **444**. 그중 **56%가 20 mm 미만 부품** (0403 SMD 커패시터, DIP 소켓 핀, M3 너트) |
| **웹에 올릴 가치** | 🟡 **있다. 단 "변환"이 아니라 "다시 만들기"다.** 이건 렌더링용 모델이 아니라 **Fusion 360 제조 조립체**다. 그대로 올리면 회색 CAD 뷰어가 되고, 요구사항 G11(부품 강조)은 **노드 이름이 `Body1` ×381 이라 성립하지 않는다** |

---

## 1. 실측

### 1.1 방법과 그 한계

`@gltf-transform/cli` 가 없고 `npm install` 이 금지라, FBX 바이너리 노드 레코드를 직접 파싱했다.
FBX 는 공개된 포맷이고 배열 페이로드는 zlib deflate 라 Node 기본 모듈만으로 전부 읽힌다.

- 파일 끝까지 노드 트리가 정합했다. **읽지 못한 구간은 0** (경고 0건).
- 배열 2,178개 전부 디코드했다 (deflate 1,510 · 무압축 668). 알 수 없는 encoding 없음.
- **읽지 못한 것**: `Definitions` 의 템플릿 기본값은 파싱하지 않았다(각 객체가 자기 값을 갖고 있어 결과에 영향 없음). Model 의 회전 행렬은 읽었지만 **AABB 계산에서 회전을 무시했다** — 그래서 §1.6 의 치수는 하한이다.

### 1.2 파일 개요

| 항목 | 값 |
|---|---|
| 크기 | **16,920,592 bytes = 16.14 MiB** |
| 포맷 | Kaydara FBX Binary **v7200** (32-bit offset) |
| Creator | `FBX SDK/FBX Plugins version 2020.3.8` |
| 단위 | `UnitScaleFactor = 0.1` → **1 unit = 1 mm** · UpAxis = Y |
| 최상위 섹션 | `Objects` 15.96 MiB (98.9%) · `Connections` 0.17 MiB (1.0%) · 나머지 전부 합쳐 0.01 MiB |

### 1.3 16 MiB 는 어디에 쓰였나

| 구성 | bytes | MiB | 비중 |
|---|---:|---:|---:|
| **지오메트리 배열** | 15,314,920 | 14.61 | **90.5%** |
| 임베드 텍스처 | **0** | 0 | 0% |
| 애니메이션 커브 | **0** | 0 | 0% |
| 구조·문자열·노드 헤더 | 1,605,672 | 1.53 | 9.5% |

→ **텍스처 최적화로 얻을 것이 0이다.** 이 파일은 100% 지오메트리다.
압축 해제 시 배열 총량은 **65.93 MiB** (파일 내 14.61 MiB → deflate 4.5x).

### 1.4 지오메트리

| 항목 | 값 |
|---|---:|
| Geometry 노드 | 363개 (payload 해시 기준 **유일 254개 / 중복본 109개 ≈ 3.08 MiB**) |
| Model 노드 | 1,754개 = `Null` 1,037 + `Mesh` 866 |
| **Geometry→Model 연결** | **866** = 씬에 배치된 메시 인스턴스 |
| FBX 정점 | 282,041 |
| 폴리곤 / 삼각형 | 565,316 / 565,316 (**전부 삼각형**, 최대 ngon = 3) |
| polygon-vertex(corner) | 1,695,948 |
| **welded 정점** (pos·normal·UV 유일 조합) | **461,201** |
| welded 정점 (UV 제외) | 434,727 |
| **glTF primitive** | **444** (머티리얼 `AllSame` 302 메시 + `ByPolygon` 61 메시) |
| 법선 매핑 | `ByPolygonVertex/Direct` 358 · `ByVertice/Direct` 5 |
| UV | 363/363 메시 보유 — **그런데 텍스처가 0개다** |

`welded 461,201` 은 추정이 아니라 **(위치·법선·UV) 조합을 실제로 웰딩해서 센 값**이다 (허용 오차 1e-6).
glTF 로 구울 때의 정점 수가 정확히 이 값이고, GLB 크기는 FBX 정점 수(282,041)가 아니라 이 값으로 결정된다.

### 1.5 🔴 부품 크기별 삼각형 배분 — 이 문서에서 가장 중요한 표

인스턴스를 반영한 **실제 렌더 삼각형은 1,163,444개**다 (565,316 × 인스턴스).

| 부품 크기(대각선) | 부품 수 | 렌더 삼각형 | 비중 |
|---|---:|---:|---:|
| **< 5 mm** (SMD 수동소자·소켓 핀) | 416 | 346,720 | **29.8%** |
| **5–20 mm** (나사·너트·커넥터) | 167 | 305,224 | **26.2%** |
| 20–100 mm | 102 | 448,244 | 38.5% |
| **≥ 100 mm** (실제로 보이는 구조물) | **32** | **63,256** | **5.4%** |

**삼각형 예산의 56%가 20 mm 미만 부품에 쓰인다.**
1.75 m 기체를 600 px 높이로 그리면 **1 mm ≈ 0.34 px** 다. 즉 5 mm 부품은 화면에서 **1.7 px**,
20 mm 부품도 **6.9 px** 다. 346,720개의 삼각형이 1.7 px 안에서 서로를 가린다.

노드 이름이 이를 확증한다:

| 노드 이름 | 개수 | 정체 |
|---|---:|---|
| `Body1` / `Body2` / `Body3`… | 729 (41.6%) | Fusion 360 자동 생성 이름 |
| `dip socket pin` | 56 | DIP 소켓 핀 하나하나 |
| `M3x2.4mm Hex Nut v1` | 28 | M3 육각너트 |
| `Screw_ISO_10642_M3x25_A2 v1` | 20 | ISO 10642 접시머리 나사 |
| `CAP 0403 v1` · `CAP Ceramic 0403 v1` · `603 cap on pad` | 각 16 | **SMD 커패시터** (0403/0603 풋프린트 — 부품 대각선 실측 < 5 mm 버킷) |
| `Res 0403 v1` · `Inductor SMD 0403 v1` | 각 8~10 | SMD 저항·인덕터 |

Model 1,754개 중 **고유 이름 502개**. `Prikljiček` · `OSovina` · `Ohisje`(슬로베니아어)처럼
외부에서 받아온 부품도 섞여 있다.

### 1.6 머티리얼 · 텍스처 · 애니메이션

| 항목 | 값 |
|---|---|
| Material | 75개 (유일 71개) — `Opaque(160,160,160)` · `Powder Coat - Rough (Grey)` · `PA 12 - Nylon - PA 603-CF (with EOS P 3D Printers)` 등 **Fusion 360 appearance 라이브러리 이름** |
| **Texture 노드** | **0개** |
| **임베드 이미지(`Video`)** | **0개** |
| AnimationStack / Layer / Curve | **0 / 0 / 0** |
| Skin deformer · Pose | **0 / 0** |

→ 색만 있는 머티리얼이다. **KTX2·Basis 논의는 성립하지 않는다** (§4).
→ `Acrylic (Clear)` · `Polycarbonate (Clear)` 같은 투명 머티리얼이 섞여 있어, glTF 로 옮기면
`alphaMode: BLEND` 가 되고 **정렬 비용이 붙는다.** 불투명으로 강제할지 결정이 필요하다.

### 1.7 치수 · 축

Model 계층의 이동·스케일을 합성한 월드 AABB (**회전 288개는 무시 → 하한**):

```
0.770 m (X) × 0.734 m (Y) × 1.752 m (Z)
```

`Lcl Scaling` 은 두 값뿐이다: Null 노드 1,037개가 `1.0`, Mesh 노드 866개가 **`10.0`**.
즉 지오메트리 로컬 좌표에 10을 곱해야 월드가 된다. 1 unit = 1 mm 이므로 **전장 ≈ 1.75 m**.

⚠ X·Y 가 0.73~0.77 m 인 것은 로켓 동체치고 넓다. 회전된 부품(288개)이나 발사대·지상 지원 장비가
조립체에 포함돼 있을 가능성이 있다. **GLB 변환 후 육안 확인 필요** (G14 framing 과 직결).

---

## 2. 변환 경로 — 지금 가능한가

**아니다.** `which` 실측:

| 도구 | 결과 |
|---|---|
| `blender` · `/Applications/*Blender*` | ❌ 없음 |
| `FBX2glTF` / `fbx2gltf` | ❌ 없음 |
| `assimp` | ❌ 없음 |
| `gltfpack` · `draco_encoder` · `obj2gltf` | ❌ 없음 |
| `node_modules/.bin` 내 gltf/draco/meshopt | ❌ 없음 |
| `python3 -c "import bpy"` | ❌ `ModuleNotFoundError` |
| `python3` · `pip3` · `brew` · `docker` | ✅ 있음 (설치 수단은 있으나 **승인 대상**) |

### 2.1 ⚠ 계획서의 빈칸: `@gltf-transform/cli` 는 FBX 를 읽지 못한다

`DECISIONS.md` 기본값 표는 *"GLB 상한 8MB, `@gltf-transform/cli`로 Draco 또는 meshopt"* 라고만 적혀 있다.
그건 **최적화 단계** 도구다. gltf-transform 의 입력은 glTF/GLB 이고 **FBX 리더가 없다.**
→ **FBX → glTF 단계의 도구가 계획에 빠져 있다.** 이 문서로 채운다.

### 2.2 예상 절차 (도구 승인 후)

```
① FBX → glTF          Blender 4.x --background --python
② 정리·감량            gltf-transform: dedup → weld → join → simplify → prune
③ 양자화·압축          gltf-transform: quantize → meshopt
④ 검증                 gltf-transform inspect / validator
```

②가 이 작업의 본체다. 단순 변환만 하면 draw call 866 이 그대로 넘어온다.

| 단계 | 명령 | 기대 효과 (근거) |
|---|---|---|
| `dedup` | 동일 mesh/material/texture 병합 | 중복 지오메트리 109개 ≈ **3.08 MiB 제거** (실측) |
| `weld` | 정점 병합 | 이미 실측 반영됨 (1,695,948 corner → 461,201 정점) |
| **`join`** | 같은 머티리얼 primitive 병합 | **444 primitive → 71 이하** (유일 머티리얼 수). draw call 의 유일한 해법 |
| **`simplify`** | meshoptimizer 데시메이션 | 20 mm 미만 부품 제거·감량. 여기서 대부분의 이득이 나온다 |
| `prune` | 미사용 UV·머티리얼 제거 | **TEXCOORD_0 전량 제거** (§4) |
| `quantize` | i16 위치 / i8 법선 | 32 B/정점 → 16 B/정점 (실측) |
| `meshopt` | `EXT_meshopt_compression` | §3 |

---

## 3. 8 MB 예산 판정

### 3.1 실측 사다리

`welded 461,201 정점 · 565,316 삼각형` 을 실제 GLB BIN 청크와 같은 바이트 구성으로 만들어 측정했다.

| 단계 | bytes | MiB | 8 MB 예산 |
|---|---:|---:|---|
| f32 무압축 (pos12+nrm12+uv8 = 32 B/정점) | 18,150,328 | **17.31** | ❌ |
| 양자화, glTF 4바이트 정렬 포함 (16 B/정점) | 10,771,112 | **10.27** | ❌ **초과** |
| 양자화, 패딩 없는 실제 BIN | 9,387,509 | 8.95 | ⚠ 경계 |
| └ gzip-9 | 4,227,497 | **4.03** | ✅ |
| └ brotli-9 | 3,032,322 | **2.89** | ✅ |
| └ **brotli-11** | **2,098,798** | **2.00** | ✅ |

속성별 (양자화 → gzip-9):

| 속성 | 원본 | 압축 후 | 비 |
|---|---:|---:|---:|
| POSITION i16×3 | 2.64 MiB | 1.39 MiB | 1.9x |
| NORMAL i8×3 | 1.32 MiB | 0.26 MiB | 5.1x |
| TEXCOORD u16×2 | 1.76 MiB | 0.78 MiB | 2.3x |
| indices u16 | 3.23 MiB | 1.61 MiB | 2.0x |

**측정과 추정의 경계**: 위 압축 수치는 meshopt/Draco **인코더를 거치지 않은** 값이다.
두 코덱 모두 이 데이터에 예측 필터·재정렬을 추가로 적용하므로 **실제 결과는 이보다 작다.**
따라서 위 값은 **보수적 상한**으로 읽어야 한다.

### 3.2 판정

> **8 MB 예산은 달성 가능하다. 그러나 양자화만으로는 10.27 MiB 로 초과한다.**
> **파일 내 압축(`EXT_meshopt_compression` 또는 Draco)은 선택이 아니라 필수다.**

전송 단계 압축(brotli)에 기대면 안 되는 이유:
- 예산 8 MB 는 **S3 객체 · 업로드 상한**에 걸린다 (`07-s3-storage-plan.md` S5). 전송 인코딩은 그 검사를 통과시키지 못한다.
- `/api/media/[id]` 는 S3 바이트를 **그대로 스트리밍**한다 (D15). 자동 재압축이 없다.
  brotli 를 쓰려면 **업로드 시점에 미리 압축해 `Content-Encoding: br` 로 저장**해야 한다 — 별도 결정 사항.

### 3.3 Draco vs meshopt

| | **meshopt** (`EXT_meshopt_compression`) | **Draco** (`KHR_draco_mesh_compression`) |
|---|---|---|
| 디코더 배포 | three 에 동봉 (`examples/jsm/libs/meshopt_decoder`). **추가 파일 배포 없음** | 별도 WASM+JS 를 `public/` 에 복사하고 `DRACOLoader.setDecoderPath()` 로 지정. **배포 산출물이 늘고 CSP·경로 문제가 생긴다** |
| 디코드 비용 | SIMD, 매우 빠름 | 느림. 저사양 모바일에서 체감 |
| 압축률 | 낮음 | 높음 (보통 meshopt 대비 더 작음) |
| 랜덤 액세스 | 유지 (양자화된 정점 그대로) | 완전 재인코딩 — DCC 툴로 되열 수 없음 |
| 우리 상황 | 실측 상한 4.03 MiB → **예산의 절반** | 더 줄여도 얻는 것이 없음 |

**→ meshopt 채택.** `04-architecture.md` 의 기존 결정과 같다.

⚠ 다만 `04-architecture.md` 에 *"meshopt 가 2 MB 를 넘으면 Draco"* 라는 임계가 적혀 있다.
**이 임계는 재검토를 권한다.** 실측 하한(brotli-11)이 2.00 MiB 이므로 meshopt 결과는 거의 확실히
2 MB 를 넘어 Draco 로 넘어가게 되는데, **예산은 8 MB 이고 4 MiB 면 이미 충분하다.**
Draco 디코더 배포 비용을 2 MB 절약과 바꾸는 것은 이 프로젝트에서 남는 장사가 아니다.
→ **제안: 임계를 "meshopt 결과가 8 MB 를 넘으면 Draco" 로 완화.** (사용자 판단 사항)

---

## 4. 텍스처 처리 방침

**텍스처가 0개다.** 따라서:

| 항목 | 방침 |
|---|---|
| **KTX2 / Basis** | ❌ **불필요.** 지금은 압축할 이미지 자체가 없다. `@gltf-transform/cli` 의 KTX2 경로는 `toktx` 외부 바이너리도 요구하므로, 없는 문제를 위해 도구를 늘리지 않는다 |
| **TEXCOORD_0** | ❌ **전량 제거한다.** 참조하는 텍스처가 없으므로 순수 낭비다. 실측: 정점 461,201 → 434,727, BIN 10.27 → **8.21 MiB** (`gltf-transform prune`) |
| 머티리얼 | 75개(유일 71) 색상 전용 → glTF `pbrMetallicRoughness.baseColorFactor` 로 직결. **텍스처 없는 PBR** |
| 투명 머티리얼 | `Acrylic (Clear)` 등이 `alphaMode: BLEND` 가 된다. 정렬 비용과 시각적 산만함을 감안해 **불투명으로 통일할지 결정 필요** |
| **해상도 상한 (나중에 텍스처가 생기면)** | 이미 정해진 이미지 정책을 그대로 따른다: `poster` 계열 **긴 변 1600px · 2 MB**, 그 외 512px · 1MB (`DECISIONS.md` 기본값 표). 3D 텍스처를 새로 도입하면 그때 **2048px 상한 + KTX2** 를 별도 결정으로 올린다 |
| 포스터 이미지 | §5 참조 — **이것만은 반드시 필요하다** |

---

## 5. 모바일 fallback 3단 사다리 (G12 · C12)

`04-architecture.md` 의 3단 사다리를 이 파일의 실측치와 스키마에 맞춰 구체화한다.

| 단 | 무엇 | 트리거 | 산출물 |
|---|---|---|---|
| **1. 포스터 (항상)** | 서버 HTML 안의 정적 이미지. `next/image` 최적화. **LCP 는 언제나 이 이미지다** | 조건 없음 | `rocket_models.poster_media_id` → `/api/media/{id}` |
| **2. WebGL 승격** | 클라이언트 아일랜드가 마운트되고 · WebGL2 컨텍스트 프로브 성공 · `IntersectionObserver` 로 화면 진입 · DB 플래그 허용 → 그때 `dynamic(..., { ssr: false })` 로 three 청크를 당긴다 | 아래 전부 통과 | GLB |
| **3. 승격 안 함** | 포스터 그대로 유지 | 프로브 실패 / `navigator.connection.saveData` / `prefers-reduced-motion: reduce` / 뷰포트에 맞는 DB 플래그가 false | — |

### 5.1 DB 와의 정합 — 이미 맞다

`src/lib/db/schema/three.ts` 의 `rocket_models`:

```
enabled_desktop  boolean NOT NULL DEFAULT true
enabled_mobile   boolean NOT NULL DEFAULT false   -- 모바일에 WebGL 강제 금지
```

**`enabled_mobile` 의 기본값이 이미 `false`** 다. G12(뷰포트별 개별 활성화)와 C12(모바일 fallback)가
스키마 기본값만으로 만족되고, 3단이 **기본 동작**이 된다. 추가 스키마 변경 불필요.

### 5.2 프로브 규칙

- **WebGL2 는 "지원 여부"를 가정하지 말고 컨텍스트를 실제로 만들어 확인한다.** `canvas.getContext('webgl2')`
  가 `null` 이면 즉시 3단. 컨텍스트는 확인 후 `loseContext()` 로 반납한다.
- `prefers-reduced-motion` 은 auto-rotate(G8)·스크롤 카메라(G6)를 끄는 근거이기도 하다.
- ⚠ `deviceMemory` · `hardwareConcurrency` 로 저사양을 거르는 것은 **표준 보증이 없는 휴리스틱**이다.
  Safari 는 `deviceMemory` 를 구현하지 않는다. 쓰려면 "없으면 통과" 로 설계해야 하고,
  차단 기준으로 삼으면 안 된다. **`[검증 안 됨]` — 벤더 문서가 규정하는 사다리가 아니라 설계 권고다.**

### 5.3 🔴 포스터 소스가 아직 없다

| 후보 | 실측 | 판정 |
|---|---|---|
| `public/assets/img/rocket/icx2.webp` | **512 × 1024 · 10,574 bytes** | ⚠ 있긴 하다. 그러나 포스터 상한(긴 변 1600px)의 **64%** 크기이고, 3D 씬의 카메라 프레이밍과 일치하지 않아 **승격 순간 이미지가 튄다** |
| GLB 렌더 스틸 | — | ❌ **이 머신에서 만들 수 없다.** 렌더러가 없다 (§2) |

→ **포스터는 GLB 변환 후 같은 카메라(`camera_*` · `fov`)로 렌더해 만들어야 한다.**
그때까지는 `icx2.webp` 를 임시 포스터로 쓰되, **Gate 6 전에 교체**한다.
→ 요구사항 **G2(포스터 이미지)** 는 지금 미충족이며, GLB 변환에 종속된다.

---

## 6. 🔴 G11(부품 강조)은 현 파일로 성립하지 않는다

`rocket_hotspots.highlight_node` 는 **GLB 안의 노드 이름**을 키로 잡는 설계다.

그런데 실측상 Model 1,754개 중 **729개(41.6%)가 `Body1`~`Body29` 자동 생성 이름**이고,
그중 `Body1` 하나가 **381개**다. 이름으로는 특정 부품을 지목할 수 없다.

선택지:

| | 방법 | 비용 |
|---|---|---|
| 가 | CAD 에서 강조 대상 부품만 **의미 있는 이름으로 개명** 후 재export | 팀 작업. 강조 대상이 5~10개면 현실적 |
| 나 | 변환 파이프라인에서 **노드 경로(index path)** 를 키로 쓰도록 `highlight_node` 의미를 변경 | 스키마 변경 없음(text 컬럼). 단 **모델 교체 시 전부 깨진다** → G14 위반 |
| 다 | 강조를 포기하고 **핫스팟 라벨만** 표시 (스키마가 이미 `highlight_node` NULL 허용) | 요구 G11 미충족 |

**→ 권고: 가.** ②의 `join`(444 → 71 primitive) 을 거치면 부품 단위 노드가 어차피 사라지므로,
**강조 대상 부품만 별도 노드로 남기고 나머지를 병합**하는 것이 draw call 과 G11 을 동시에 푸는 유일한 경로다.
이건 파이프라인 설정이 아니라 **CAD 쪽 작업**이다. → 사용자·팀 확인 필요.

---

## 7. 필요한 의존성 (설치 승인 요청)

`npm install` 을 하지 않았다. 아래는 **요청 목록**이다.

### 7.1 변환 툴체인 (개발 머신, 런타임 아님)

| 항목 | 종류 | 왜 필요한가 | 대안 |
|---|---|---|---|
| **Blender 4.x** | 앱 (`brew install --cask blender`) | **FBX 를 읽을 수 있는 유일한 무료·유지보수 중인 도구.** headless (`--background --python`) 로 스크립트 실행 가능 | FBX2glTF — 수년째 릴리스 없음 / Autodesk FBX SDK — C++ · 라이선스 |
| **`@gltf-transform/cli`** | devDependency | dedup·weld·**join**·simplify·prune·quantize·meshopt. `04-architecture.md` 가 이미 `4.4.2` 로 지정 | `gltfpack` (meshopt 전용, join 없음) |

> ⚠ Blender 는 **npm 의존성이 아니다.** `package.json` 은 건드리지 않아도 된다.
> `@gltf-transform/cli` 만 `devDependencies` 에 들어가고, **런타임 번들에는 절대 포함되지 않는다.**

### 7.2 런타임 3D (P7-27·28 구현에 필요 — 현재 전부 미설치)

| 패키지 | 왜 | 제약 |
|---|---|---|
| `three` | 렌더러 | — |
| `@react-three/fiber` | React 19 렌더러 바인딩 | **peer 가 `>=19 <19.3`.** `DECISIONS.md` 가 React 를 `19.2.8` 로 정확히 핀해 둔 이유가 이것이다. 현재 `package.json` 이 이미 `19.2.8` 고정 + `overrides` 라 조건 충족 |
| `@react-three/drei` | `useGLTF` · `Bounds`(G14 framing) · `Html`(핫스팟 라벨) | drei 없이 직접 구현하면 G14 프레이밍을 손으로 짜야 한다 |

meshopt 디코더는 **`three` 에 동봉**되므로 추가 패키지가 아니다 (§3.3).

**세 패키지가 없으면 P7-27(고정 캔버스)·P7-28(모바일 fallback)의 3D 부분을 구현할 수 없다.**
단, §5 의 **1단(포스터)은 지금 당장 의존성 없이 구현 가능**하다 — 그리고 그게 LCP 를 담당하는 부분이다.

---

## 8. 정직한 판정 — 이 기체를 웹에 올리는 게 타당한가

**타당하다. 단, 지금 파일을 "변환"하는 작업이 아니다.**

근거를 나눠서 적는다.

| 질문 | 실측 답 |
|---|---|
| 8 MB 안에 들어가나? | **들어간다** (2.0~4.0 MiB). 크기는 이 문제의 어려운 부분이 아니었다 |
| 60 fps 로 돌아가나? | **의심스럽다.** draw call **866**, 렌더 삼각형 **1,163,444**, 투명 머티리얼 다수. 저사양 모바일에서는 확실히 안 된다 — 그래서 §5 의 사다리가 안전장치가 아니라 **기본 경로**여야 한다 |
| 보기 좋은가? | **아니다, 그대로는.** 텍스처 0 · 애니메이션 0 · Fusion appearance 색상만. 히어로에 넣으면 **회색 CAD 뷰어**다. 조명·환경맵(G7)이 시각 품질의 전부를 감당해야 한다 |
| 요구사항을 만족하나? | G1·G4~G9 는 GLB 만 있으면 충족. **G2(포스터) 미충족**(§5.3), **G11(부품 강조) 현 상태로 불가**(§6) |
| 들인 노력이 값을 하나? | **한다 — 감량을 제대로 하면.** 로켓 팀 사이트에서 실제 기체를 돌려보는 것은 사진 6장이 못 하는 일이다. 다만 얻는 값은 "16 MB CAD 를 올렸다" 가 아니라 **"1.75 m 기체의 형상을 60fps 로 만질 수 있다"** 에서 나온다 |

### 반대 근거도 적는다

- 삼각형의 **56%가 20 mm 미만 부품**이다. 이 디테일은 웹에서 **영원히 보이지 않는다.** 그걸 위해
  변환·감량·검증 파이프라인을 세우는 비용이 실재한다.
- 팀이 원하는 게 "기체를 보여주는 것"이라면, **1600px 포스터 3~4장(정면·측면·분리)** 이
  훨씬 싸고, 모든 기기에서 동작하고, LCP 를 해치지 않는다.
- 3D 는 **P7 이고, D1(Posts)·U1·U2 가 아직 막혀 있다.** 3D 는 막히지 않은 유일한 큰 작업이라
  착수하기 쉬워 보이지만, 그게 우선순위가 높다는 뜻은 아니다.

### 권고

1. **지금 하라**: §5 의 **1단(포스터)** 을 의존성 0으로 구현. `icx2.webp` 를 임시로 쓴다. G12·C12 의 뼈대가 선다.
2. **승인받고 하라**: Blender + `@gltf-transform/cli` 설치 → 변환 → **`simplify` 목표 삼각형 ~120k**
   (현재의 10%. ≥100 mm 구조물이 63k 이므로 형상은 보존된다) → `join` 으로 primitive 71 이하 → meshopt.
   **목표: GLB ≤ 4 MB · draw call ≤ 100 · 렌더 삼각형 ≤ 150k.**
3. **팀에 물어라**: G11 강조 대상 부품 목록과 그 부품들의 CAD 개명 (§6).
4. **하지 마라**: 지금 파일을 단순 변환해서 올리는 것. 8 MB 는 통과하지만 866 draw call 이 그대로 넘어온다.

---

## 9. 스크립트

`scripts/model/inspect-fbx.ts` — 의존성 없이 Node 기본 모듈만 쓴다.

```bash
npx tsx scripts/model/inspect-fbx.ts                          # 기본: public/assets/icx-2.fbx
npx tsx scripts/model/inspect-fbx.ts --top 40                 # 메시 표 행 수
npx tsx scripts/model/inspect-fbx.ts --brotli 11              # 압축 실측 품질 (기본 9)
npx tsx scripts/model/inspect-fbx.ts --json                   # 기계 판독용
npx tsx scripts/model/inspect-fbx.ts path/to/other.fbx        # 다른 파일
```

무엇을 하는가:

- FBX 노드 트리를 끝까지 파싱하고, 읽지 못한 구간이 있으면 **경고로 보고한다** (추측하지 않는다).
- 배열 페이로드를 inflate 해 정점·삼각형을 **센다.**
- (위치·법선·UV) 를 **실제로 웰딩해** glTF 정점 수를 구한다.
- 그 정점을 **양자화해 GLB BIN 청크와 같은 바이트로 만들고 gzip/brotli 해 크기를 측정한다.**
- 부품 크기별 삼각형 배분, 노드 이름 분포, 중복 지오메트리, 월드 치수를 계산한다.

실행 2.1s · 검증: `npx tsc --noEmit` 0 · `npx eslint scripts/` 0.

⚠ 변환 파이프라인이 서면 이 스크립트는 **GLB 검증용으로는 쓸 수 없다** (glTF 파서가 아니다).
그때는 `gltf-transform inspect` 를 쓴다.

---

## 10. 남은 미확인 · 사용자 조치

| # | 항목 | 왜 |
|---|---|---|
| **T1** | **Blender 4.x · `@gltf-transform/cli` 설치 승인** | 이게 없으면 §2 이후가 전부 막힌다 |
| **T2** | `three` · `@react-three/fiber` · `@react-three/drei` 설치 승인 | P7-27·28 의 3D 부분 |
| **T3** | G11 강조 대상 부품 목록 + CAD 개명 | §6. 팀 작업이라 대체 불가 |
| **T4** | 포스터 원본 (1600px, 3D 카메라와 같은 프레이밍) | §5.3. GLB 변환 후 생성 |
| **T5** | X·Y 0.73~0.77 m 의 정체 — 발사대가 조립체에 포함됐는가 | §1.7. 변환 후 육안 확인 |
| **T6** | 투명 머티리얼(`Acrylic (Clear)` 등) 을 불투명으로 통일할지 | §4 |
| **T7** | `04-architecture.md` 의 "meshopt > 2 MB 면 Draco" 임계 완화 여부 | §3.3 |
| **T8** | GLB 를 `Content-Encoding: br` 로 미리 압축해 저장할지 | §3.2. D15 스트리밍과 맞물림 |


---
---

# 실행 기록 (2026-08-24)

## 11. 변환 경로 — Blender 없이 끝났다

§2 는 "FBX 를 읽을 수 있는 유일한 무료 도구는 Blender" 라고 적었다. **그 조사에 빠진 것이 하나 있었다.**

`three` 는 `examples/jsm/loaders/FBXLoader.js` 로 **완전한 FBX 바이너리 리더**를 배포한다.
그리고 `examples/jsm/exporters/GLTFExporter.js` 로 GLB 를 쓴다. 우리는 런타임(P7-27)용으로
`three` 를 어차피 설치하므로, **FBX→glTF 단계의 추가 도구는 0개**다.
Blender 1GB 다운로드도, FBX2glTF 의 유지보수 중단 문제도 사라진다.

두 모듈은 브라우저를 전제하므로 Node 에서 shim 두 개가 필요하다 (`scripts/model/fbx-to-glb.ts`):

| 무엇 | 왜 | 우리에게 실제로 걸리나 |
|---|---|---|
| `FileReader` | GLTFExporter 가 GLB 를 만들 때 `Blob` → `FileReader` 를 쓴다. Node 26 에 `Blob` 은 있고 `FileReader` 는 없다 | **걸린다.** `readAsArrayBuffer`·`readAsDataURL` 두 메서드만 구현했다 |
| `window` | FBXLoader 가 임베드 텍스처에서 `window.URL.createObjectURL`, 카메라 파싱에서 `window.innerWidth` 를 읽는다 | 텍스처 0·카메라 0 이라 닿지 않는다. 조용히 죽지 않도록 깔아만 둔다 |

### 파이프라인

```bash
# ① FBX → 무손실 GLB (중간 산출물은 $TMPDIR, 레포에 남기지 않는다)
npx tsx scripts/model/fbx-to-glb.ts

# ② 감량 → public/assets/models/icx-2.glb
NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/model/optimize-glb.ts \
  "$TMPDIR/icaros-model/icx-2.raw.glb" --out public/assets/models/icx-2.glb \
  --min-part 20 --mode join --up z --scale 0.001 --center

# ③ 포스터 (3D 와 같은 궤도각·화각)
npx tsx scripts/model/render-poster.ts public/assets/models/icx-2.glb \
  --out public/assets/models/icx-2-poster.png --width 900 --height 1600 --ss 3

# ④ 검증
npx tsx scripts/model/inspect-glb.ts public/assets/models/icx-2.glb --mm-per-unit 1000
npx tsx scripts/model/verify-runtime-load.ts
```

**`public/assets/icx-2.fbx` 원본은 읽기만 했다.** 수정·삭제 없음 (`16,920,592 bytes` 그대로).

### 1단계에서 관찰된 것

- FBXLoader 가 만든 Mesh 노드는 **717개**다. §1.4 의 "Geometry→Model 연결 866" 은 멀티머티리얼
  메시의 머티리얼 슬롯까지 센 값이고, three 는 그것을 **하나의 Mesh + geometry group** 으로 만든다.
  즉 "866" 은 draw call 로는 맞고 **객체 수로는 717** 이다. 두 수는 다른 것을 센다.
- FBXLoader 는 **비인덱스 지오메트리**를 뱉는다. 그래서 1단계 GLB 가 **54.74 MiB** 다
  (1,695,948 corner × 32 B). 이건 문제가 아니라 예상된 중간 상태이고, 2단계 `weld()` 가 되돌린다.
- 경고 1건: `THREE.FBXLoader: The FBX file contains invalid (negative) material indices.`
  §1.4 의 `ByPolygon` 61개 메시에서 나온다. 렌더 결과에 이상은 보이지 않았다(§13).

## 12. 🔴 정정 — "예산과 draw call 은 동시에 만족할 수 없다"는 틀렸다

정정 배너 3번의 표는 **양자화만 한 BIN** 을 비교했다. 그런데 같은 문서 §3.2 가 이미
*"파일 내 압축(meshopt)은 선택이 아니라 필수"* 라고 결론지었다. 그러면 비교 대상은 meshopt 를
**건 뒤의** 크기여야 한다. 6가지 조합을 전부 만들어 재 봤다.

| # | 옵션 | GLB | draw call | 렌더 삼각형 |
|---|---|---:|---:|---:|
| A | 아무것도 안 함 (weld·dedup·prune·meshopt 만) | 2.86 MiB | 1,311 | 1,163,444 |
| B | `--mode instance` (EXT_mesh_gpu_instancing) | **2.33 MiB** | 470 | 1,163,444 |
| C | `--mode join` (= flatten + join, 필터 없음) | 3.77 MiB | **56** | 1,163,444 |
| D | `--min-part 5 --mode join` | 2.81 MiB | 41 | 818,512 |
| **E** | **`--min-part 20 --mode join`** ← 채택 | **1.94 MiB** | **31** | **511,500** |
| F | `--min-part 20 --simplify 0.35 --mode join` | 0.89 MiB | 31 | 184,898 |

**C 를 보라.** 정정 배너가 27.34 MiB 를 예고했던 바로 그 조합이 **3.77 MiB** 다. 8 MB 예산의 47% 다.
배너의 산술 자체는 맞았다 — 양자화 BIN 은 정말로 커진다. 다만 그 BIN 을 meshopt 가 다시 접는다.
`flatten` 이 복제하는 것은 **인덱스와 정점**인데, 복제본은 정의상 서로 비슷해서 압축이 아주 잘 든다.

### 왜 E 를 골랐나 — 예산이 우선이라는 지시에 대한 답

지시는 "예산(8MB)이 우선"이었다. 실측 결과 **그 선택을 할 필요가 없었다.** E 는

- **1.94 MiB** — 예산 8 MB 의 24%, 문서 §8 권고치 4 MB 의 49%
- **draw call 31** — 목표 ≤100 의 31%
- 렌더 삼각형 **511,500** — 문서 권고치 150k 는 넘는다 (아래)

세 지표 중 둘이 목표를 크게 밑돌고, 남는 하나는 **의도적으로 포기했다.**

### 왜 데시메이션(F)을 하지 않았나 — 숫자로 결정했다

F 는 삼각형을 184,898 로 줄이고 크기도 0.89 MiB 다. 숫자만 보면 F 가 낫다.
그런데 **렌더해서 픽셀로 비교했다** (§13 의 소프트웨어 래스터라이저, 500×900 · 기체 픽셀 20,967개):

| 비교 대상 | 원본 대비 다른 픽셀 (>2/255) | 평균 차이 |
|---|---:|---:|
| E (`--min-part 20`, 데시메이션 없음) | 기체 픽셀의 **4.08%** | 8.0 |
| `--simplify 0.5` | 6.73% | 6.6 |
| F (`--simplify 0.35`) | **12.24%** | 6.8 |

그리고 F 의 렌더를 눈으로 보면 **노즈콘에 각이 진다.** 실루엣에서 가장 눈에 띄는 곳이다.
1.94 MiB 는 이미 예산의 24% 인데, 그 여유를 노즈콘 페이싱과 바꾸는 것은 남는 장사가 아니다.
→ **데시메이션 없음.** 필요해지면 `--simplify` 플래그가 그대로 있다.

### `--min-part 20` 이 안전한 이유

583개 부품(SMD 0403 커패시터·DIP 소켓 핀·M3 너트)을 버리고 134개를 남긴다. 렌더 삼각형의 56% 다.
§1.5 의 픽셀 산술("20 mm 부품은 히어로에서 6.9 px")이 예측한 대로, **렌더 차이는 기체 픽셀의 4%**
이고 육안으로 두 그림을 구별할 수 없다. 추정이 아니라 두 PNG 를 픽셀 단위로 비교한 값이다.

### `join` 의 대가 — 기록해 둔다

`join` 은 머티리얼 단위로 병합하므로 **부품 노드 이름이 전부 사라진다** (mesh 21개, 이름 `Body1` 계열).
즉 **G11(`highlight_node` 기반 부품 강조)의 문은 이 산출물에서 닫힌다.** §6 의 결론과 같고,
D19 가 홈 히어로만 쓰기로 정했으므로 지금은 대가가 없다.
로켓 상세 페이지에서 핫스팟이 필요해지면 **`--mode instance`(B)** 로 다시 구우면 된다 —
2.33 MiB · draw call 470 으로, 부품 노드가 그대로 남는다. 그래서 두 모드를 다 남겨 두었다.

### 좌표계 정규화

원본은 **Z 가 장축, 1 unit = 1 mm** 였다. glTF 규약(Y-up)과 다르고, DB 의 `camera_z` 기본값 5 가
5 mm 를 뜻하게 되어 아무것도 보이지 않는다. 자산 쪽에서 한 번에 바로잡았다:

`--up z` (X축 −90° 회전) · `--scale 0.001` (mm→m) · `--center` (AABB 중심을 원점으로)
→ 최종 AABB **0.464 × 1.660 × 0.464 m**, 중심 (0, 0, 0).

## 13. 소프트웨어 렌더러 — 검증과 포스터를 한 번에

이 머신에 WebGL 도 Blender 도 없다. 그런데 "20 mm 미만 583개를 버려도 되는가"는 **숫자로 답할 수 없는
질문**이다. 그래서 `scripts/model/render-poster.ts` 에 의존성 0의 z-buffer 래스터라이저를 짰다
(PNG 인코더 포함 — `node:zlib` 만 쓴다).

얻은 것 셋:

1. **T5 해소.** 기체를 실제로 보니 X·Y 464 mm 는 발사대가 아니라 **착륙 레그 4개**다.
   중동체에 그리드핀 링, 하단에 4개의 소형 추력기가 보인다 — VTVL 호퍼 형상이다.
2. **감량 판정** (§12 의 픽셀 비교표).
3. **G2 포스터.** `900×1600 · 38,831 bytes · 투명 PNG`. `--yaw -28 --pitch 8 --fov 28 --fit 0.86` 으로
   구웠고, **런타임 `DEFAULT_STAGE` 가 같은 값을 쓴다.** §5.3 이 요구한 "3D 씬의 카메라와 일치하는
   포스터"가 정의상 만족된다. 임시 포스터(`icx2.webp` 512×1024)는 쓰지 않는다.

`next/image` 최적화도 확인했다 (`formats: ['image/webp']`): w=384 → 7,534 B · w=640 → 14,002 B,
전부 `image/webp` 200. 알파가 유지된다.

## 14. 런타임 — 홈 고정 캔버스 (P7-27 · P7-28)

`src/components/three/` 6파일. 계약은 레퍼런스 두 곳이 독립적으로 도달한 것 그대로다
(03 §1 Vast `.webgl-home-space-station` / 03 Part 3 Hanwha `.mesh-area`).

| 파일 | 역할 | 초기 번들 |
|---|---|---|
| `HeroStage.tsx` | 진입점. 타깃 박스 탐색 · 폴백 사다리 · 포스터 | **포함** (3.0 KB gz) |
| `capabilities.ts` | WebGL2 프로브 · 모바일 · saveData · deviceMemory | 포함 |
| `config.ts` | `StageConfig` + `DEFAULT_STAGE` | 포함 |
| `rect.ts` | 타깃 박스 rect 추적 (rAF 합침 · ResizeObserver) | 포함 |
| `HeroStage.module.css` | 고정 레이어 · 포스터 배치 | 포함 |
| `Scene.tsx` | R3F Canvas · GLTFLoader · 조명 · 에러 경계 | **지연** |
| `framing.ts` | 카메라 수학 (`three` import) | **지연** |

### 계약

```
히어로가 선언:   <div data-webgl-target="home-hero"> …빈 상자… </div>
캔버스가 소비:   getBoundingClientRect() → applyStageCamera()
```

핵심은 `camera.setViewOffset(rectW, rectH, -rectX, -rectY, canvasW, canvasH)` 다.
캔버스는 뷰포트 전체인데 모델은 박스 안에 있어야 한다. 이 호출은 "가상의 rectW×rectH 이미지"
기준으로 프러스텀 스케일을 잡고, 실제 캔버스를 그 이미지의 `(-rectX, -rectY)` 에 놓인 더 큰 창으로
취급한다. 최종 프러스텀 종횡비가 `canvasW/canvasH` 로 떨어져 **왜곡이 없다.**
브레이크포인트마다 좌표를 손으로 넣을 필요가 사라진다.

거리는 바운딩 **구**가 아니라 **AABB 8꼭짓점**으로 푼다. 0.46 × 1.66 × 0.46 처럼 길쭉한 물체에서
구 반경은 높이에 지배되므로, 좁은 가로 화각으로 그 구를 담으려다 카메라가 필요한 거리의 두 배까지
물러난다. 포스터 첫 렌더에서 실제로 그렇게 나왔고, 그래서 고쳤다.

### 폴백 사다리 (G12 · C12)

| 단 | 조건 | 결과 |
|---|---|---|
| ① 3D | WebGL2 컨텍스트 생성 성공 · 뷰포트별 DB 플래그 허용 · `saveData` 아님 · `deviceMemory ≥ 4`(없으면 통과) | `Scene` 지연 로드 |
| ② 포스터 | 위 중 하나라도 실패, 또는 GLB 로드 실패(에러 경계) | 정적 이미지 |
| ③ 히어로 그대로 | 타깃 박스가 없거나 `poster: null` | 아무것도 안 그림 |

- **모바일 기본 off.** `enabledMobile: false` — `rocket_models.enabled_mobile` 스키마 기본값과 같다.
  판정 기준은 `(max-width: 767px)` 로, 히어로 CSS 의 모바일 브레이크포인트와 **같은 값**이다.
- `deviceMemory` 는 **없으면 통과**로 설계했다 (Safari 미구현). §5.2 의 경고를 그대로 따랐다.
- `prefers-reduced-motion` 은 3D 를 끄지 **않는다.** 자동 회전과 스크롤 카메라 연출만 멈춘다
  (박스 추적은 유지 — 그건 연출이 아니라 위치다). §5 의 표는 이걸 3단 트리거로 적었는데,
  **의도적으로 다르게 구현했다**: 정지한 3D 는 포스터보다 나쁘지 않고, 모션만 끄면 요구를 만족한다.
- 히어로가 화면 밖으로 나가면 `frameloop='never'` 로 **렌더 루프를 완전히 멈춘다.**

### drei 를 쓰지 않은 이유

§7.2 는 `@react-three/drei` 를 필수로 적었다. 실제로 필요한 것은 `useGLTF` 와 bounds 둘뿐인데,
drei 는 `three-stdlib` · `troika-three-text` · `@mediapipe/tasks-vision` · `camera-controls` ·
`detect-gpu` 등 20여 개를 끌고 온다. `GLTFLoader` + `Box3` 로 직접 쓰면 그 그래프가 통째로 사라진다.
핫스팟 라벨(G11)이 실제로 필요해지는 날 다시 판단한다.

### 환경맵

`RoomEnvironment` + `PMREMGenerator` 로 **런타임 생성**한다. HDR 파일 배포가 0바이트이고,
텍스처가 0개인 회색 Fusion 머티리얼(§1.6)에 반사 그라디언트를 주는 유일한 수단이다.
§8 의 "그대로 올리면 회색 CAD 뷰어" 지적에 대한 대응이 이것과 3점 조명이다.

### 설치한 의존성

| 패키지 | 종류 | 왜 |
|---|---|---|
| `three@^0.185.1` | dependency | 렌더러 + **FBX 리더** + meshopt 디코더 |
| `@react-three/fiber@^9.7.0` | dependency | React 19 바인딩. peer `>=19 <19.3` — `react@19.2.8` 핀과 `overrides` 그대로 유지했다(설치 후 재확인: 19.2.8) |
| `@types/three` · `@gltf-transform/{core,extensions,functions}` · `meshoptimizer` | devDependency | 변환 파이프라인. **런타임 번들에 들어가지 않는다** |

`@gltf-transform/cli` 대신 프로그래밍 API(core/extensions/functions)를 썼다 — CLI 를 셸로 호출하는
대신 한 스크립트 안에서 부품 필터링 같은 커스텀 단계를 섞을 수 있어서다.
`EXT_meshopt_compression` 은 `io.registerDependencies({'meshopt.encoder': …, 'meshopt.decoder': …})`
가 **필수**다. 없으면 변환은 통과하고 **직렬화 순간**에 `encodeFilterOct is undefined` 로 죽는다.

## 15. 검증한 것과 검증하지 못한 것

### 실측으로 확인한 것

| 항목 | 방법 | 결과 |
|---|---|---|
| GLB 가 **브라우저 런타임 코드로** 열리는가 | `verify-runtime-load.ts` — three `GLTFLoader` + `MeshoptDecoder` (파이프라인이 쓴 gltf-transform 과 **다른 구현**) | ✅ 9 ms · Mesh 31 · 삼각형 511,500 · AABB 0.464×1.660×0.464 · **NaN 지오메트리 0** |
| 카메라 프레이밍이 정말 박스 안에 들어가는가 | 같은 스크립트가 `framing.ts` 의 `applyStageCamera()` 를 그대로 호출 → AABB 8꼭짓점 투영 | ✅ 5개 뷰포트 전부 박스 내부, 세로 채움 83.8~84.0% (`fit` 0.86) |
| 초기 JS 에 three 가 섞이지 않는가 | 프로덕션 빌드 → 서버 HTML 의 `<script>` 전부 수집 → 문자열 검사 | ✅ **없음** |
| 초기 JS 증가량 | 같은 트리에서 `<HeroStage/>` 유무로 두 번 빌드 후 실측 | **183.7 → 186.3 KB gzip (+2.6 KB)** / raw 590.5 → 597.7 KB |
| 3D 청크가 정말 분리됐는가 | `.next/static/chunks` 실측 | `1m6rp4icyu2-o.js` **937.6 KB raw / 247.7 KB gzip / 203.5 KB brotli** — 초기 HTML 에 없음 |
| 404 회귀 | 프로덕션 서버(5403) | `/rocket/nope` 404 · `/nope` 404 |
| 포스터가 서버 HTML 에 들어가는가 | 프로덕션 HTML grep | ✅ `next/image` srcset 포함 |
| GLB 정적 서빙 | curl | 200 · `model/gltf-binary` · 2,034,016 B |
| 원본 FBX 무변경 | `statSync` | 16,920,592 B 그대로 |
| DB 무변경 | `psql` count | site_settings 33 · rockets 4 · members 27 · engines 6 (**행을 만들지도 지우지도 않았다**) |

> 초기 JS 측정 기준: 브랜치 HEAD 트리를 별도 디렉터리로 복사해 `<HeroStage/>` 마운트 유무만 바꿔
> 두 번 빌드했다. 소유 경로 밖(`page.tsx`)을 수정하지 않기 위해서다. 150 KB 예산은 **3D 를 뺀
> 애플리케이션 기준**이고, 위 183.7 KB 는 3D 이전의 기존 수치다 — 이 트랙이 더한 것은 **2.6 KB** 뿐이다.

### 확인하지 못한 것 — 정직하게

1. 🔴 **실제 GPU 렌더를 보지 못했다.** 이 Node 환경에 WebGL 컨텍스트가 없다. 검증한 것은
   "GLB 가 three 로 파싱된다" 와 "카메라 행렬이 올바른 화면 좌표를 낸다" 까지다.
   **셰이딩·톤매핑·환경맵 결과가 어떻게 보이는지는 브라우저에서 봐야 한다.** §13 의 소프트웨어
   렌더는 형상 확인용이지 R3F 파이프라인의 대역이 아니다.
2. **프로브 분기를 실행해 보지 못했다.** `hasWebGL2()` · `saveData` · `deviceMemory` 는 브라우저
   API 라 Node 에서 돌릴 수 없다. 코드 경로는 단순하지만 **동작 확인은 안 됐다.**
3. **60 fps 여부는 미확인.** draw call 31 · 삼각형 511,500 은 데스크톱에서 여유 있는 수치지만,
   실기 프레임을 잰 것이 아니다.
4. **포스터 → 3D 크로스페이드의 실제 모양.** 두 프레임 뒤 전환하도록 짰지만 눈으로 못 봤다.
5. **아직 아무 페이지도 `<HeroStage/>` 를 마운트하지 않았다.** 히어로의 `data-webgl-target="home-hero"`
   는 디자인 트랙이 이미 붙였고, 캔버스 마운트는 소유 경로 밖이라 이 트랙에서 넣지 않았다.
   붙이는 쪽은 한 줄이면 된다:
   ```tsx
   import HeroStage from '@/components/three/HeroStage'
   // …페이지 최상단 어디든 (스스로 fixed 레이어를 만든다)
   <HeroStage />
   ```
6. **넓은 히어로 박스에서 기체가 가늘게 보인다.** 프레이밍 검증 실측: 1440×900 데스크톱에서
   박스가 1312×420 이면 기체의 투영 폭이 **129 px**(박스 폭의 9.8%)다. 세로로 꽉 차고(84%)
   가로로는 가느다란 띠가 된다. 계산은 정확하지만 **조판 판단은 디자인 트랙 몫**이다 —
   박스를 좁히거나(예: 우측 40% 컬럼), `fit` 을 낮추거나, 궤도각을 바꾸면 달라진다.

## 16. 남은 사용자 조치 (§10 갱신)

| # | 항목 | 상태 |
|---|---|---|
| T1 | Blender · `@gltf-transform/cli` 설치 승인 | ✅ **불필요해짐** — Blender 는 안 썼고, gltf-transform 은 프로그래밍 API 를 devDependency 로 설치 |
| T2 | `three` · R3F · drei 설치 승인 | ✅ 완료 (drei 는 **채택하지 않음**) |
| T3 | G11 강조 대상 부품 목록 + CAD 개명 | 🟡 그대로 보류. D19 범위 밖 |
| T4 | 포스터 원본 | ✅ 해소 — 파이프라인이 생성 |
| T5 | X·Y 0.73~0.77 m 의 정체 | ✅ 해소 — 착륙 레그. 실제 폭 0.464 m |
| T6 | 투명 머티리얼을 불투명으로 통일할지 | ✅ 해소 — 변환 후 three 기준 **투명 머티리얼 0개**. `--opaque` 플래그는 남겨 두었으나 쓸 일이 없었다 |
| T7 | "meshopt > 2 MB 면 Draco" 임계 완화 | ✅ 무의미해짐 — meshopt 결과가 **1.94 MiB** 라 임계에 걸리지 않는다. Draco 는 도입하지 않는다 |
| T8 | GLB 를 `Content-Encoding: br` 로 미리 압축할지 | ✅ **불필요.** 1.94 MiB 는 예산 8 MB 의 24%. D15 스트리밍과 얽힌 복잡도를 살 이유가 없다 |
| **T9** | **브라우저 실기 확인** (§15 의 1~4) | 🔴 **새로 생긴 항목.** U5(Chrome 확장 연결)가 해소되면 바로 할 수 있다 |
