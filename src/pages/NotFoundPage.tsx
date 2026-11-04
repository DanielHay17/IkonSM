import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Link } from "../components/Link";
import { paths } from "../router";

export function NotFoundPage({ path }: { path: string }) {
  return (
    <Card>
      <EmptyState
        icon="search"
        title="Page not found"
        description={<span className="text-xs [overflow-wrap:anywhere]">{path}</span>}
        action={
          <Link href={paths.portfolio()} className="text-sm font-medium link-brand">
            Back to the portfolio
          </Link>
        }
      />
    </Card>
  );
}
