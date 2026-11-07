// The hub-wide directories behind onboarding: management companies (outgoing managers' firms) and the
// outgoing strata managers themselves. Lists, plus the "Add company" and "Add outgoing manager" dialogs
// that the dashboard links to directly.

import { useEffect, useState, type FormEvent } from "react";
import type { ManagementCompany, OutgoingManagerContact } from "../../../shared/onboarding";
import { onboardingApi } from "../../api";
import { Button } from "../../components/Button";
import { Card, PageHeader } from "../../components/Card";
import { EmptyState, ErrorState, FormError } from "../../components/EmptyState";
import { SelectField, TextAreaField, TextField } from "../../components/Field";
import { Modal } from "../../components/Modal";
import { SkeletonList } from "../../components/Skeleton";
import { TabNav } from "../../components/Tabs";
import { useToast } from "../../components/Toast";
import { useResource } from "../../hooks/useResource";
import { formatDate, plural } from "../../lib/format";
import { paths, type OnboardingDirectory } from "../../router";
import { ActingAs, Crumbs, SampleLabel } from "./ui";

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export function AddCompanyModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (company: ManagementCompany) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", abn: "", phone: "", email: "", website: "", address: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setForm({ name: "", abn: "", phone: "", email: "", website: "", address: "", notes: "" });
    setError(null);
  }, [open]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const abnDigits = form.abn.replace(/\s+/g, "");
    if (abnDigits && !/^\d{11}$/.test(abnDigits)) {
      setError(new Error("The ABN must be 11 digits."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const blank = (v: string) => v.trim() || null;
      const company = await onboardingApi.addCompany({
        name: form.name.trim(),
        abn: blank(form.abn),
        phone: blank(form.phone),
        email: blank(form.email),
        website: blank(form.website),
        address: blank(form.address),
        notes: blank(form.notes),
      });
      toast.success("Company added", company.name);
      onSaved(company);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Add company"
      description="A strata management firm Ikon takes schemes over from."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-company-form" loading={busy}>
            Add company
          </Button>
        </>
      }
    >
      <form id="add-company-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <TextField label="Company name" value={form.name} onChange={set("name")} required fieldClassName="sm:col-span-2" autoComplete="organization" />
        <TextField label="ABN" value={form.abn} onChange={set("abn")} inputMode="numeric" hint="11 digits" autoComplete="off" />
        <TextField label="Phone" type="tel" value={form.phone} onChange={set("phone")} autoComplete="off" />
        <TextField label="Email" type="email" value={form.email} onChange={set("email")} autoComplete="off" />
        <TextField label="Website" value={form.website} onChange={set("website")} placeholder="https://" autoComplete="off" />
        <TextField label="Address" value={form.address} onChange={set("address")} fieldClassName="sm:col-span-2" autoComplete="off" />
        <TextAreaField label="Notes" value={form.notes} onChange={set("notes")} rows={3} fieldClassName="sm:col-span-2" />
        <div className="sm:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </Modal>
  );
}

export function AddOutgoingManagerModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (manager: OutgoingManagerContact) => void;
}) {
  const toast = useToast();
  const companies = useResource(open ? "directory:companies" : null, onboardingApi.companies);
  const [form, setForm] = useState({ companyId: "", name: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setForm({ companyId: "", name: "", email: "", phone: "" });
    setError(null);
  }, [open]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const manager = await onboardingApi.addOutgoingManager({
        companyId: form.companyId || null,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
      });
      toast.success("Outgoing manager added", manager.name);
      onSaved(manager);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Add outgoing manager"
      description="The strata manager handing a scheme over to Ikon."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-manager-form" loading={busy}>
            Add manager
          </Button>
        </>
      }
    >
      <form id="add-manager-form" onSubmit={save} className="space-y-4">
        <SelectField label="Company" value={form.companyId} onChange={set("companyId")} disabled={companies.loading} hint="Not listed? Add the company first.">
          <option value="">{companies.loading ? "Loading companies…" : "No company"}</option>
          {(companies.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.sample ? " (SAMPLE)" : ""}
            </option>
          ))}
        </SelectField>
        <TextField label="Name" value={form.name} onChange={set("name")} required autoComplete="off" />
        <TextField label="Email" type="email" value={form.email} onChange={set("email")} required autoComplete="off" />
        <TextField label="Phone" type="tel" value={form.phone} onChange={set("phone")} autoComplete="off" />
        <FormError error={error} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The directory pages
// ---------------------------------------------------------------------------

