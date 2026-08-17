import { routes } from "@/lib/config/links";

/**
 * Navigation model.
 *
 * Order reflects the funnel: doers first (Bridge, Activity), verifiers next
 * (Explorer, Status), with the remaining trust content behind "More" so the
 * header stays legible.
 */

export interface NavItem {
  readonly label: string;
  readonly href: string;
}

export const primaryNav: readonly NavItem[] = [
  { label: "Bridge", href: routes.bridge },
  { label: "Activity", href: routes.activity },
  { label: "Explorer", href: routes.explorer },
  { label: "Status", href: routes.status },
];

export const moreNav: readonly NavItem[] = [
  { label: "Reserves", href: routes.reserves },
  { label: "Fees & limits", href: routes.fees },
  { label: "Security", href: routes.security },
  { label: "Verify an address", href: routes.verify },
  { label: "Wallets", href: routes.wallets },
  { label: "FAQ", href: routes.faq },
  { label: "Glossary", href: routes.glossary },
  { label: "Support", href: routes.support },
];

export const footerNav: readonly {
  readonly heading: string;
  readonly items: readonly NavItem[];
}[] = [
  {
    heading: "Product",
    items: [
      { label: "Bridge", href: routes.bridge },
      { label: "Activity", href: routes.activity },
      { label: "Fees & limits", href: routes.fees },
      { label: "Wallets", href: routes.wallets },
    ],
  },
  {
    heading: "Transparency",
    items: [
      { label: "Explorer", href: routes.explorer },
      { label: "Reserves", href: routes.reserves },
      { label: "Status", href: routes.status },
    ],
  },
  {
    heading: "Learn",
    items: [
      { label: "Security model", href: routes.security },
      { label: "Verify an address", href: routes.verify },
      { label: "FAQ", href: routes.faq },
      { label: "Glossary", href: routes.glossary },
    ],
  },
  {
    heading: "Legal",
    items: [
      { label: "Terms", href: routes.terms },
      { label: "Privacy", href: routes.privacy },
      { label: "Support", href: routes.support },
    ],
  },
];
