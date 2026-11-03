import { useMemo, useState, type FormEvent } from "react";
import type { Contact, ContactRole } from "../../../shared/types";
import { api, type ContactInput } from "../../api";
import { Badge } from "../../components/Badge";
import { Button, IconButton } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, ErrorState, FormError } from "../../components/EmptyState";
import { CheckboxField, SelectField, TextAreaField, TextField, inputClasses } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { ConfirmDialog, Modal } from "../../components/Modal";
import { SkeletonList } from "../../components/Skeleton";
import { SampleBadge } from "../../components/StatusBadges";
import { useToast } from "../../components/Toast";
import { useResource } from "../../hooks/useResource";
import { useBuilding } from "./BuildingContext";

const ROLE_ORDER: ContactRole[] = ["owner", "tenant", "property_manager", "council", "contractor", "insurer", "staff", "other"];

const ROLE_LABELS: Record<ContactRole, { single: string; group: string }> = {
  owner: { single: "Owner", group: "Owners" },
  tenant: { single: "Tenant", group: "Tenants" },
  property_manager: { single: "Property manager", group: "Property managers" },
  council: { single: "Council member", group: "Council" },
  contractor: { single: "Contractor", group: "Contractors" },
  insurer: { single: "Insurer", group: "Insurers" },
  staff: { single: "Ikon staff", group: "Ikon staff" },
  other: { single: "Other", group: "Other" },
};

