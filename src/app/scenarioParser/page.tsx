import { redirect } from "next/navigation";

// The former XML parser demo used an obsolete, unvalidated scenario format.
export default function ScenarioParser() {
  redirect("/scenario");
}
