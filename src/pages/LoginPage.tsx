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
        className="relative isolate overflow-hidden bg-charcoal px-6 pt-8 pb-10 text-white sm:px-10 lg:flex lg:w-[56%] lg:flex-col lg:px-14 lg:pt-12 lg:pb-12 xl:px-20"
      >
        <SkylineBackdrop />
        <Logo className="w-[168px] sm:w-[200px] lg:w-[232px]" />
        <div className="mt-10 lg:my-auto lg:pt-10 lg:pb-16">
          <p className="mb-4 flex items-center gap-3 text-[11px] font-medium tracking-[0.3em] text-charcoal-muted uppercase">
            <span aria-hidden="true" className="h-px w-8 bg-taupe" />
            Staff only
          </p>
          <h1 className="heading-display text-[clamp(28px,9vw,40px)] leading-[0.98] lg:text-[64px] xl:text-[72px]">
            Command
            <br />
            Hub
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed font-light text-white/90 sm:text-lg lg:mt-7 lg:text-[22px] lg:leading-[1.55]">
            Strata operations without the runaround: one agent per scheme, every inbox triaged, and nothing sent without your approval.
          </p>
        </div>
        <p className="mt-8 hidden text-xs tracking-[0.2em] text-charcoal-muted uppercase lg:block">{companyName} · Perth, Western Australia</p>
      </section>

      <div className="flex flex-1 flex-col justify-center px-6 py-10 sm:px-10 lg:px-14">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="heading-display text-lg leading-tight text-ink">Sign in</h2>
          <p className="mt-1.5 mb-7 text-sm text-muted">Use your name and the team passcode.</p>

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
            <Button type="submit" variant="primary" className="h-12 w-full" loading={busy} disabled={!name.trim() || !passcode}>
              Sign in
            </Button>
          </form>

          <p className="mt-8 flex items-start gap-2 border-t border-line pt-5 text-xs leading-relaxed text-muted">
            <Icon name="lock" className="mt-px size-3.5 shrink-0 text-taupe" />
            <span>Nothing leaves a building's agent without a staff member's approval.</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/** A faint, abstract city skyline along the bottom of the hero panel (the website hero is a Perth skyline photo). */
function SkylineBackdrop() {
  const towers: [number, number, number][] = [
    [0, 70, 46], [50, 120, 34], [88, 92, 52], [146, 168, 40], [190, 132, 30], [224, 210, 44], [272, 150, 36], [312, 250, 50],
    [366, 186, 34], [404, 138, 46], [454, 228, 38], [496, 172, 52], [552, 118, 32], [588, 196, 44], [636, 146, 40], [680, 102, 56],
    [740, 160, 36], [780, 84, 60],
  ];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 840 260"
      preserveAspectRatio="xMidYMax slice"
      className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 hidden h-[34%] w-full text-white opacity-[0.04] lg:block"
    >
      {towers.map(([x, h, w]) => (
        <rect key={x} x={x} y={260 - h} width={w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}
