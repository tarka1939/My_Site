import { TestBed } from '@angular/core/testing';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  const shown = () => service.notifications().map((n) => `${n.level}: ${n.message}`);

  beforeEach(() => {
    service = TestBed.inject(NotificationService);
  });

  // #236: two failing requests from one page load showed the same sentence twice.
  it('does not show a message that is already on screen a second time', () => {
    service.error('The server could not complete this just now.');
    service.error('The server could not complete this just now.');

    expect(shown()).toEqual(['error: The server could not complete this just now.']);
  });

  it('still shows different messages, and the same text at a different level, side by side', () => {
    service.error('First.');
    service.error('Second.');
    service.info('First.');

    expect(shown()).toEqual(['error: First.', 'error: Second.', 'info: First.']);
  });

  it('shows a message again once the earlier copy has been dismissed', () => {
    service.error('Again.');
    service.dismiss(service.notifications()[0].id);
    service.error('Again.');

    expect(shown()).toEqual(['error: Again.']);
  });
});
