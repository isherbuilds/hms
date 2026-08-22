import { SidebarMenuButton } from "@hms/ui/components/sidebar";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

const ORDER = ["light", "dark", "system"] as const;
const LABEL = { light: "Light", dark: "Dark", system: "System" } as const;
const ICON = { light: SunIcon, dark: MoonIcon, system: MonitorIcon };

/** Light → dark → system, in the client-only sidebar footer. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = (theme && theme in LABEL ? theme : "system") as keyof typeof LABEL;
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
