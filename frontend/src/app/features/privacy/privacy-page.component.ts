import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The privacy page (Phase 7c): what the site's own visit counting records, how, and what it does
 * not collect. Linked from the footer of every page.
 *
 * Static copy and nothing else. It is the owner's draft, awaiting sign-off, so it lives in the
 * template alone; the route's meta description in privacy.routes.ts is the only other text about
 * the page.
 */
@Component({
  selector: 'app-privacy-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './privacy-page.component.html',
  styleUrl: './privacy-page.component.scss',
})
export class PrivacyPageComponent {}
