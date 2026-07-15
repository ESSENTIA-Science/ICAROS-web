import { useEffect, useMemo, useState } from 'react';
import './rocket.css';
import { supabase } from './lib/supabase';

const Rocket = () => {
  const [activeGroup, setActiveGroup] = useState('A');
  const [selectedRocket, setSelectedRocket] = useState(null);
  const [rockets, setRockets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('rockets')
        .select('*')
        .order('series', { ascending: true })
        .order('sort_order', { ascending: true });
      if (error) console.error('[rocket] fetch error:', error);
      setRockets(data || []);
      setLoading(false);
    })();
  }, []);

  const visibleRockets = useMemo(
    () => rockets.filter((r) => r.series === activeGroup),
    [activeGroup, rockets]
  );

  return (
    <section className="rocket-section">
      <h1>Rockets</h1>

      <div className="rocket-row-wrapper">
        <div className="rocket-nav">
          <button
            type="button"
            className="rocket-nav__btn"
            onClick={() => setActiveGroup('A')}
            disabled={activeGroup === 'A'}
          >
            ICX 1/2 Series
          </button>
          <button
            type="button"
            className="rocket-nav__btn"
            onClick={() => setActiveGroup('B')}
            disabled={activeGroup === 'B'}
          >
            ICX MV Series
          </button>
        </div>

        {loading ? (
          <p className="posts-loading">Loading...</p>
        ) : (
          <div className="rocket-row">
            {visibleRockets.map((rocket) => (
              <div
                key={rocket.id}
                className="rocket-item"
                onClick={() => setSelectedRocket(rocket)}
              >
                <div className="rocket-figure">
                  <img src={rocket.img} alt={rocket.name} loading="lazy" decoding="async" />
                  <p className="rocket-name">{rocket.name}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedRocket && (
          <div className="rocket-modal-overlay" onClick={() => setSelectedRocket(null)}>
            <div className="rocket-modal" onClick={(e) => e.stopPropagation()}>
              <img
                className="rocket-modal__img"
                src={selectedRocket.img}
                alt={selectedRocket.name}
                loading="lazy"
                decoding="async"
              />
              <div className="rocket-modal__body">
                <h3 className="rocket-modal__title">{selectedRocket.name}</h3>
                <p className="rocket-modal__desc">
                  최대 고도: {selectedRocket.max_altitude_m} m{'\n'}
                  길이: {selectedRocket.size_m} m | 페이로드: {selectedRocket.payload_kg} kg
                </p>
                <div className="rocket-modal__engines">
                  <h4>엔진</h4>
                  <ul>
                    {(selectedRocket.engines || []).map((eng, idx) => (
                      <li key={idx}>
                        {eng.type}
                        {eng.thrust_n ? ` / 추력 ${eng.thrust_n}N` : ''}
                        {eng.burn_time_s ? ` / 연소 ${eng.burn_time_s}s` : ''}
                        {eng.count ? ` x${eng.count}` : ''}
                        {eng.mode ? ` / 모드: ${eng.mode}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  type="button"
                  className="rocket-modal__close"
                  onClick={() => setSelectedRocket(null)}
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default Rocket;
