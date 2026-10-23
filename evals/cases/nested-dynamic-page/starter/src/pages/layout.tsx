import { Link } from "@evjs/ev/navigation";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children?: ReactNode }) {
  return (
    <main>
      <nav aria-label="Main navigation">
        <Link to="/">Home</Link> <Link to="/teams">Teams directory</Link>
      </nav>
      {children}
    </main>
  );
}
