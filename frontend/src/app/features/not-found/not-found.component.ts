import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <h1>Page not found</h1>
    <p>The page you're looking for doesn't exist.</p>
    <a routerLink="/">Back to projects</a>
  `,
})
export class NotFoundComponent {}
