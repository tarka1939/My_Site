import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ContactService } from '../../../core/api/api/contact.service';
import { ContactMessage } from '../../../core/api/model/contactMessage';

@Component({
  selector: 'app-admin-message-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe],
  templateUrl: './admin-message-detail.component.html',
  styleUrl: './admin-message-detail.component.scss',
})
export class AdminMessageDetailComponent {
  private readonly contactApi = inject(ContactService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly message = signal<ContactMessage | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly deleting = signal(false);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.contactApi.getContactMessage({ id }).subscribe({
        next: (message) => {
          this.message.set(message);
          this.loading.set(false);
        },
        error: () => {
          this.notFound.set(true);
          this.loading.set(false);
        },
      });
    }
  }

  protected deleteMessage(): void {
    const message = this.message();
    if (!message || !confirm('Delete this message? This cannot be undone.')) {
      return;
    }

    this.deleting.set(true);
    this.contactApi.deleteContactMessage({ id: message.id }).subscribe({
      next: () => this.router.navigateByUrl('/admin/messages'),
      error: () => this.deleting.set(false),
    });
  }
}
