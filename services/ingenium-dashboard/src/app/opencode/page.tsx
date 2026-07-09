export const dynamic = "force-dynamic";

export default function OpenCodePage() {
  const pass = process.env.OPENCODE_SERVER_PASSWORD ?? "";
  const iframeUrl = pass
    ? `http://user:${encodeURIComponent(pass)}@localhost:4096/`
    : "http://localhost:4096/";

  return (
    <div className="h-[calc(100vh-64px)] -mx-6">
      <iframe
        src={iframeUrl}
        className="w-full h-full border-0"
        title="OpenCode"
        allow="clipboard-write"
      />
    </div>
  );
}
