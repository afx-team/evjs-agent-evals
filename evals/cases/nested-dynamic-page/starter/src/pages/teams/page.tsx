import { teams } from "./data";

export default function TeamsPage() {
  return (
    <section>
      <h1>Teams</h1>
      <ul>
        {teams.map((team) => (
          <li key={team.id}>{team.name}</li>
        ))}
      </ul>
    </section>
  );
}
