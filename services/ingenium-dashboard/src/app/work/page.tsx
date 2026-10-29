import WorkRuntime from "../components/veyra-work/WorkRuntime";
import { parseWorkRouteParams } from "../components/veyra-work/work-navigation";

export default async function WorkPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <WorkRuntime {...parseWorkRouteParams(await searchParams)} />;
}
