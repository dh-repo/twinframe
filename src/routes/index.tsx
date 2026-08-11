import { createFileRoute } from "@tanstack/react-router";
import { AppHome } from "@/components/app-home";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return <AppHome />;
}
