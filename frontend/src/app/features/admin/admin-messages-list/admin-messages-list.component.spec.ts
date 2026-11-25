import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ContactService } from '../../../core/api/api/contact.service';
import { ContactMessage } from '../../../core/api/model/contactMessage';
import { renderComponent } from '../../../../testing/zoneless';
import { AdminMessagesListComponent } from './admin-messages-list.component';

const MESSAGES: ContactMessage[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Ann Example',
    email: 'ann@example.invalid',
    message: 'Hello.',
    createdAt: '2026-11-25T10:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Bob Example',
    email: 'bob@example.invalid',
    message: 'Hello again.',
    createdAt: '2026-11-24T10:00:00Z',
  },
];

describe('AdminMessagesListComponent', () => {
  beforeEach(async () => {
    const listContactMessages = vi.fn().mockReturnValue(
      of({ content: MESSAGES, page: 0, size: 20, totalElements: MESSAGES.length, totalPages: 1 }),
    );

    await TestBed.configureTestingModule({
      imports: [AdminMessagesListComponent],
      providers: [provideRouter([]), { provide: ContactService, useValue: { listContactMessages } }],
    }).compileComponents();
  });

  it('links each row to its message', async () => {
    const fixture = await renderComponent(AdminMessagesListComponent);
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('td a')];

    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      MESSAGES.map((message) => `/admin/messages/${message.id}`),
    );
  });

  // The project list has the same tests of the same layout, and says what they can and cannot show
  // (admin-projects-list.component.spec.ts, #312). The stylesheet's half is in styles.spec.ts.
  describe('column names, in the table and in the stacked phone layout (#339)', () => {
    type Fixture = ComponentFixture<AdminMessagesListComponent>;

    function tableOf(fixture: Fixture): HTMLTableElement {
      const table = (fixture.nativeElement as HTMLElement).querySelector('table');
      if (!table) {
        throw new Error('no table is rendered');
      }
      return table;
    }

    /** The column headers' words, in column order. */
    function headerNames(fixture: Fixture): string[] {
      const headers = [...tableOf(fixture).querySelectorAll('th')];
      return headers.map((th) => (th.textContent ?? '').trim());
    }

    function bodyRows(fixture: Fixture): HTMLTableRowElement[] {
      return [...tableOf(fixture).querySelectorAll<HTMLTableRowElement>('tbody tr')];
    }

    it('states every table role in the markup, where a change of display cannot', async () => {
      const fixture = await renderComponent(AdminMessagesListComponent);
      const table = tableOf(fixture);
      const rolesOf = (selector: string) =>
        [...table.querySelectorAll(selector)].map((element) => element.getAttribute('role'));

      expect(table.getAttribute('role')).toBe('table');
      expect(rolesOf('thead, tbody')).toEqual(['rowgroup', 'rowgroup']);
      // The header row, then one per message.
      expect(rolesOf('tr')).toEqual(['row', 'row', 'row']);
      expect(rolesOf('th')).toEqual(Array(3).fill('columnheader'));
      expect(rolesOf('td')).toEqual(Array(6).fill('cell'));
    });

    it('gives every value a column header, and never hides the header row', async () => {
      const fixture = await renderComponent(AdminMessagesListComponent);

      expect(headerNames(fixture)).toEqual(['From', 'Received', 'Actions']);
      expect(bodyRows(fixture)).toHaveLength(MESSAGES.length);
      for (const row of bodyRows(fixture)) {
        expect(row.cells).toHaveLength(headerNames(fixture).length);
      }

      const thead = tableOf(fixture).querySelector('thead')!;
      for (const element of [thead, ...thead.querySelectorAll('*')]) {
        expect(element.hasAttribute('aria-hidden')).toBe(false);
        expect(element.hasAttribute('hidden')).toBe(false);
      }
    });

    it("labels the stacked date with its header's word, hidden from a screen reader", async () => {
      const fixture = await renderComponent(AdminMessagesListComponent);
      const names = headerNames(fixture);

      expect(bodyRows(fixture)).toHaveLength(MESSAGES.length);
      for (const row of bodyRows(fixture)) {
        const labels = [...row.cells].flatMap((cell, column) => {
          const label = cell.querySelector('.cell-label');
          return label ? [{ column, label }] : [];
        });

        // Only the date's: the sender opens its block, and View names itself.
        expect(labels.map(({ column }) => names[column])).toEqual(['Received']);
        for (const { column, label } of labels) {
          expect(label.getAttribute('data-label')).toBe(names[column]);
          expect(label.getAttribute('aria-hidden')).toBe('true');
          // Drawn by CSS, so the cell's text stays its value alone, as in the table.
          expect(label.textContent).toBe('');
        }
      }
    });
  });
});
