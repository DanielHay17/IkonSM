import { useState, type FormEvent } from "react";
import type { SessionInfo } from "../../shared/types";
import { api } from "../api";
import { Button } from "../components/Button";
import { FormError } from "../components/EmptyState";
import { TextField } from "../components/Field";
import { Icon } from "../components/Icon";
import { LogoMark } from "../components/Wordmark";

const NAME_KEY = "ikon.staffName";

function rememberedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage can be unavailable (private mode); the name is just a convenience.
  }
}

export function LoginPage({ onSignedIn, companyName }: { onSignedIn: (session: SessionInfo) => void; companyName: string }) {
  const [name, setName] = useState(rememberedName);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(passcode, name.trim());
      rememberName(name.trim());
      onSignedIn(session);
    } catch (err) {
      setError(err);
      setPasscode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="size-11" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Ikon Command Hub</h1>
          <p className="mt-1.5 text-sm text-muted">{companyName} · one AI agent per strata scheme</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card">
          <TextField
            label="Your name"
            hint="Shown on approvals and in each building's activity log."
            required
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={!name}
          />
          <TextField
            label="Passcode"
            type="password"
            required
            autoComplete="current-password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoFocus={!!name}
          />
          <FormError error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!name.trim() || !passcode}>
            Sign in
          </Button>
        </form>

        <p className="mt-6 flex items-start justify-center gap-2 text-center text-xs text-muted">
          <Icon name="lock" className="mt-px size-3.5" />
          <span>Nothing leaves a building's agent without a staff member's approval.</span>
        </p>
      </div>
    </div>
  );
}
