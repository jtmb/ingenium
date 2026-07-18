import type { SettingsTab } from "./tabs";
import { TabIcon } from "./SettingsSidebar";

interface PlaceholderPanelProps {
  tab?: SettingsTab;
}

/**
 * Fallback panel shown when a settings tab has no dedicated panel component
 * registered in TAB_PANELS inside SettingsOverlay. Keeps the sidebar consistent
 * even for unimplemented sections.
 */
export default function PlaceholderPanel({ tab }: PlaceholderPanelProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
      {tab && <TabIcon icon={tab.icon} className="w-10 h-10 text-[var(--color-text-muted)]" />}
      <p className="text-sm text-[var(--color-text-muted)]">
        {tab ? `No settings for ${tab.label} yet` : "No settings available yet"}
      </p>
    </div>
  );
}
