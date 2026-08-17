import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { CreatedWithGrokBanner } from "@/components/created-with-grok-banner";
import appCss from "@/styles.css?url";

const APP_NAME = "Twinframe — Celebrity Look-Alike Finder";
const host = typeof process !== "undefined" ? process.env?.VITE_PUBLIC_HOSTNAME : undefined;
const ogImage = host
  ? `https://og.grok.me/v1/card.png?host=${encodeURIComponent(host)}&title=${encodeURIComponent(APP_NAME)}`
  : "/og.jpg";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "Find your celebrity doppelgänger. Upload a photo or use your camera — private, on-device face matching.",
      },
      { name: "theme-color", content: "#0a0a0b" },
      { name: "color-scheme", content: "dark" },
      { name: "format-detection", content: "telephone=no" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Twinframe" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { property: "og:title", content: APP_NAME },
      {
        property: "og:description",
        content: "Discover which celebrity you look like with on-device face geometry matching.",
      },
      { property: "og:image", content: ogImage },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: APP_NAME },
      {
        name: "twitter:description",
        content: "Discover which celebrity you look like with on-device face geometry matching.",
      },
      { name: "twitter:image", content: ogImage },
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
