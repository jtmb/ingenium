import type { SettingsTab } from "./tabs";
import { TabIcon } from "./SettingsSidebar";

interface PlaceholderPanelProps {
  tab: SettingsTab;
}

export default function PlaceholderPanel({ tab }: PlaceholderPanelProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
      <TabIcon icon={tab.icon} className="w-10 h-10 text-[var(--color-text-muted)]" />
      <p className="text-sm text-[var(--color-text-muted)]">
        No settings for {tab.label} yet
      </p>
    </div>
  );
}