function matches(contact: Contact, query: string): boolean {
  if (!query) return true;
  const haystack = [contact.name, contact.lot, contact.email, contact.phone, contact.trade, contact.notes].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function sortContacts(a: Contact, b: Contact): number {
  const lotA = Number.parseInt(a.lot ?? "", 10);
  const lotB = Number.parseInt(b.lot ?? "", 10);
  if (!Number.isNaN(lotA) && !Number.isNaN(lotB) && lotA !== lotB) return lotA - lotB;
  return a.name.localeCompare(b.name);
}

// ---------------------------------------------------------------------------

type FormState = Omit<ContactInput, "lot" | "email" | "phone" | "trade" | "notes"> & {
  lot: string;
  email: string;
  phone: string;
  trade: string;
  notes: string;
};

function toForm(contact: Contact | null): FormState {
  return {
    role: contact?.role ?? "owner",
    name: contact?.name ?? "",
    lot: contact?.lot ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    trade: contact?.trade ?? "",
    afterHours: contact?.afterHours ?? false,
    notes: contact?.notes ?? "",
    sample: contact?.sample ?? false,
  };
}

function toInput(form: FormState): ContactInput {
  const optional = (value: string) => value.trim() || null;
  return {
    role: form.role,
    name: form.name.trim(),
    lot: optional(form.lot),
    email: optional(form.email),
    phone: optional(form.phone),
    trade: form.role === "contractor" ? optional(form.trade) : null,
    afterHours: form.afterHours,
    notes: optional(form.notes),
    sample: form.sample,
  };
}

function ContactFormModal({
  open,
  contact,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = new contact */
  contact: Contact | null;
  onClose: () => void;
  onSaved: (contact: Contact) => void;
}) {
  const { propertyId } = useBuilding();
  const [form, setForm] = useState<FormState>(() => toForm(contact));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [openedFor, setOpenedFor] = useState<Contact | null | undefined>(undefined);

  // Reset the form each time the dialog opens for a (different) contact.
  if (open && openedFor !== contact) {
    setOpenedFor(contact);
    setForm(toForm(contact));
    setError(null);
  }
  if (!open && openedFor !== undefined) setOpenedFor(undefined);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = toInput(form);
      const saved = contact ? await api.updateContact(propertyId, contact.id, input) : await api.createContact(propertyId, input);
      onSaved(saved);
      onClose();
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
      title={contact ? `Edit ${contact.name}` : "Add contact"}
      description="Approved emails can only go to a thread's sender or a contact saved here."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="contact-form" variant="primary" icon="check" loading={busy}>
            {contact ? "Save changes" : "Add contact"}
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Role" value={form.role} onChange={(e) => set("role", e.target.value as ContactRole)}>
            {ROLE_ORDER.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role].single}
              </option>
            ))}
          </SelectField>
          <TextField label="Name" required maxLength={200} value={form.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" />
          <TextField label="Email" type="email" maxLength={254} value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="off" />
          <TextField label="Phone" type="tel" maxLength={50} value={form.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="off" />
          <TextField label="Lot" maxLength={50} value={form.lot} onChange={(e) => set("lot", e.target.value)} placeholder="e.g. 4" />
          {form.role === "contractor" ? (
            <TextField label="Trade" maxLength={100} value={form.trade} onChange={(e) => set("trade", e.target.value)} placeholder="plumber, electrician, locksmith…" />
          ) : null}
        </div>
        <CheckboxField
          label="Available after hours"
          hint="After-hours contractors are preferred for P1 emergencies."
          checked={form.afterHours}
          onChange={(e) => set("afterHours", e.target.checked)}
        />
        <TextAreaField label="Notes" rows={3} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        {form.sample ? (
          <p className="text-xs text-amber-800">This is a SAMPLE contact. Replace its details with the real person's before relying on it.</p>
        ) : null}
        <FormError error={error} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function ContactTable({ role, contacts, onEdit, onDelete }: { role: ContactRole; contacts: Contact[]; onEdit: (c: Contact) => void; onDelete: (c: Contact) => void }) {
  const showTrade = role === "contractor";
  const showLot = role === "owner" || role === "tenant" || role === "council" || role === "property_manager";
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h3 className="text-sm font-semibold text-ink">{ROLE_LABELS[role].group}</h3>
        <Badge tone="neutral">{contacts.length}</Badge>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="bg-subtle text-xs text-muted">
            <tr>
              <th scope="col" className="px-5 py-2 font-medium">Name</th>
              {showLot ? <th scope="col" className="px-3 py-2 font-medium">Lot</th> : null}
              {showTrade ? <th scope="col" className="px-3 py-2 font-medium">Trade</th> : null}
              <th scope="col" className="px-3 py-2 font-medium">Email</th>
              <th scope="col" className="px-3 py-2 font-medium">Phone</th>
              <th scope="col" className="px-3 py-2 font-medium">Notes</th>
              <th scope="col" className="px-5 py-2 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {contacts.map((c) => (
              <tr key={c.id} className="align-top hover:bg-subtle/60">
                <td className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-ink">{c.name}</span>
                    {c.sample ? <SampleBadge /> : null}
                    {c.afterHours ? (
                      <Badge tone="accent" icon="clock">
                        24/7
                      </Badge>
                    ) : null}
                  </div>
                </td>
                {showLot ? <td className="px-3 py-3 text-ink-soft">{c.lot ?? "-"}</td> : null}
                {showTrade ? <td className="px-3 py-3 text-ink-soft capitalize">{c.trade ?? "-"}</td> : null}
                <td className="px-3 py-3">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="break-all text-ink-soft hover:text-accent hover:underline">
                      {c.email}
                    </a>
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {c.phone ? (
                    <a href={`tel:${c.phone.replace(/\s+/g, "")}`} className="text-ink-soft hover:text-accent hover:underline">
                      {c.phone}
                    </a>
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td className="max-w-[280px] px-3 py-3 text-muted">{c.notes ?? ""}</td>
                <td className="px-5 py-2.5">
                  <div className="flex justify-end gap-0.5">
                    <IconButton icon="pencil" label={`Edit ${c.name}`} onClick={() => onEdit(c)} />
                    <IconButton icon="trash" label={`Delete ${c.name}`} variant="dangerGhost" onClick={() => onDelete(c)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function ContactsTab() {
  const { propertyId, refreshKey, reloadOverview } = useBuilding();
  const toast = useToast();
  const contacts = useResource(`contacts:${propertyId}`, () => api.contacts(propertyId), refreshKey);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Contact | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  const groups = useMemo(() => {
    const filtered = (contacts.data ?? []).filter((c) => matches(c, query.trim()));
    return ROLE_ORDER.map((role) => ({ role, list: filtered.filter((c) => c.role === role).sort(sortContacts) })).filter((g) => g.list.length);
  }, [contacts.data, query]);

  const onSaved = (saved: Contact) => {
    contacts.mutate((list = []) => (list.some((c) => c.id === saved.id) ? list.map((c) => (c.id === saved.id ? saved : c)) : [...list, saved]));
    toast.success(editing ? "Contact updated" : "Contact added", saved.name);
    void reloadOverview();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    await api.deleteContact(propertyId, deleting.id);
    contacts.mutate((list = []) => list.filter((c) => c.id !== deleting.id));
    toast.success("Contact deleted", deleting.name);
    void reloadOverview();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <label htmlFor="contact-filter" className="sr-only">
            Filter contacts
          </label>
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            id="contact-filter"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, lot, trade…"
            className={inputClasses("pl-9!")}
          />
        </div>
        <Button variant="primary" icon="plus" onClick={() => setEditing(null)}>
          Add contact
        </Button>
      </div>

      {contacts.loading ? (
        <Card>
          <SkeletonList rows={6} />
        </Card>
      ) : contacts.error ? (
        <Card>
          <ErrorState error={contacts.error} onRetry={contacts.reload} title="Couldn't load contacts" />
        </Card>
      ) : groups.length ? (
        groups.map(({ role, list }) => (
          <ContactTable key={role} role={role} contacts={list} onEdit={setEditing} onDelete={setDeleting} />
        ))
      ) : (
        <Card>
          <EmptyState
            icon="users"
            title={query ? "No contacts match" : "No contacts yet"}
            description={query ? "Try a different search." : "Add owners, council members, contractors and the insurer so the agent can route work and replies."}
          />
        </Card>
      )}

      <ContactFormModal open={editing !== undefined} contact={editing ?? null} onClose={() => setEditing(undefined)} onSaved={onSaved} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete this contact?"
        description={
          <>
            <span className="font-medium text-ink">{deleting?.name}</span> will be removed from this building. The agent will no longer route work or
            approved emails to them.
          </>
        }
        confirmLabel="Delete contact"
      />
    </div>
  );
}
