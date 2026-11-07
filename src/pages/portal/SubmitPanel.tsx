// "Submit handover pack": tells Ikon the pack is ready to review (with an optional message). The link
// keeps working afterwards for late documents, until it expires.

import { useRef, useState } from "react";
import type { PortalView } from "../../../shared/onboarding";
import { countOf, formatPortalDate } from "../../../shared/portal-upload";
import { portalApi } from "../../api";
import { Button } from "../../components/Button";
import { Card, CardHeader } from "../../components/Card";
import { FormError } from "../../components/EmptyState";
import { TextAreaField } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { formatPerthDateTime } from "./labels";

export function SubmitPanel({
  token,
  view,
  uploading,
  onSubmitted,
  onFailure,
}: {
  token: string;
  view: PortalView;
  /** Files are still uploading (or waiting for the connection): submitting now would miss them. */
  uploading: boolean;
  onSubmitted: (view: PortalView) => void;
  onFailure: (err: unknown) => boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const { progress } = view;
  const supplied = progress.total - progress.outstanding;
  const submitted = view.submittedAt !== null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await portalApi.submit(token, message.trim() || null);
      setOpen(false);
      setMessage("");
      onSubmitted(next);
      toast.success("Handover pack submitted", `${view.incomingManager.name} has been told it's ready to review.`);
      window.requestAnimationFrame(() => doneRef.current?.focus());
    } catch (err) {
      if (!onFailure(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <section aria-labelledby="portal-submit-title">
        <CardHeader
          title={<span id="portal-submit-title">Submit the handover pack</span>}
          description={`When you've uploaded what you can, submit the pack so Ikon knows it's ready to review. You can still upload late documents afterwards, until this link expires on ${formatPortalDate(view.expiresAt)}.`}
        />
        <div className="space-y-4 px-5 py-5 sm:px-6">
          {submitted ? (
            <div
              ref={doneRef}
              tabIndex={-1}
              className="flex items-start gap-3 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-900 focus:outline-none"
            >
              <Icon name="approve" className="mt-0.5 size-5 shrink-0 text-emerald-700" />
              <p>
                <span className="font-semibold">Submitted {formatPerthDateTime(view.submittedAt)} (Perth time).</span> Thank you.{" "}
                {view.incomingManager.name} will review the pack and contact you about anything else Ikon needs. If you upload more documents,
                submit again so Ikon knows.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-ink-soft">
              <span className="font-semibold text-ink">
                {supplied} of {progress.total}
              </span>{" "}
              requested documents supplied or marked not applicable.
              {progress.outstanding ? ` ${countOf(progress.outstanding, "document is", "documents are")} still needed.` : ""}
            </p>
            <Button variant={submitted ? "secondary" : "primary"} size="lg" icon="send" onClick={() => setOpen(true)} disabled={uploading}>
              {submitted ? "Submit again" : "Submit handover pack"}
            </Button>
          </div>
          {uploading ? <p className="text-[13px] text-muted">You can submit once your uploads have finished.</p> : null}
        </div>
      </section>

      <Modal
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        title={submitted ? "Submit again?" : "Submit the handover pack?"}
        description={`SP ${view.building.spNumber}, ${view.building.street}, ${view.building.suburb}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon="send" loading={busy} onClick={submit}>
              Submit
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm leading-relaxed text-ink-soft">
          <p>
            Ikon will be told the pack is ready to review: {supplied} of {progress.total} requested documents supplied or marked not applicable.
          </p>
          {progress.outstanding ? (
            <p className="flex items-start gap-2 border border-line-strong bg-subtle px-3 py-2.5">
              <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-taupe" />
              <span>
                {countOf(progress.outstanding, "requested document is", "requested documents are")} still needed. You can submit now and upload the
                rest later, until {formatPortalDate(view.expiresAt)}.
              </span>
            </p>
          ) : null}
          <TextAreaField
            label="Message to Ikon (optional)"
            hint="For example, when the remaining documents will follow."
            rows={3}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <FormError error={error} />
        </div>
      </Modal>
    </Card>
  );
}
