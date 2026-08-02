import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContactService } from '../../../core/api/api/contact.service';
import { ContactMessage } from '../../../core/api/model/contactMessage';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-admin-messages-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe],
  templateUrl: './admin-messages-list.component.html',
  styleUrl: './admin-messages-list.component.scss',
})
export class AdminMessagesListComponent {
  private readonly contactApi = inject(ContactService);

  protected readonly messages = signal<ContactMessage[]>([]);
  protected readonly page = signal(0);
  protected readonly totalPages = signal(0);
  protected readonly loading = signal(false);

  constructor() {
    this.loadMessages();
  }

  protected goToPage(page: number): void {
    if (page < 0 || page >= this.totalPages()) {
      return;
    }
    this.page.set(page);
    this.loadMessages();
  }

  private loadMessages(): void {
    this.loading.set(true);
    this.contactApi.listContactMessages({ page: this.page(), size: PAGE_SIZE }).subscribe({
      next: (response) => {
        this.messages.set(response.content);
        this.totalPages.set(response.totalPages);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
