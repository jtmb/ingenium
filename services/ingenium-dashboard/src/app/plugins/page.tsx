"use client";
import { useState, useEffect } from "react";
import { api, Plugin } from "../../lib/api";

/**
 * Plugin management page.
 * Lists all registered plugins with their file paths and an enable/disable toggle.
 */
export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);

  useEffect(() => { api.plugins.list().then((r) => setPlugins(r.data)).catch(() => {}); }, []);

  /** Toggles a plugin's enabled state, optimistically updating the UI. */
  const toggle = async (p: Plugin) => {
    if (p.enabled) {
      await api.plugins.disable(p.name);
    } else {
      await api.plugins.enable(p.name);
    }
    setPlugins(plugins.map((x) => x.id === p.id ? { ...x, enabled: !x.enabled } : x));
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Plugins</h1>
      <div className="space-y-2">
        {plugins.map((p) => (
          <div key={p.id} className="bg-white p-4 rounded border flex items-center justify-between">
            <div>
              <span className="font-medium">{p.name}</span>
              <span className="text-sm text-gray-500 ml-2">{p.file_path}</span>
            </div>
            <button onClick={() => toggle(p)} className={`px-3 py-1 rounded text-sm ${
              p.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
            }`}>
              {p.enabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
