import './member.css';
import memberData from './assets/member.json';

const Member = () => {
  const members = memberData.members || [];

  return (
    <section className="memberSection">
      <h1>Members</h1>
      <div className="member-row">
        {members.map((member, index) => {
          const imageSrc = member.image || '/assets/img/member/profile.webp';
          return (
            <div
              key={`${member.name}-${index}`}
              className="member-item"
            >
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
    </section>
  );
};
  
export default Member;




