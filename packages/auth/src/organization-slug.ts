export const ORGANIZATION_SLUG_MIN_LENGTH = 4;

const RESERVED_ROOT_SLUGS = new Set([
  "about",
  "account",
  "admin",
  "agents",
  "assets",
  "asks",
  "auth",
  "billing",
  "blog",
  "brand",
  "careers",
  "changelog",
  "community",
  "contact",
  "create",
  "customers",
  "dashboard",
  "developers",
  "docs",
  "download",
  "enterprise",
  "features",
  "health",
  "help",
  "home",
  "insights",
  "integrations",
  "invite",
  "join",
  "legal",
  "login",
  "logout",
  "method",
  "mobile",
  "now",
  "oauth",
  "onboarding",
  "org",
  "organization",
  "organizations",
  "orgs",
  "partners",
  "press",
  "pricing",
  "privacy",
  "product",
  "profile",
  "quality",
  "register",
  "releases",
  "resources",
  "roadmap",
  "search",
  "security",
  "settings",
  "signin",
  "signup",
  "solutions",
  "startups",
  "status",
  "support",
  "switch",
  "team",
  "teams",
  "terms",
  "webhooks",
  "workspace",
  "workspaces",
]);

export function organizationSlugIssue(slug: string | undefined): string | null {
  if (!slug || slug.length < ORGANIZATION_SLUG_MIN_LENGTH) {
    return `Organization URL must be at least ${ORGANIZATION_SLUG_MIN_LENGTH} characters.`;
  }
  if (RESERVED_ROOT_SLUGS.has(slug.toLowerCase())) {
    return "That organization URL is reserved.";
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return "Use lowercase letters, numbers, and single hyphens only.";
  }
  return null;
}
