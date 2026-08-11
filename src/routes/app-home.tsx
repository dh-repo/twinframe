import { createFileRoute } from "@tanstack/react-router";
import { AppHome } from "@/components/app-home";

export const Route = createFileRoute("/app-home")({
  component: AppHomePage,
});

function AppHomePage() {
  return <AppHome />;
}

export { AppHome };
