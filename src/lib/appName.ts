import { tx } from "~/lib/i18n";

/** The app's own name, shown before anyone signs in (and when there's no name to use). */
export const APP_NAME = "Pod Hub";

/** "Pod Hub" once someone with a name is signed in; the plain app name otherwise. */
export const hubName = (name: string | null | undefined) => (name ? tx("{name}'s Hub", { name }) : APP_NAME);

/** The headboard engraving: "ALEX'S BED", or "POD HUB" when there's no name. */
export const bedEngraving = (name: string | null | undefined) => (name ? `${name.toUpperCase()}'S BED` : APP_NAME.toUpperCase());

/** The nightstand screen's title. */
export const nightstandTitle = (name: string | null | undefined) =>
  name ? tx("{name}'s Nightstand", { name }) : tx("Bedside Nightstand");
