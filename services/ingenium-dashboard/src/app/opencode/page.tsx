export default function OpenCodePage() {
  return (
    <div className="fixed inset-0 top-[57px]">
      <iframe
        src="http://localhost:4098/"
        className="w-full h-full border-0"
        title="OpenCode"
        allow="clipboard-write"
      />
    </div>
  );
}
