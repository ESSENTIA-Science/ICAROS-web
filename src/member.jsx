import { useEffect, useState } from 'react';
import './member.css';
import { supabase } from './lib/supabase';

const Member = () => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) console.error('[member] fetch error:', error);
      setMembers(data || []);
      setLoading(false);
    })();
  }, []);

  return (
    <section className="memberSection">
      <h1>Members</h1>
      {loading ? (
        <p className="posts-loading">Loading...</p>
      ) : (
        <div className="member-row">
          {members.map((member) => {
            const imageSrc = member.image || '/assets/img/member/profile.webp';
            return (
              <div key={member.id} className="member-item">
                <div className="member-figure">
                  <img className="member-img" src={imageSrc} alt={member.name} loading="lazy" />
                  <div className="member-desc">
                    <p className="member-name">{member.name}</p>
                    <p className="member-role">{member.role}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default Member;
