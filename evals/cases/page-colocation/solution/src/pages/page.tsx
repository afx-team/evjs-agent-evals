import { Link } from "@evjs/ev/navigation";

export default function HomePage() {
  return (
    <section>
      <h1>EVJS eval</h1>
      <p>Welcome to the application.</p>
      <Link to="/about">About</Link>
    </section>
  );
}
