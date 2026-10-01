import { createFileRoute } from "@tanstack/react-router";
import { Game } from "../game/Game";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Table Wars — First-Person Splinter Shooter" },
      { name: "description", content: "Shoot splinters at a living table in a giant living room. Every hit shrinks it." },
      { property: "og:title", content: "Table Wars — First-Person Splinter Shooter" },
      { property: "og:description", content: "Shoot splinters at a living table in a giant living room. Every hit shrinks it." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Game,
});
