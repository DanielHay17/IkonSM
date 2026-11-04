import { useState, type FormEvent } from "react";
import type { SessionInfo } from "../../shared/types";
import { api } from "../api";
import { Button } from "../components/Button";
import { FormError } from "../components/EmptyState";
import { TextField } from "../components/Field";
import { Icon } from "../components/Icon";
import { Logo } from "../components/Wordmark";

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
    <div className="flex min-h-dvh flex-col bg-surface lg:flex-row">
      <section
        data-surface="dark"
        aria-label="IKON SM Command Hub"
        // Plain charcoal, like the website's dark bands. On a phone the hero stays short so the
        // sign-in form is on the first screen.
        className="relative isolate overflow-hidden bg-charcoal px-6 pt-6 pb-7 text-white sm:px-10 sm:pt-8 sm:pb-10 lg:flex lg:w-[56%] lg:flex-col lg:px-14 lg:pt-12 lg:pb-12 xl:px-20"
      >
        <Logo className="w-[140px] sm:w-[200px] lg:w-[232px]" />
        <div className="mt-6 sm:mt-10 lg:my-auto lg:pt-10 lg:pb-16">
          <p className="mb-2 flex items-center gap-3 text-[11px] font-medium tracking-[0.3em] text-charcoal-muted uppercase sm:mb-4">
            <span aria-hidden="true" className="h-px w-8 bg-taupe" />
            Staff only
          </p>
          <h1 className="heading-display text-[32px] leading-[0.98] sm:text-[40px] lg:text-[64px] xl:text-[72px]">
            Command <br className="max-sm:hidden" />
            Hub
          </h1>
          {/* Light weight only at large sizes; regular on smaller screens, where 300 gets thin. */}
          <p className="mt-5 hidden max-w-md text-lg leading-relaxed font-normal text-white/90 sm:block lg:mt-7 lg:text-[22px] lg:leading-[1.55] lg:font-light">
            Strata operations without the runaround: one agent per scheme, every inbox triaged, and nothing sent without your approval.
          </p>
        </div>
        <p className="mt-8 hidden text-xs tracking-[0.2em] text-charcoal-muted uppercase lg:block">{companyName} · Perth, Western Australia</p>
      </section>

      <main className="flex flex-1 flex-col justify-center px-6 pt-7 pb-10 sm:px-10 sm:py-10 lg:px-14">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="heading-display text-lg leading-tight text-ink">Sign in</h2>
          <p className="mt-1.5 mb-5 text-sm text-muted sm:mb-7">Use your name and the team passcode.</p>

          <form onSubmit={submit} className="space-y-5">
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
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              Sign in
            </Button>
          </form>

          <p className="mt-8 flex items-start gap-2 border-t border-line pt-5 text-xs leading-relaxed text-muted">
            <Icon name="lock" className="mt-px size-3.5 shrink-0 text-taupe" />
            <span>Nothing leaves a building's agent without a staff member's approval.</span>
          </p>
        </div>
      </main>
    </div>
  );
}
