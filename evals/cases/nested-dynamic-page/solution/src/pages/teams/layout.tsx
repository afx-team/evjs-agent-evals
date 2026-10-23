import { Link } from "@evjs/ev/navigation";
import type { ReactNode } from "react";
import { teams } from "./data";

export default function TeamsLayout({ children }: { children?: ReactNode }) {
  return (
    <section>
      <h1>Teams</h1>
      <nav aria-label="Team navigation">
        <ul>
          {teams.map((team) => (
            <li key={team.id}>
              <Link to="/teams/$teamId" params={{ teamId: team.id }}>
                {team.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </section>
  );
}
