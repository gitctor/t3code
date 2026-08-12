import { Atom } from "effect/unstable/reactivity";
import type { Crew } from "@t3tools/contracts";

/**
 * Cross-surface request to open the crew editor.
 *
 * The crew picker lives inside the model-picker popover, but its editor
 * dialog must outlive that popover: opening the editor closes the picker, so
 * dialog state cannot live in the pane that just unmounted. Any surface
 * writes a request here; a single host near the composer renders the dialog.
 *
 * `null` = closed · `{ crew: null }` = create · `{ crew }` = edit.
 * `template` prefills a create without switching the editor to edit mode
 * (used for the first-run Orchestrator starter crew).
 */
export interface CrewEditorRequest {
  readonly crew: Crew | null;
  readonly template?: Crew;
}

export const crewEditorRequestAtom = Atom.make<CrewEditorRequest | null>(null).pipe(Atom.keepAlive);
