import { onboardingApi } from "../../api";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { useResource } from "../../hooks/useResource";
import { cx } from "../../lib/cx";
import { paths } from "../../router";
import { percentComplete } from "./derive";

/** "Onboarding 44%" in a building's header when it has an onboarding project; links to the project. */
export function OnboardingChip({ propertyId, refreshKey }: { propertyId: string; refreshKey: number }) {
  const summary = useResource(`onboarding-summary:${propertyId}`, () => onboardingApi.summary(propertyId), refreshKey);
  const project = summary.data;
  if (!project) return null;
  const closed = project.closeout === "closed";
  const pct = percentComplete(project.counts);
  return (
    <Link
      href={paths.onboardingProject(propertyId)}
      title={`${project.name}: ${pct}% of the onboarding tasks done`}
      className={cx(
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] leading-4 font-medium ring-1 ring-inset transition-colors",
        closed ? "bg-emerald-50 text-emerald-800 ring-emerald-200 hover:ring-emerald-400" : "bg-surface text-ink ring-ink/70 hover:bg-subtle hover:ring-ink",
      )}
    >
      <Icon name="clipboard" className="size-3" />
      {closed ? "Onboarding closed" : `Onboarding ${pct}%`}
    </Link>
  );
}
