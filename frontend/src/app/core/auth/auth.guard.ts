import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) {
    return true;
  }

  // An expired session used to survive this redirect (#151): the dead token stayed in
  // sessionStorage and in the signal, to be carried onto the login page and kept there for as
  // long as the tab lived. Safe to call from a guard -- see clearExpiredSession() for why.
  auth.clearExpiredSession();

  return router.createUrlTree(['/admin/login'], { queryParams: { returnUrl: state.url } });
};
