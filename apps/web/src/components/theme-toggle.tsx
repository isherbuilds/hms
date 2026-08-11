import { SidebarMenuButton } from "@hms/ui/components/sidebar";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const ORDER = ["light", "dark", "system"] as const;
const LABEL = { light: "Light", dark: "Dark", system: "System" } as const;
const ICON = { light: SunIcon, dark: MoonIcon, system: MonitorIcon };

/**
 * Light → dark → system, in the sidebar footer. Rendered as a stable
 * placeholder until mounted: the resolved theme is only known on the client,
 * and swapping the icon during hydration would mismatch the server's markup.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const current = (mounted && theme && theme in LABEL ? theme : "system") as keyof typeof LABEL;
  const Icon = ICON[current];

  return (
    <SidebarMenuButton
      tooltip={`Theme: ${LABEL[current]}`}
      onClick={() => setTheme(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length])}
    >
      <Icon />
      <span>{LABEL[current]}</span>
    </SidebarMenuButton>
  );
}
