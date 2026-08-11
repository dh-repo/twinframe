import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { CreatedWithGrokBanner } from "@/components/created-with-grok-banner";
import appCss from "@/styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Twinframe — Celebrity Look-Alike Finder" },
      {
        name: "description",
        content:
          "Find your celebrity doppelgänger. Upload a photo or use your camera — private, on-device face matching.",
      },
      { name: "theme-color", content: "#0a0a0b" },
      { property: "og:title", content: "Twinframe — Celebrity Look-Alike Finder" },
      {
        property: "og:description",
        content: "Discover which celebrity you look like with on-device face geometry matching.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en" className="antialiased">
      <head>
        <HeadContent />
      </head>
      <body>
        <CreatedWithGrokBanner />
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
