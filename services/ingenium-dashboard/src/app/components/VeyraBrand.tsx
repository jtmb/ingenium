import Image from "next/image";

/** Product identity only; service, database and upstream identifiers stay stable. */
export default function VeyraBrand() {
  return <span className="veyra-brand inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
    <Image src="/veyra-blue.png" alt="" width={26} height={26} priority />
    <span>Veyra</span>
  </span>;
}
