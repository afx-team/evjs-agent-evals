import { usePageParams } from "@evjs/ev/route";
import { teams } from "../data";

export default function TeamPage() {
  const { teamId } = usePageParams<{ teamId: string }>();
  const team = teams.find((candidate) => candidate.id === teamId);

  if (!team) return <h2>Team not found</h2>;

  return (
    <article>
      <h2>{team.name}</h2>
      <p>Members: {team.members}</p>
    </article>
  );
}
