import { lazy, Suspense, useState } from "react";
import "./gallery.css";

const Masonry = lazy(() => import("./component/Masonry"));

const masonryItems = [
  { id: "재료 구매", img: "/assets/img/gallery/01.webp", height: 400, desc: "오프라인 재료 구매 모습" },
  { id: "테스트 엔진 제작 과정", img: "/assets/img/gallery/02.webp", height: 800, desc: "테스트 엔진 제작 중 타공하는 모습" },
  { id: "3D 프린터 출력물", img: "/assets/img/gallery/03.webp", height: 500, desc: "3D 출력물을 출력한 장면" },

  { id: "3D 프린터 출력 과정", img: "/assets/img/gallery/04.webp", height: 400, desc: "로켓 테일핀을 3D 출력하는 장면" },
  { id: "연료 제작 과정", img: "/assets/img/gallery/05.webp", height: 650, desc: "연료 제작 중 질산칼륨을 빻는 모습" },
  { id: "icx-2 모델링 사진", img: "/assets/img/gallery/06.webp", height: 600, desc: "icx-2 최종 모델링 하단부 사진" },

  { id: "TMS 준비", img: "/assets/img/gallery/07.webp", height: 800, desc: "추력측정장치(TMS) 설치 장면" },
  { id: "낙하산 제작", img: "/assets/img/gallery/08.webp", height: 500, desc: "낙하산 재단 및 줄 장착 과정" },
  { id: "사출장치 제작", img: "/assets/img/gallery/09.webp", height: 1000, desc: "사출장치 조립 및 회로 납땜" },

  { id: "동체 도색", img: "/assets/img/gallery/10.webp", height: 800, desc: "동체를 도색하는 과정" },
  { id: "엔진 마운팅", img: "/assets/img/gallery/11.webp", height: 650, desc: "테스트 엔진 마운팅 장면" },
  { id: "발사대 제작", img: "/assets/img/gallery/12.webp", height: 800, desc: "발사대 제작 후 기체 장착" },

  { id: "TMS", img: "/assets/img/gallery/13.webp", height: 700, desc: "TMS 측정 장면" },
  { id: "총 엔진 5개 제작 사진", img: "/assets/img/gallery/14.webp", height: 500, desc: "좌측부터 1, 2, 3, 4, 5번째로 만든 엔진" },
  { id: "캔셋 모델링", img: "/assets/img/gallery/15.webp", height: 900, desc: "캔셋 초기 모델링 사진" }
];

const Gallery = () => {
  const [selectedItem, setSelectedItem] = useState(null);
  const [ready, setReady] = useState(false);

  return (
    <section className="gallery-section">
      <h1>Gallery</h1>

      <div className="masonryGallery" data-ready={ready}>
        <Suspense fallback={null}>
          <Masonry
            items={masonryItems}
            onItemClick={setSelectedItem}
            onReady={() => setReady(true)}
          />
        </Suspense>
      </div>

      {selectedItem && (
        <div className="gallery-modal-overlay" onClick={() => setSelectedItem(null)}>
          <div className="gallery-modal" onClick={e => e.stopPropagation()}>
            <img
              className="gallery-modal__img"
              src={selectedItem.img}
              alt={selectedItem.id}
              loading="lazy"
              decoding="async"
            />
            <div className="gallery-modal__body">
              <h3 className="gallery-modal__title">{selectedItem.id}</h3>
              <p className="gallery-modal__desc">{selectedItem.desc}</p>
              <button
                type="button"
                className="gallery-modal__close"
                onClick={() => setSelectedItem(null)}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default Gallery;
