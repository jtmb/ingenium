export const dynamic = "force-dynamic";

/**
 * Custom 404 page — shown for any unmatched App Router route.
 * `force-dynamic` ensures the error is not cached at build time.
 */
export default function NotFound() {
  return (
    <div className="text-center py-20">
      <h1 className="text-4xl font-bold text-[var(--color-text-muted)]">404</h1>
      <p className="text-[var(--color-text-muted)] mt-2">Page not found</p>
    </div>
  );
}
