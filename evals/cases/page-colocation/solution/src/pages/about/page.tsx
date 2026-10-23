import { Link } from "@evjs/ev/navigation";
import AboutCard from "./components/index";

export default function AboutPage() {
  return (
    <section>
      <h1>About evjs</h1>
      <AboutCard />
      <Link to="/">Home</Link>
    </section>
  );
}
