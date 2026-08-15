import { Injectable, inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  PRIMARY_OUTLET,
  RouterStateSnapshot,
  TitleStrategy,
} from '@angular/router';
import { SeoService } from './seo.service';

/**
 * Extends the router's own title mechanism to carry the rest of a page's metadata.
 *
 * Routes already declare `title: 'My Site - Contact'` and the router applies it through a
 * `TitleStrategy` on every successful navigation. Rather than bolting a second, parallel mechanism
 * onto `NavigationEnd`, this replaces that strategy: routes gain `data: { description, robots }`
 * next to their `title`, and all three are applied from the same hook, at the same moment, for
 * every navigation including the first.
 *
 * Being invoked on *every* navigation is the property that matters. It means the description does
 * not have to be cleaned up by whoever set it -- the next navigation overwrites it, and a route
 * with no description of its own falls back to the site-level one (see `SeoService`). A component
 * that sets its own description (project detail) therefore needs no `ngOnDestroy` counterpart.
 *
 * Registered in `app.config.ts` as `{ provide: TitleStrategy, useClass: SeoTitleStrategy }`, which
 * overrides the `DefaultTitleStrategy` that `TitleStrategy`'s root provider would otherwise supply.
 */
@Injectable({ providedIn: 'root' })
export class SeoTitleStrategy extends TitleStrategy {
  private readonly seo = inject(SeoService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.seo.applyPage({
      // `buildTitle` walks to the deepest primary-outlet route that declares a title, so a child
      // route's title wins over its parent's -- the same resolution the default strategy uses.
      title: this.buildTitle(snapshot),
      description: deepestRouteData(snapshot, 'description'),
      robots: deepestRouteData(snapshot, 'robots'),
      // The router's own view of the URL, rather than `document.location`. Both are correct at this
      // point in the navigation, but this one cannot drift: it is the state being activated.
      url: snapshot.url,
    });
  }
}

/**
 * The deepest string value for `key` in the activated route chain's `data`, mirroring how
 * `TitleStrategy.buildTitle` resolves `title`.
 *
 * Walking the chain here rather than relying on Angular's `data` inheritance is deliberate: route
 * `data` is only inherited by path-less or component-less children unless
 * `paramsInheritanceStrategy: 'always'` is set globally. This walk gives the intended semantics
 * regardless -- a parent's value applies to its whole subtree, and any descendant may override it
 * -- which is what lets a single `robots` on the `admin` route cover every page beneath it.
 */
function deepestRouteData(snapshot: RouterStateSnapshot, key: string): string | undefined {
  let value: string | undefined;
  let route: ActivatedRouteSnapshot | undefined = snapshot.root;

  while (route !== undefined) {
    const candidate: unknown = route.data[key];
    if (typeof candidate === 'string') {
      value = candidate;
    }
    route = route.children.find((child) => child.outlet === PRIMARY_OUTLET);
  }

  return value;
}
