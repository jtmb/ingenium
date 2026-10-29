import WorkRuntime from "../components/veyra-work/WorkRuntime";

export default async function WorkPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <WorkRuntime initialSessionId={typeof params.session === "string" ? params.session : null}
    requestedRuntime={typeof params.runtime === "string" ? params.runtime : null}
    requestedProject={typeof params.project === "string" ? params.project : null} />;
}
