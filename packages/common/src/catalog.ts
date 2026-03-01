import type { FestivalClass } from "./domain.js";

export const FESTIVAL_CLASS_CATALOG: FestivalClass[] = [
  {
    id: "solo-piano",
    title: "Solo Piano",
    classType: "solo",
    priceCents: 9000,
    minParticipants: 1,
    shopifyVariantId: "gid://shopify/ProductVariant/solo-piano"
  },
  {
    id: "concert-showcase",
    title: "Concert Showcase",
    classType: "concert",
    priceCents: 15000,
    minParticipants: 1,
    shopifyVariantId: "gid://shopify/ProductVariant/concert-showcase"
  },
  {
    id: "ensemble-jazz",
    title: "Ensemble Jazz",
    classType: "ensemble",
    priceCents: 12000,
    minParticipants: 2,
    shopifyVariantId: "gid://shopify/ProductVariant/ensemble-jazz"
  },
  {
    id: "theory-lab",
    title: "Theory Lab",
    classType: "general",
    priceCents: 6000,
    minParticipants: 1,
    shopifyVariantId: "gid://shopify/ProductVariant/theory-lab"
  }
];