function CompaniesList({ companies, managers }: { companies: ManagementCompany[]; managers: OutgoingManagerContact[] }) {
  if (companies.length === 0) {
    return <EmptyState icon="building" title="No companies yet" description="Add the firms Ikon takes schemes over from." />;
  }
  return (
    <ul className="divide-y divide-line">
      {companies.map((c) => {
        const people = managers.filter((m) => m.companyId === c.id);
        return (
          <li key={c.id} className="grid gap-x-6 gap-y-2 px-5 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                {c.name}
                <SampleLabel sample={c.sample} />
              </p>
              <p className="mt-0.5 text-xs text-muted">{c.abn ? `ABN ${c.abn}` : "ABN not recorded"}</p>
              {c.notes ? <p className="mt-1 text-xs text-ink-soft">{c.notes}</p> : null}
            </div>
            <dl className="min-w-0 space-y-0.5 text-[13px] text-ink-soft">
              {c.phone ? (
                <div>
                  <dt className="sr-only">Phone</dt>
                  <dd>{c.phone}</dd>
                </div>
              ) : null}
              {c.email ? (
                <div>
                  <dt className="sr-only">Email</dt>
                  <dd className="[overflow-wrap:anywhere]">
                    <a href={`mailto:${c.email}`} className="link-brand">
                      {c.email}
                    </a>
                  </dd>
                </div>
              ) : null}
              {c.website ? (
                <div>
                  <dt className="sr-only">Website</dt>
                  <dd className="[overflow-wrap:anywhere]">{c.website.replace(/^https?:\/\//, "")}</dd>
                </div>
              ) : null}
              {c.address ? (
                <div>
                  <dt className="sr-only">Address</dt>
                  <dd>{c.address}</dd>
                </div>
              ) : null}
            </dl>
            <div className="min-w-0 text-[13px] text-ink-soft">
              <p className="text-xs text-muted">{plural(people.length, "outgoing manager")}</p>
              {people.length ? <p className="mt-0.5">{people.map((p) => p.name).join(", ")}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ManagersList({ companies, managers }: { companies: ManagementCompany[]; managers: OutgoingManagerContact[] }) {
  if (managers.length === 0) {
    return <EmptyState icon="users" title="No outgoing managers yet" description="Add the strata managers handing schemes over to Ikon." />;
  }
  const companyName = (id: string | null) => companies.find((c) => c.id === id)?.name ?? "No company";
  return (
    <ul className="divide-y divide-line">
      {managers.map((m) => (
        <li key={m.id} className="grid gap-x-6 gap-y-1 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
              {m.name}
              <SampleLabel sample={m.sample} />
            </p>
            <p className="mt-0.5 text-xs text-muted">Added {formatDate(m.createdAt)}</p>
          </div>
          <p className="min-w-0 text-[13px] text-ink-soft">{companyName(m.companyId)}</p>
          <div className="min-w-0 text-[13px] text-ink-soft">
            <p className="[overflow-wrap:anywhere]">
              <a href={`mailto:${m.email}`} className="link-brand">
                {m.email}
              </a>
            </p>
            {m.phone ? <p>{m.phone}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DirectoryPage({ directory }: { directory: OnboardingDirectory }) {
  const companies = useResource("directory:companies", onboardingApi.companies);
  const managers = useResource("directory:outgoing-managers", onboardingApi.outgoingManagers);
  const [adding, setAdding] = useState<OnboardingDirectory | null>(null);
  const isCompanies = directory === "companies";

  useEffect(() => {
    document.title = `${isCompanies ? "Management company directory" : "Outgoing manager directory"} · IKON SM Command Hub`;
  }, [isCompanies]);

  const loading = companies.loading || managers.loading;
  const error = companies.error ?? managers.error;

  return (
    <>
      <Crumbs items={[{ label: "Portfolio", href: paths.portfolio() }, { label: "Onboarding", href: paths.onboarding() }, { label: "Directory" }]} />
      <PageHeader
        title={isCompanies ? "Management company directory" : "Outgoing manager directory"}
        description={
          isCompanies
            ? "Strata management firms Ikon takes schemes over from. Their outgoing managers receive the handover letter and the secure upload link."
            : "The outgoing strata managers who supply the handover documents. Pick one when preparing a handover draft."
        }
        actions={
          <>
            <ActingAs />
            <Button variant="primary" icon="plus" onClick={() => setAdding(directory)}>
              {isCompanies ? "Add company" : "Add outgoing manager"}
            </Button>
          </>
        }
      />
      <div className="mb-5">
        <TabNav
          label="Directories"
          active={directory}
          items={[
            { key: "companies", label: "Companies", icon: "building", href: paths.onboardingDirectory("companies") },
            { key: "outgoing-managers", label: "Outgoing managers", icon: "users", href: paths.onboardingDirectory("outgoing-managers") },
          ]}
        />
      </div>
      <Card>
        {loading ? (
          <SkeletonList rows={4} />
        ) : error ? (
          <ErrorState
            error={error}
            onRetry={() => {
              void companies.reload();
              void managers.reload();
            }}
            title="Couldn't load the directory"
          />
        ) : isCompanies ? (
          <CompaniesList companies={companies.data ?? []} managers={managers.data ?? []} />
        ) : (
          <ManagersList companies={companies.data ?? []} managers={managers.data ?? []} />
        )}
      </Card>
      <AddCompanyModal
        open={adding === "companies"}
        onClose={() => setAdding(null)}
        onSaved={(company) => {
          setAdding(null);
          companies.mutate((list = []) => [...list, company]);
          void companies.reload();
        }}
      />
      <AddOutgoingManagerModal
        open={adding === "outgoing-managers"}
        onClose={() => setAdding(null)}
        onSaved={(manager) => {
          setAdding(null);
          managers.mutate((list = []) => [...list, manager]);
          void managers.reload();
        }}
      />
    </>
  );
}
