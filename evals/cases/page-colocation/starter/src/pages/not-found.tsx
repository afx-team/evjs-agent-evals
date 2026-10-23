import { Link } from "@evjs/ev/navigation";

export default function NotFoundPage() {
  return (
    <section>
      <h1>Page not found</h1>
      <Link to="/">Home</Link>
    </section>
  );
}
