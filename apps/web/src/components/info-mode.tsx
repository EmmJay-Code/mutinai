import { setInfoMode } from '@/app/actions';
import type { InfoMode } from '@/lib/info-mode';

/** Segmented Simple | Technical switch. A plain form, so it works without JavaScript; the choice persists in a cookie. */
export function InfoModeToggle({ mode, returnTo }: { mode: InfoMode; returnTo: string }) {
  return (
    <form action={setInfoMode} className="mode-toggle" aria-label="Level of detail">
      <input type="hidden" name="returnTo" value={returnTo} />
      <button type="submit" name="mode" value="simple" aria-pressed={mode === 'simple'} title="Plain-language results: what it is for, what it needs">Simple</button>
      <button type="submit" name="mode" value="technical" aria-pressed={mode === 'technical'} title="Compact index: parameters, context, capability profile, compatibility counts">Technical</button>
    </form>
  );
}
