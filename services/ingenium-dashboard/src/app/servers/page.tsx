"use client";
import { useState, useEffect } from "react";
import { api, Server } from "../../lib/api";

/**
 * MCP server configuration page.
 * Lists configured servers with their command and running status.
 * A form allows adding new server configurations.
 */
export default function ServersPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");

  useEffect(() => { api.servers.list().then((r) => setServers(r.data)).catch(() => {}); }, []);

  /** Creates a new server entry and prepends it to the list. */
  const create = async () => {
    if (!name || !command) return;
    const res = await api.servers.create(name, command);
    setServers([res.data, ...servers]);
    setName("");
    setCommand("");
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">MCP Servers</h1>
      <div className="bg-white p-4 rounded border space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Server name" className="border p-2 rounded w-full" />
        <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Command (e.g. kaban mcp)" className="border p-2 rounded w-full" />
        <button onClick={create} className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700">Add Server</button>
      </div>
      <div className="space-y-2">
        {servers.map((s) => (
          <div key={s.id} className="bg-white p-4 rounded border flex items-center justify-between">
            <div>
              <span className="font-medium">{s.name}</span>
              <span className="text-sm text-gray-500 ml-2">{s.command}</span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded ${
              s.running ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
            }`}>{s.running ? "Running" : "Stopped"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
