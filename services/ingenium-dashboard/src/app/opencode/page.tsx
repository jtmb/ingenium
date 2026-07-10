export default function OpenCodePage() {
  return (
    <div className="h-[calc(100vh-64px)] -mx-6">
      <iframe
        src="http://localhost:4098/"
        className="w-full h-full border-0"
        title="OpenCode"
        allow="clipboard-write"
      />
    </div>
  );
}
